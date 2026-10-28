import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { testDatabase } from './helpers';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase(); });
afterAll(async () => { await fixture.cleanup(); });
const client = () => request(createApp(fixture.db));
async function account() { return (await client().post('/accounts').send({ name: 'Integrity' })).body.data; }
function entry(id: string, reference_id: string, type = 'credit', amount = 100) {
  return { account_id: id, type, amount, reference_id };
}
async function reconcile(id: string) {
  const account = await fixture.db.account.findUniqueOrThrow({ where: { id } });
  const entries = await fixture.db.transaction.findMany({ where: { account_id: id } });
  expect(account.balance).toBe(entries.reduce((sum, e) => sum + (e.type === 'credit' ? e.amount : -e.amount), 0));
  expect(account.balance).toBeGreaterThanOrEqual(0);
}
test('required example reconciles after successful and rejected entries', async () => {
  const a = await account();
  for (const [reference, type, amount] of [['c1', 'credit', 100], ['c2', 'credit', 50], ['d1', 'debit', 30], ['d2', 'debit', 20]] as const) {
    expect((await client().post('/transactions').send(entry(a.id, reference, type, amount))).status).toBe(201);
  }
  expect((await client().post('/transactions').send(entry(a.id, 'too-much', 'debit', 101))).status).toBe(409);
  expect((await client().post('/transactions').send(entry(a.id, 'c1'))).status).toBe(409);
  expect((await client().get(`/accounts/${a.id}/balance`)).body.data.balance).toBe(100);
  await reconcile(a.id);
});
test('a database failure after the balance update rolls back both writes', async () => {
  const a = await account();
  await fixture.db.$executeRawUnsafe(`CREATE TRIGGER fail_entry BEFORE INSERT ON "Transaction" WHEN NEW.reference_id = 'force-failure' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  try {
    const result = await client().post('/transactions').send(entry(a.id, 'force-failure'));
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    expect(await fixture.db.transaction.count({ where: { account_id: a.id } })).toBe(0);
    expect((await fixture.db.account.findUniqueOrThrow({ where: { id: a.id } })).balance).toBe(0);
  } finally {
    await fixture.db.$executeRawUnsafe('DROP TRIGGER fail_entry');
  }
});
test('concurrent debits through independent database clients cannot overdraw', async () => {
  const a = await account();
  expect((await client().post('/transactions').send(entry(a.id, 'seed'))).status).toBe(201);
  const second = new PrismaClient({ datasources: { db: { url: fixture.url } } });
  try {
    const responses = await Promise.all(Array.from({ length: 4 }, (_, i) =>
      request(createApp(i % 2 ? second : fixture.db)).post('/transactions').send(entry(a.id, `race-${i}`, 'debit', 60))));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect((await client().get(`/accounts/${a.id}/balance`)).body.data.balance).toBe(40);
    expect(await fixture.db.transaction.count({ where: { account_id: a.id } })).toBe(2);
    await reconcile(a.id);
  } finally { await second.$disconnect(); }
});
test('concurrent duplicate credits apply once across independent clients', async () => {
  const a = await account();
  const second = new PrismaClient({ datasources: { db: { url: fixture.url } } });
  try {
    const responses = await Promise.all(Array.from({ length: 4 }, (_, i) =>
      request(createApp(i % 2 ? second : fixture.db)).post('/transactions').send(entry(a.id, 'same-reference'))));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409, 409, 409]);
    expect((await client().get(`/accounts/${a.id}/balance`)).body.data.balance).toBe(100);
    expect(await fixture.db.transaction.count({ where: { account_id: a.id } })).toBe(1);
    await reconcile(a.id);
  } finally { await second.$disconnect(); }
});
test('transaction updates and deletes are unavailable and leave records unchanged', async () => {
  const a = await account();
  const created = (await client().post('/transactions').send(entry(a.id, 'immutable'))).body.data;
  for (const method of ['put', 'patch', 'delete'] as const) {
    for (const path of [`/transactions/${created.id}`, '/transactions', `/accounts/${a.id}/transactions/${created.id}`]) {
      expect((await client()[method](path).send({ amount: 999 })).status).toBe(404);
    }
  }
  expect((await client().get(`/accounts/${a.id}/transactions`)).body.data).toEqual([created]);
  await reconcile(a.id);
});
test('database constraints reject invalid balances, names, types, amounts, references and foreign keys', async () => {
  const a = await account();
  await expect(fixture.db.account.update({ where: { id: a.id }, data: { balance: -1 } })).rejects.toThrow();
  await expect(fixture.db.account.create({ data: { name: ' ' } })).rejects.toThrow();
  for (const data of [{ type: 'other' }, { amount: 0 }, { amount: -1 }, { reference_id: ' ' }, { account_id: randomUUID() }]) {
    await expect(fixture.db.transaction.create({ data: { account_id: a.id, type: 'credit', amount: 1, reference_id: randomUUID(), ...data } })).rejects.toThrow();
  }
  await expect(fixture.db.$executeRaw`UPDATE "Account" SET balance = 1.5 WHERE id = ${a.id}`).rejects.toThrow();
  await expect(fixture.db.$executeRaw`UPDATE "Account" SET balance = 2147483648 WHERE id = ${a.id}`).rejects.toThrow();
  await fixture.db.transaction.create({ data: { account_id: a.id, type: 'credit', amount: 1, reference_id: 'constraint-ref' } });
  await expect(fixture.db.transaction.create({ data: { account_id: a.id, type: 'credit', amount: 1, reference_id: 'constraint-ref' } })).rejects.toThrow();
  await expect(fixture.db.account.delete({ where: { id: a.id } })).rejects.toThrow();
});
test('invalid JSON, oversized and missing bodies return safe consistent errors', async () => {
  const invalid = await client().post('/transactions').set('Content-Type', 'application/json').send('{bad');
  expect(invalid.status).toBe(400);
  expect(invalid.body.error.code).toBe('INVALID_BODY');
  expect((await client().post('/accounts').send({ name: 'x'.repeat(17000) })).status).toBe(413);
  expect((await client().get('/accounts/%ZZ/balance')).status).toBe(400);
  const missing = await client().post('/transactions');
  expect(missing.status).toBe(400);
  expect(missing.body.error.code).toBe('VALIDATION_ERROR');
});

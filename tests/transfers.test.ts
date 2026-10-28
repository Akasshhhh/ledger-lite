import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { MAX_MINOR } from '../src/shared';
import { testDatabase } from './helpers';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let source: string;
let destination: string;
beforeEach(async () => {
  fixture = await testDatabase();
  source = (await fixture.db.account.create({ data: { name: 'A' } })).id;
  destination = (await fixture.db.account.create({ data: { name: 'B' } })).id;
  for (const [account_id, amount] of [[source, 100], [destination, 50]] as const) {
    expect((await request(createApp(fixture.db)).post('/transactions').send({ account_id, amount, type: 'credit', reference_id: 'initial' })).status).toBe(201);
  }
});
afterEach(async () => { await fixture.cleanup(); });
const input = (overrides = {}) => ({ source_account_id: source, destination_account_id: destination, amount: 30, reference_id: 'transfer-1', ...overrides });
const post = (body: object) => request(createApp(fixture.db)).post('/transfers').send(body);
async function balances() { return Promise.all([source, destination].map(async id => (await fixture.db.account.findUniqueOrThrow({ where: { id } })).balance)); }
async function reconcile() {
  for (const id of [source, destination]) {
    const entries = await fixture.db.transaction.findMany({ where: { account_id: id } });
    const sum = entries.reduce((sum, e) => sum + (e.type === 'credit' ? e.amount : -e.amount), 0);
    expect((await fixture.db.account.findUniqueOrThrow({ where: { id } })).balance).toBe(sum);
  }
}
test('assignment transfer moves 30 from 100/50 to 70/80 and creates both ledger entries', async () => {
  const response = await post(input({ description: '  Shared transfer  ' }));
  expect(response.status).toBe(201);
  expect(response.body.data.source_transaction).toMatchObject({ account_id: source, type: 'debit', amount: 30, description: 'Shared transfer', reference_id: 'transfer-1' });
  expect(response.body.data.destination_transaction).toMatchObject({ account_id: destination, type: 'credit', amount: 30, reference_id: 'transfer-1' });
  expect(response.body.data.source_transaction.id).not.toBe(response.body.data.destination_transaction.id);
  expect(await balances()).toEqual([7000, 8000]);
  expect(await fixture.db.transaction.count()).toBe(4);
  await reconcile();
});
test('insufficient funds and missing accounts leave both sides unchanged', async () => {
  expect((await post(input({ amount: 101 }))).body.error.code).toBe('INSUFFICIENT_FUNDS');
  for (const overrides of [{ source_account_id: randomUUID() }, { destination_account_id: randomUUID() }]) {
    const response = await post(input(overrides));
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  }
  expect(await balances()).toEqual([10000, 5000]);
  expect(await fixture.db.transaction.count()).toBe(2);
  await reconcile();
});
test('duplicates on either side and repeated transfers roll back both balances', async () => {
  await fixture.db.transaction.create({ data: { account_id: destination, type: 'credit', amount: 100, reference_id: 'destination-only' } });
  await fixture.db.account.update({ where: { id: destination }, data: { balance: { increment: 100 } } });
  const conflict = await post(input({ reference_id: 'destination-only' }));
  expect(conflict.status).toBe(409);
  expect(conflict.body.error.code).toBe('DUPLICATE_REFERENCE');
  expect(await balances()).toEqual([10000, 5100]);
  expect((await post(input())).status).toBe(201);
  expect((await post(input())).body.error.code).toBe('DUPLICATE_REFERENCE');
  expect(await balances()).toEqual([7000, 8100]);
  expect(await fixture.db.transaction.count()).toBe(5);
  await reconcile();
});
test('a failed destination insert rolls back both balance changes and the already-inserted debit', async () => {
  await fixture.db.$executeRawUnsafe(`CREATE TRIGGER fail_transfer BEFORE INSERT ON "Transaction" WHEN NEW.reference_id = 'failed-transfer' AND NEW.type = 'credit' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  const response = await post(input({ reference_id: 'failed-transfer' }));
  expect(response.status).toBe(500);
  expect(response.body.error.code).toBe('INTERNAL_ERROR');
  expect(await balances()).toEqual([10000, 5000]);
  expect(await fixture.db.transaction.count()).toBe(2);
  await reconcile();
});
test('destination balance cap rejects the whole transfer', async () => {
  expect((await request(createApp(fixture.db)).post('/transactions').send({ account_id: destination, amount: (MAX_MINOR - 5000) / 100, type: 'credit', reference_id: 'fill' })).status).toBe(201);
  const response = await post(input());
  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('BALANCE_LIMIT');
  expect(await balances()).toEqual([10000, MAX_MINOR]);
  expect(await fixture.db.transaction.count()).toBe(3);
  await reconcile();
});
test.each([
  { amount: 0 }, { amount: -1 }, { amount: 0.001 }, { amount: '30' },
  { source_account_id: 'bad' }, { destination_account_id: 'bad' },
  { reference_id: '' }, { reference_id: ' ' }, { description: null }, { balance: 100 },
])('rejects invalid input %j', async overrides => {
  const response = await post(input(overrides));
  expect(response.status).toBe(400);
  expect(response.body.error.code).toBe('VALIDATION_ERROR');
  expect(await balances()).toEqual([10000, 5000]);
});
test('rejects same-account transfers and missing required fields', async () => {
  expect((await post(input({ destination_account_id: source }))).status).toBe(400);
  for (const field of ['source_account_id', 'destination_account_id', 'amount', 'reference_id']) {
    const body: Record<string, unknown> = input(); delete body[field];
    expect((await post(body)).status).toBe(400);
  }
});
test('concurrent transfers cannot overdraw or partially credit the destination', async () => {
  const other = new PrismaClient({ datasources: { db: { url: fixture.url } } });
  try {
    const responses = await Promise.all([fixture.db, other, fixture.db].map((db, i) => request(createApp(db)).post('/transfers').send(input({ amount: 60, reference_id: `race-${i}` }))));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409, 409]);
    expect(await balances()).toEqual([4000, 11000]);
    expect(await fixture.db.transaction.count()).toBe(4);
    await reconcile();
  } finally { await other.$disconnect(); }
});
test('concurrent duplicate transfers have exactly one effect', async () => {
  const other = new PrismaClient({ datasources: { db: { url: fixture.url } } });
  try {
    const responses = await Promise.all([fixture.db, other].map(db => request(createApp(db)).post('/transfers').send(input())));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(await balances()).toEqual([7000, 8000]);
    expect(await fixture.db.transaction.count()).toBe(4);
    await reconcile();
  } finally { await other.$disconnect(); }
});

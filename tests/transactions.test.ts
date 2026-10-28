import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MAX_MINOR } from '../src/shared';
import { testDatabase } from './helpers';

describe('transaction creation', () => {
  let fixture: Awaited<ReturnType<typeof testDatabase>>;
  let accountId: string;
  beforeEach(async () => {
    fixture = await testDatabase();
    accountId = (await fixture.db.account.create({ data: { name: 'Main' } })).id;
  });
  afterEach(async () => { await fixture.cleanup(); });
  const post = (body: object) => request(createApp(fixture.db)).post('/transactions').send(body);
  const input = (overrides = {}) => ({ account_id: accountId, type: 'credit', amount: 10.25, reference_id: 'ref-1', ...overrides });

  it('credits and debits exact minor units, trims strings, and returns generated fields', async () => {
    const credit = await post(input({ description: '  Deposit  ', reference_id: '  ref-1  ' }));
    expect(credit.status).toBe(201);
    expect(credit.body.data).toMatchObject({ account_id: accountId, type: 'credit', amount: 10.25, description: 'Deposit', reference_id: 'ref-1' });
    expect(credit.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(credit.body.data.created_at))).toBe(false);
    const debit = await post(input({ type: 'debit', amount: 10.25, reference_id: 'ref-2' }));
    expect(debit.status).toBe(201);
    expect(debit.body.data.description).toBe('');
    expect((await fixture.db.account.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(0);
    expect(await fixture.db.transaction.count()).toBe(2);
  });

  it('rejects duplicate references and rolls back any balance update', async () => {
    await post(input());
    const duplicate = await post(input({ amount: 2 }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_REFERENCE');
    expect((await fixture.db.account.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(1025);
    expect(await fixture.db.transaction.count()).toBe(1);
  });

  it('prioritizes duplicate references even when the repeated debit lacks funds', async () => {
    await post(input());
    await post(input({ type: 'debit', reference_id: 'spent' }));
    const duplicate = await post(input({ type: 'debit', reference_id: 'spent' }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_REFERENCE');
    expect(await fixture.db.transaction.count()).toBe(2);
  });

  it('allows the same reference on another account', async () => {
    const other = await fixture.db.account.create({ data: { name: 'Other' } });
    expect((await post(input())).status).toBe(201);
    expect((await post(input({ account_id: other.id }))).status).toBe(201);
  });

  it('rejects overdrafts without writing history', async () => {
    const response = await post(input({ type: 'debit', amount: 0.01 }));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(await fixture.db.transaction.count()).toBe(0);
    expect((await fixture.db.account.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(0);
  });

  it('enforces the balance limit and preserves existing history', async () => {
    expect((await post(input({ amount: MAX_MINOR / 100 }))).status).toBe(201);
    const response = await post(input({ amount: 0.01, reference_id: 'overflow' }));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('BALANCE_LIMIT');
    expect((await fixture.db.account.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(MAX_MINOR);
    expect(await fixture.db.transaction.count()).toBe(1);
  });

  it('returns 404 for a valid missing account', async () => {
    const response = await post(input({ account_id: randomUUID() }));
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('keeps 0.10 plus 0.20 exactly equal to 0.30', async () => {
    await post(input({ amount: 0.1 }));
    await post(input({ amount: 0.2, reference_id: 'second' }));
    expect((await fixture.db.account.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(30);
    expect((await post(input({ type: 'debit', amount: 0.3, reference_id: 'third' }))).status).toBe(201);
    expect((await fixture.db.account.findUniqueOrThrow({ where: { id: accountId } })).balance).toBe(0);
  });

  it.each([
    { amount: 0 }, { amount: -1 }, { amount: 1.001 }, { amount: 0.001 }, { amount: 0.1 + 0.2 },
    { amount: '1.00' }, { amount: null }, { amount: true }, { amount: 21474836.48 },
    { account_id: 'invalid' }, { account_id: null }, { type: 'Credit' }, { type: 'transfer' },
    { description: null }, { description: 12 }, { description: 'x'.repeat(1001) },
    { reference_id: '' }, { reference_id: '   ' }, { reference_id: 1 }, { reference_id: 'x'.repeat(201) },
    { id: randomUUID() }, { created_at: '2020-01-01' }, { balance: 10 },
  ])('rejects invalid fields %j without writes', async overrides => {
    const response = await post(input(overrides));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await fixture.db.transaction.count()).toBe(0);
  });

  it.each(['account_id', 'type', 'amount', 'reference_id'])('requires %s', async field => {
    const body: Record<string, unknown> = input();
    delete body[field];
    expect((await post(body)).status).toBe(400);
    expect(await fixture.db.transaction.count()).toBe(0);
  });
});

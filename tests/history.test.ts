import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { testDatabase } from './helpers';

describe('transaction history', () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  let accountId: string;
  beforeEach(async () => {
    database = await testDatabase();
    const account = await database.db.account.create({ data: { name: 'History account' } });
    accountId = account.id;
  });
  afterEach(async () => { await database.cleanup(); });

  async function seed() {
    const transactions = [
      { id: '00000000-0000-4000-8000-000000000001', type: 'credit', created_at: new Date('2026-01-01T00:00:00Z') },
      { id: '00000000-0000-4000-8000-000000000002', type: 'debit', created_at: new Date('2026-01-02T00:00:00Z') },
      { id: '00000000-0000-4000-8000-000000000003', type: 'credit', created_at: new Date('2026-01-02T00:00:00Z') },
    ];
    for (const entry of transactions) {
      await database.db.transaction.create({ data: { ...entry, account_id: accountId, amount: 123, description: 'Entry', reference_id: entry.id } });
    }
    const other = await database.db.account.create({ data: { name: 'Other account' } });
    await database.db.transaction.create({ data: { account_id: other.id, type: 'credit', amount: 100, reference_id: 'other' } });
    return transactions;
  }

  it('returns account-only entries latest first with deterministic ties and major-unit amounts', async () => {
    const entries = await seed();
    const response = await request(createApp(database.db)).get(`/accounts/${accountId}/transactions`).expect(200);
    expect(response.body.data.map((entry: { id: string }) => entry.id)).toEqual(entries.map(e => e.id).reverse());
    expect(response.body.data[0]).toEqual({ ...entries[2], created_at: entries[2]!.created_at.toISOString(), account_id: accountId, amount: 1.23, description: 'Entry', reference_id: entries[2]!.id });
    expect(response.body.pagination).toEqual({ page: 1, limit: 20, total: 3, total_pages: 1 });
  });

  it('paginates filtered totals and returns an empty page beyond the final page', async () => {
    const entries = await seed();
    const app = createApp(database.db);
    const filtered = await request(app).get(`/accounts/${accountId}/transactions?type=credit&page=2&limit=1`).expect(200);
    expect(filtered.body.data.map((entry: { id: string }) => entry.id)).toEqual([entries[0]!.id]);
    expect(filtered.body.pagination).toEqual({ page: 2, limit: 1, total: 2, total_pages: 2 });
    const debit = await request(app).get(`/accounts/${accountId}/transactions?type=debit`).expect(200);
    expect(debit.body.data.map((entry: { id: string }) => entry.id)).toEqual([entries[1]!.id]);
    const beyond = await request(app).get(`/accounts/${accountId}/transactions?page=1000000&limit=100`).expect(200);
    expect(beyond.body).toEqual({ data: [], pagination: { page: 1000000, limit: 100, total: 3, total_pages: 1 } });
  });

  it('returns zero totals for empty accounts and unmatched filters', async () => {
    const app = createApp(database.db);
    const empty = await request(app).get(`/accounts/${accountId}/transactions`).expect(200);
    expect(empty.body).toEqual({ data: [], pagination: { page: 1, limit: 20, total: 0, total_pages: 0 } });
    await database.db.transaction.create({ data: { account_id: accountId, type: 'credit', amount: 100, reference_id: 'credit-only' } });
    const unmatched = await request(app).get(`/accounts/${accountId}/transactions?type=debit`).expect(200);
    expect(unmatched.body).toEqual(empty.body);
  });

  it.each([
    'type=refund', 'type=Credit', 'type=', 'type=credit&type=debit',
    'page=0', 'page=-1', 'page=1.5', 'page=1e2', 'page=01', 'page=1000001', 'page=', 'page=1&page=2',
    'limit=0', 'limit=-1', 'limit=1.5', 'limit=101', 'limit=Infinity', 'limit=', 'limit=1&limit=2',
    'unknown=value', 'page[nested]=1',
  ])('rejects invalid query %s', async query => {
    const response = await request(createApp(database.db)).get(`/accounts/${accountId}/transactions?${query}`).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('distinguishes malformed and absent account IDs', async () => {
    const app = createApp(database.db);
    const malformed = await request(app).get('/accounts/not-a-uuid/transactions').expect(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    const absent = await request(app).get(`/accounts/${randomUUID()}/transactions`).expect(404);
    expect(absent.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

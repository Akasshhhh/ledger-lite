import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { testDatabase } from './helpers';

describe('accounts', () => {
  let fixture: Awaited<ReturnType<typeof testDatabase>>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    fixture = await testDatabase();
    app = createApp(fixture.db);
  });
  afterAll(async () => { await fixture?.cleanup(); });

  it('creates a trimmed account with zero balance and server generated ID and time', async () => {
    const before = Date.now();
    const response = await request(app).post('/accounts').send({ name: '  Main account  ' });
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
      name: 'Main account', balance: 0, created_at: expect.any(String),
    });
    const createdAt = Date.parse(response.body.data.created_at);
    expect(createdAt).toBeGreaterThanOrEqual(before - 1000);
    expect(createdAt).toBeLessThanOrEqual(Date.now());
    const stored = await fixture.db.account.findUniqueOrThrow({ where: { id: response.body.data.id } });
    expect(stored.name).toBe('Main account');
    expect(stored.balance).toBe(0);
    const balance = await request(app).get(`/accounts/${stored.id}/balance`);
    expect(balance.status).toBe(200);
    expect(balance.body).toEqual({ data: { account_id: stored.id, balance: 0 } });
  });

  it.each([
    {}, { name: '' }, { name: ' \t\n ' }, { name: null }, { name: 42 },
    { name: 'a'.repeat(201) }, [],
    { name: 'Account', balance: 10 },
    { name: 'Account', id: randomUUID() },
    { name: 'Account', created_at: '2020-01-01T00:00:00Z' },
    { name: 'Account', extra: true },
  ].map(body => [body]))('rejects invalid or server controlled fields: %j', async (body) => {
    const count = await fixture.db.account.count();
    const response = await request(app).post('/accounts').send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await fixture.db.account.count()).toBe(count);
  });

  it('accepts a 200 character name after trimming and allows duplicate names', async () => {
    for (let i = 0; i < 2; i++) {
      const response = await request(app).post('/accounts').send({ name: ` ${'a'.repeat(200)} ` });
      expect(response.status).toBe(201);
      expect(response.body.data.name).toHaveLength(200);
    }
  });

  it('returns the persisted balance in major units', async () => {
    const account = await fixture.db.account.create({ data: { name: 'Funded', balance: 12345 } });
    const response = await request(app).get(`/accounts/${account.id}/balance`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { account_id: account.id, balance: 123.45 } });
  });

  it('returns 404 for an absent valid account ID', async () => {
    const response = await request(app).get(`/accounts/${randomUUID()}/balance`);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it.each(['not-a-uuid', '123', 'null'])('rejects malformed account ID %s', async (id) => {
    const response = await request(app).get(`/accounts/${id}/balance`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

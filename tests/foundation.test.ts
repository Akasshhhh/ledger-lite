import { afterAll, beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { amountSchema } from '../src/shared';
import { testDatabase } from './helpers';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase(); });
afterAll(async () => { await fixture.cleanup(); });
test('migration creates usable tables with defaults', async () => {
  const account = await fixture.db.account.create({ data: { name: 'Foundation' } });
  expect(account.balance).toBe(0);
  expect(account.created_at).toBeInstanceOf(Date);
  expect(await fixture.db.transaction.count()).toBe(0);
});
test('money parses decimal amounts without binary multiplication artifacts', () => {
  expect(amountSchema.parse(0.29)).toBe(29);
  expect(amountSchema.parse(21474836.47)).toBe(2147483647);
  for (const amount of [0, -1, 0.001, 21474836.48, '1', null]) expect(amountSchema.safeParse(amount).success).toBe(false);
});
test('safe consistent errors for unknown paths and invalid JSON', async () => {
  const app = createApp(fixture.db);
  expect((await request(app).get('/unknown')).body.error.code).toBe('NOT_FOUND');
  const res = await request(app).post('/accounts').set('Content-Type', 'application/json').send('{');
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('INVALID_BODY');
});

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { accountIdSchema, accountJson, AppError } from './shared';

const createAccountSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();

export function accountsRouter(db: PrismaClient) {
  const router = Router();

  router.post('/accounts', async (req, res) => {
    const data = createAccountSchema.parse(req.body);
    const account = await db.account.create({ data });
    res.status(201).json({ data: accountJson(account) });
  });

  router.get('/accounts/:accountId/balance', async (req, res) => {
    const accountId = accountIdSchema.parse(req.params.accountId);
    const account = await db.account.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
    res.json({ data: { account_id: account.id, balance: account.balance / 100 } });
  });

  return router;
}

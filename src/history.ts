import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { accountIdSchema, AppError, transactionJson } from './shared';

const positiveInteger = (maximum: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).pipe(z.number().int().max(maximum));
const querySchema = z.object({
  type: z.enum(['credit', 'debit']).optional(),
  page: positiveInteger(1_000_000).default(1),
  limit: positiveInteger(100).default(20),
}).strict();

export function historyRouter(db: PrismaClient) {
  const router = Router();
  router.get('/accounts/:accountId/transactions', async (req, res) => {
    const account_id = accountIdSchema.parse(req.params.accountId);
    const { type, page, limit } = querySchema.parse(req.query);
    const where = { account_id, ...(type ? { type } : {}) };
    const [account, total, transactions] = await db.$transaction([
      db.account.findUnique({ where: { id: account_id }, select: { id: true } }),
      db.transaction.count({ where }),
      db.transaction.findMany({
        where, orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit, take: limit,
      }),
    ]);
    if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
    res.json({ data: transactions.map(transactionJson), pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } });
  });
  return router;
}

import { Prisma, type PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { accountIdSchema, amountSchema, AppError, MAX_MINOR, transactionJson } from './shared';

const transactionSchema = z.object({
  account_id: accountIdSchema,
  type: z.enum(['credit', 'debit']),
  amount: amountSchema,
  description: z.string().trim().max(1000).optional().default(''),
  reference_id: z.string().trim().min(1).max(200),
}).strict();

export function transactionsRouter(db: PrismaClient) {
  const router = Router();
  router.post('/transactions', async (req, res) => {
    const input = transactionSchema.parse(req.body);
    try {
      const transaction = await db.$transaction(async tx => {
        // Obtain SQLite's write lock before reading to avoid read-to-write upgrades.
        const changed = await tx.account.updateMany({
          where: {
            id: input.account_id,
            balance: input.type === 'debit' ? { gte: input.amount } : { lte: MAX_MINOR - input.amount },
          },
          data: { balance: input.type === 'debit' ? { decrement: input.amount } : { increment: input.amount } },
        });
        if (changed.count === 0) {
          const account = await tx.account.findUnique({ where: { id: input.account_id } });
          if (!account) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
          const duplicate = await tx.transaction.findUnique({
            where: { account_id_reference_id: { account_id: input.account_id, reference_id: input.reference_id } },
          });
          if (duplicate) throw new AppError(409, 'DUPLICATE_REFERENCE', 'Reference already exists for this account');
          throw input.type === 'debit'
            ? new AppError(409, 'INSUFFICIENT_FUNDS', 'Account has insufficient funds')
            : new AppError(409, 'BALANCE_LIMIT', 'Account balance would exceed the supported limit');
        }
        return tx.transaction.create({ data: input });
      });
      res.status(201).json({ data: transactionJson(transaction) });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'DUPLICATE_REFERENCE', 'Reference already exists for this account');
      }
      throw error;
    }
  });
  return router;
}

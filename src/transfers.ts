import { Prisma, type PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { accountIdSchema, amountSchema, AppError, MAX_MINOR, transactionJson } from './shared';

const transferSchema = z.object({
  source_account_id: accountIdSchema,
  destination_account_id: accountIdSchema,
  amount: amountSchema,
  reference_id: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().default(''),
}).strict().refine(input => input.source_account_id !== input.destination_account_id, {
  path: ['destination_account_id'], message: 'Source and destination must be different accounts',
});

export function transfersRouter(db: PrismaClient) {
  const router = Router();
  router.post('/transfers', async (req, res) => {
    const input = transferSchema.parse(req.body);
    try {
      const entries = await db.$transaction(async tx => {
        // Obtain the database write lock before reads; the debit is conditional.
        const debited = await tx.account.updateMany({
          where: { id: input.source_account_id, balance: { gte: input.amount } },
          data: { balance: { decrement: input.amount } },
        });
        const ids = [input.source_account_id, input.destination_account_id];
        if (await tx.account.count({ where: { id: { in: ids } } }) !== 2) {
          throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Source or destination account not found');
        }
        const duplicate = await tx.transaction.findFirst({
          where: { account_id: { in: ids }, reference_id: input.reference_id },
        });
        if (duplicate) throw new AppError(409, 'DUPLICATE_REFERENCE', 'Reference already exists for a participating account');
        if (!debited.count) throw new AppError(409, 'INSUFFICIENT_FUNDS', 'Source account has insufficient funds');
        const credited = await tx.account.updateMany({
          where: { id: input.destination_account_id, balance: { lte: MAX_MINOR - input.amount } },
          data: { balance: { increment: input.amount } },
        });
        if (!credited.count) throw new AppError(409, 'BALANCE_LIMIT', 'Destination balance would exceed the supported limit');
        const common = { amount: input.amount, reference_id: input.reference_id, description: input.description, created_at: new Date() };
        const debit = await tx.transaction.create({ data: { ...common, account_id: input.source_account_id, type: 'debit' } });
        const credit = await tx.transaction.create({ data: { ...common, account_id: input.destination_account_id, type: 'credit' } });
        return { source_transaction: transactionJson(debit), destination_transaction: transactionJson(credit) };
      });
      res.status(201).json({ data: entries });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'DUPLICATE_REFERENCE', 'Reference already exists for a participating account');
      }
      throw error;
    }
  });
  return router;
}

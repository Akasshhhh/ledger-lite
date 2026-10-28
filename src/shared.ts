import type { Account, Transaction } from '@prisma/client';
import { z } from 'zod';

export const MAX_MINOR = 2_147_483_647;
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const accountIdSchema = z.string().uuid();
// Parse the decimal representation rather than multiplying a binary float.
export const amountSchema = z.number().finite().positive().transform((value, ctx) => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  const minor = match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : NaN;
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > MAX_MINOR) {
    ctx.addIssue({ code: 'custom', message: 'Amount must have at most two decimals and be between 0.01 and 21474836.47' });
    return z.NEVER;
  }
  return minor;
});
export const accountJson = (account: Account) => ({ ...account, balance: account.balance / 100 });
export const transactionJson = (transaction: Transaction) => ({ ...transaction, amount: transaction.amount / 100 });

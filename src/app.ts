import express, { type ErrorRequestHandler } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from './shared';
import { accountsRouter } from './accounts';
import { transactionsRouter } from './transactions';
import { historyRouter } from './history';

export function createApp(db: PrismaClient) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(express.json({ limit: '16kb' }));
  app.use(accountsRouter(db));
  app.use(transactionsRouter(db));
  app.use(historyRouter(db));
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found')));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) } });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } });
      return;
    }
    if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large' || error?.status === 415) {
      res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: { code: 'INVALID_BODY', message: 'Request body must be valid JSON within 16kb' } });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P1008', 'P2028', 'P2034'].includes(error.code)) {
      res.status(503).json({ error: { code: 'DATABASE_BUSY', message: 'Database is busy; retry the request with the same reference_id' } });
      return;
    }
    console.error('Unexpected request failure:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  };
  app.use(errors);
  return app;
}

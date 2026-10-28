# LedgerLite

A local backend assessment API for account balances and an immutable transaction history. Credits and debits persist atomically in SQLite, with per-account duplicate protection and conditional updates that prevent concurrent overdrafts.

## Requirements

Node.js 24.x is recommended (verified with 24.2.0); the tooling also supports Node 22.12+ and >=26. npm is required. No external database server is needed.

Stack: TypeScript, Express 5, Prisma 6, SQLite, Zod, Vitest 5, and Supertest.

## Installation

Run from the project root:

```sh
npm ci
```

## Configuration

Copy the safe example only when `.env` does not already exist:

```sh
cp -n .env.example .env
npm run db:generate
npm run db:migrate
```

`DATABASE_URL` defaults to `file:./dev.db` in the server and migration script. Relative SQLite paths resolve under `prisma/`; the default database is `prisma/dev.db`. `HOST` defaults to `127.0.0.1`; `PORT` defaults to `3000`. Prisma's generate/validate CLI commands read `.env` directly. The migration script creates the database file if necessary and applies the checked-in SQL migration without resetting data. Do not use `prisma db push`: the migration contains additional SQL CHECK constraints.

## Quick start

```sh
npm run build
npm start
```

For development, run `npm run dev` instead. Stop with Ctrl+C.

Create an account and copy the returned `data.id` into `ACCOUNT_ID`:

```sh
curl -sS http://127.0.0.1:3000/accounts \
  -H 'Content-Type: application/json' -d '{"name":"Main account"}'

ACCOUNT_ID='paste-the-returned-UUID-here'
curl -sS http://127.0.0.1:3000/transactions \
  -H 'Content-Type: application/json' \
  -d "{\"account_id\":\"$ACCOUNT_ID\",\"type\":\"credit\",\"amount\":100,\"reference_id\":\"deposit-1\"}"
curl -sS http://127.0.0.1:3000/transactions \
  -H 'Content-Type: application/json' \
  -d "{\"account_id\":\"$ACCOUNT_ID\",\"type\":\"debit\",\"amount\":30,\"reference_id\":\"purchase-1\"}"
curl -sS "http://127.0.0.1:3000/accounts/$ACCOUNT_ID/balance"
curl -sS "http://127.0.0.1:3000/accounts/$ACCOUNT_ID/transactions?type=debit&page=1&limit=20"
```

The resulting balance is `70`. Repeating a reference for that account returns `409` without another financial effect.

## Verification

```sh
npm run db:validate
npm run typecheck
npm run build
npm test
```

Tests use isolated temporary SQLite files with the actual migration, not a mocked database. They include failed-write rollback, database constraints, duplicate races, and concurrent debits through independent database clients. Node may print an experimental warning for its built-in SQLite test helper. There is no separate linter configured; TypeScript checking is available above.

## Documentation

- [Original assignment](docs/ASSIGNMENT_SOURCE.md)
- [Implementation plan and verification progress](docs/IMPLEMENTATION_PLAN.md)
- [API reference](docs/API.md)
- [Assumptions and limitations](docs/ASSUMPTIONS.md)

This local assessment has no authentication or authorization. Public financial use requires access control and operational safeguards.

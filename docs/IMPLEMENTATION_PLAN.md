# LedgerLite implementation plan

## Inspection
The directory was empty, with no Git repository, application, tests, secrets, or repository instructions. Preserve the directory name. Initialize Git here; root alone creates commits. Node 24.2.0 and npm 11.4.1 are available.

## Stack and architecture
Node.js >=22, TypeScript, Express 5, Prisma 6, SQLite, Zod, Vitest 5, Supertest. Small feature routers with injected PrismaClient; no frontend or authentication subsystem. Integer minor units persisted; API accepts JSON numbers with at most two decimals and returns numbers in major units. Bound amount and resulting balance to 2,147,483,647 minor units (Prisma Int range).

## Frozen schema and contracts
- Account: UUID `id`, required trimmed `name`, `balance` integer default zero, `created_at` system timestamp.
- Transaction: UUID `id`, `account_id` FK restrictive delete/update, `type` credit/debit, positive integer `amount`, `description`, nonempty `reference_id`, system `created_at`.
- Database CHECK constraints on amount, balance, type, required strings; unique `(account_id, reference_id)`; indexes `(account_id, created_at, id)` and `(account_id, type, created_at, id)`.
- POST /accounts `{name}` -> 201 `{data:{id,name,balance,created_at}}`.
- GET /accounts/:accountId/balance -> 200 `{data:{account_id,balance}}`.
- POST /transactions `{account_id,type,amount,description,reference_id}` -> 201 `{data:transaction}`; description optional default empty.
- GET /accounts/:accountId/transactions?type=credit|debit&page=1&limit=20 -> 200 `{data:transaction[],pagination:{page,limit,total,total_pages}}`; max limit 100, max page 1,000,000. Sort created_at DESC then id DESC.
- Strict objects reject extra keys/server-controlled fields. UUIDs required; malformed UUID 400, absent valid UUID 404. Error `{error:{code,message,details?}}`; validation 400, missing 404, duplicate/insufficient funds/balance limit 409, unexpected 500, temporary DB contention 503. Unknown endpoints 404.
- Shared exports: `AppError(status,code,message,details?)`, `accountIdSchema`, `amountSchema` (major-unit number -> minor-unit integer), `MAX_MINOR`, `accountJson`, `transactionJson`, `createApp(db)`.
- Feature router exports: `accountsRouter(db)`, `transactionsRouter(db)`, `historyRouter(db)`.
- Atomic writes use Prisma transaction, conditional balance update, unique insert and rollback. No editable/deletable transaction API. SQLite serializes writers; no process-local financial locks. Test real file-backed SQLite, including separate clients.

## Dependencies, ownership and concurrency
| Priority / milestone | Owner | Exclusive files | Dependencies / acceptance |
|---|---|---|---|
| P0 source and plan | root | docs/ASSIGNMENT_SOURCE.md, docs/IMPLEMENTATION_PLAN.md | Save before implementation |
| P0 foundation | root | package*, tsconfig*, vitest*, prisma/**, src/app.ts, src/server.ts, src/db.ts, src/shared.ts, tests/helpers.ts, tests/foundation.test.ts, scripts/migrate.cjs, .gitignore, .env.example | migration, generated client, typecheck and foundation checks pass |
| P0 accounts | agent A | src/accounts.ts, tests/accounts.test.ts | foundation; required names, forced zero, IDs/times, correct reads/404; tests pass |
| P0/P1 transaction writes | agent B | src/transactions.ts, tests/transactions.test.ts | foundation; atomic credit/debit, unique refs, no overdraft, safe validation/errors; tests pass |
| P0 history | agent C | src/history.ts, tests/history.test.ts | foundation; filters, deterministic latest first, bounded pagination, metadata, missing accounts; tests pass |
| P1 integration/integrity | root | tests/integrity.test.ts, shared root-owned files | all agents; rollback injection, database constraints, concurrency, immutability; complete suite passes |
| P0 documentation | root | README.md, docs/API.md, docs/ASSUMPTIONS.md | verify actual implementation and runnable commands |
| P2 transfers | root | src/transfers.ts, tests/transfers.test.ts and wiring/docs | only after mandatory suite and documentation pass; atomic two-account changes, duplicate protection, rollback tests |

Agents A/B/C run concurrently only after foundation is frozen. Shared directory, strict file ownership, no agent commits. Root reviews all diffs, resolves contracts and runs tests before each feature commit.

## Commit checkpoints
1. `docs: preserve assignment specification and implementation plan`
2. `chore: configure application and database` after migration, foundation tests, typecheck/build.
3. `feat(accounts): implement account creation and balance retrieval` after account tests.
4. `feat(transactions): add atomic credit and debit operations` after write tests.
5. `feat(history): implement filtering and pagination` after history tests.
6. `test: cover ledger integrity and failure scenarios` after integration suite.
7. `docs: add API documentation and setup instructions` after startup smoke test.
8. Optional `feat(transfers): implement atomic account transfers` after all bonus tests.

## Verification
`npm ci`, `npm run db:generate`, `npm run db:migrate`, `npm run db:validate`, `npm run typecheck`, `npm run build`, `npm test`; targeted `npx vitest run tests/<feature>.test.ts`. Smoke `npm start` with HTTP requests. No lint command unless a linter is configured. Verify clean install/migrations against a fresh DB. Review staged diff and `git diff --check`, verify no secrets or generated DBs tracked, check `git status --short --branch` and `git log --oneline`.

## Progress
- [x] Inspected empty directory and Git state; saved full original assignment (preserving original missing section 6).
- [x] Saved executable plan and frozen contracts before feature implementation.
- [x] Foundation verified: Prisma generation/validation, fresh migration and idempotent reapply, typecheck/build, 3 foundation tests. Patched tooling dependencies; npm install audit reports zero vulnerabilities.
- [x] Accounts verified: all 18 HTTP tests passed; committed with route wiring.
- [x] Transaction writes verified: all 35 HTTP tests passed; committed with route wiring.
- [ ] History verified and committed.
- [ ] Mandatory integrity suite passed.
- [ ] Documentation and startup verified.
- [ ] Optional transfers decision and final verification.

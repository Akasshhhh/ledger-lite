CREATE TABLE "Account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL CHECK(length(trim("name")) BETWEEN 1 AND 200),
  "balance" INTEGER NOT NULL DEFAULT 0 CHECK(typeof("balance") = 'integer' AND "balance" BETWEEN 0 AND 2147483647),
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Transaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK("type" IN ('credit', 'debit')),
  "amount" INTEGER NOT NULL CHECK(typeof("amount") = 'integer' AND "amount" BETWEEN 1 AND 2147483647),
  "description" TEXT NOT NULL DEFAULT '',
  "reference_id" TEXT NOT NULL CHECK(length(trim("reference_id")) BETWEEN 1 AND 200),
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Transaction_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "Transaction_account_id_reference_id_key" ON "Transaction"("account_id", "reference_id");
CREATE INDEX "Transaction_account_id_created_at_id_idx" ON "Transaction"("account_id", "created_at", "id");
CREATE INDEX "Transaction_account_id_type_created_at_id_idx" ON "Transaction"("account_id", "type", "created_at", "id");

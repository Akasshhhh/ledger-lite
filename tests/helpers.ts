import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PrismaClient } from '@prisma/client';

export async function testDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'ledgerlite-'));
  const path = join(dir, 'test.db');
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync('prisma/migrations/202610280001_init/migration.sql', 'utf8'));
  sqlite.close();
  const url = `file:${path}`;
  const db = new PrismaClient({ datasources: { db: { url } } });
  await db.$connect();
  return { db, url, async cleanup() { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); } };
}

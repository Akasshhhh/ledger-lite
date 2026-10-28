require('dotenv/config');
const { closeSync, mkdirSync, openSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
process.env.DATABASE_URL ??= 'file:./dev.db';
if (!process.env.DATABASE_URL.startsWith('file:')) throw new Error('DATABASE_URL must point to a SQLite file');
// Prisma 6's schema engine requires the SQLite file to exist before deploy.
const path = resolve(__dirname, '../prisma', decodeURIComponent(process.env.DATABASE_URL.slice(5).split('?')[0]));
mkdirSync(dirname(path), { recursive: true });
closeSync(openSync(path, 'a'));
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

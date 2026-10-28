import { createApp } from './app';
import { db } from './db';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
const host = process.env.HOST ?? '127.0.0.1';
const server = createApp(db).listen(port, host, () => console.log(`LedgerLite listening on http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => { void db.$disconnect().then(() => process.exit(0)); });
  });
}

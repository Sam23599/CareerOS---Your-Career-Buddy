import { MongoClient } from 'mongodb';
import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const client = new MongoClient(config.mongoUri, {
  serverSelectionTimeoutMS: 2000,
  connectTimeoutMS: 2000,
});
const app = createApp(async () => {
  await client.db().command({ ping: 1 }, { timeoutMS: 2000 });
});
const server = app.listen(config.port, config.host, () => {
  console.info(JSON.stringify({ event: 'server_started', host: config.host, port: config.port }));
});
server.on('error', async (error: NodeJS.ErrnoException) => {
  console.error(JSON.stringify({ event: 'server_error', code: error.code }));
  await client.close();
  process.exit(1);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10_000);
  timeout.unref();
  server.close(() => {
    void client.close().then(() => {
      clearTimeout(timeout);
      process.exit(0);
    }).catch(() => process.exit(1));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

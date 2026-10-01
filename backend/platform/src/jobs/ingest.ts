import { MongoClient } from 'mongodb';
import { JobStore } from './store.js';
import { FixtureSource, RemotiveSource } from './sources.js';

const source = process.argv[2];
if (!['remotive', 'fixture'].includes(source)) throw new Error('Usage: npm run jobs:ingest -- remotive|fixture');
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required.');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, timeoutMS: 30_000 });
try {
  const store = new JobStore(client.db()); await store.initialize();
  console.info(JSON.stringify(await store.ingest(source === 'remotive' ? new RemotiveSource() : new FixtureSource())));
} finally { await client.close(); }

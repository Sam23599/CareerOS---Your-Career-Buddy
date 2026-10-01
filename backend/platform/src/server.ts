import { SavedJobStore } from './saved-jobs/store.js';
import { startJobScheduler } from './jobs/scheduler.js';
import { JobStore } from './jobs/store.js';
import { RemotiveSource } from './jobs/sources.js';
import { ResumeStore } from './resumes/store.js';
import { LocalResumeStorage } from './resumes/storage.js';
import { MongoClient } from 'mongodb';
import { createApp } from './app.js';
import { readConfig } from './config.js';
import { AuthStore } from './auth/store.js';
import { AuthService } from './auth/service.js';
import { Tokens } from './auth/tokens.js';
import { ProfileStore } from './profiles/store.js';
import { createOAuthProviders } from './auth/oauth-providers.js';
import { CareerSourceStore } from './career-sources/store.js';
import { NotificationService, NotificationStore } from './notifications/store.js';

const config = readConfig();
const client = new MongoClient(config.mongoUri, {
  serverSelectionTimeoutMS: 2000,
  connectTimeoutMS: 2000,
  timeoutMS: 5000,
});
const savedJobs = new SavedJobStore(client.db());
const jobs = new JobStore(client.db());
const notifications = new NotificationStore(client.db());
const careerSources = new CareerSourceStore(client.db(), jobs, new NotificationService(notifications));
const jobSources = [new RemotiveSource()];
const store = new AuthStore(client.db());
const service = new AuthService(store, new Tokens(config.authSecret));
const app = createApp(async () => {
  await store.initialize();
  await jobs.initialize();
  await savedJobs.initialize();
  await careerSources.initialize();
  await notifications.initialize();
  await client.db().command({ ping: 1 }, { timeoutMS: 2000 });
}, { service, allowedOrigins: config.allowedOrigins, secureCookie: config.secureCookie, oauth: { providers: createOAuthProviders(config.oauth), publicOrigin: config.oauth.publicOrigin } }, new ProfileStore(client.db()), new ResumeStore(client.db(), new LocalResumeStorage(process.env.RESUME_STORAGE_DIR || './data/resumes')), { store: jobs, sources: jobSources }, savedJobs, { careerSources, notifications });
const server = app.listen(config.port, config.host, () => {
  console.info(JSON.stringify({ event: 'server_started', host: config.host, port: config.port }));
});
const stopJobScheduler = startJobScheduler(jobs, jobSources, () => careerSources.refreshDue());
server.on('error', async (error: NodeJS.ErrnoException) => {
  console.error(JSON.stringify({ event: 'server_error', code: error.code }));
  await stopJobScheduler();
  await client.close();
  process.exit(1);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 30_000);
  timeout.unref();
  server.close(() => {
    void stopJobScheduler().then(() => client.close()).then(() => {
      clearTimeout(timeout);
      process.exit(0);
    }).catch(() => process.exit(1));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

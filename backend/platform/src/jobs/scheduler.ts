import { ApiError } from '../errors.js';
import { type JobSource } from './model.js';
import { type JobStore } from './store.js';

type Store = Pick<JobStore, 'initialize' | 'nextRefreshAt' | 'ingest'>;
export async function refreshDueJobs(store: Store, sources: JobSource[]) {
  await store.initialize();
  for (const source of sources) {
    try {
      if ((await store.nextRefreshAt(source)).getTime() > Date.now()) continue;
      const result = await store.ingest(source);
      console.info(JSON.stringify({ event: 'scheduled_job_refresh', ...result }));
    } catch (error) {
      // Another API instance or manual refresh may have acquired the source first.
      if (error instanceof ApiError && error.status === 409) continue;
      console.error(JSON.stringify({ event: 'scheduled_job_refresh_failed', source: source.id }));
    }
  }
}
export function startJobScheduler(store: Store, sources: JobSource[]) {
  let stopped = false;
  let pending: Promise<void> | undefined;
  function tick() {
    if (stopped || pending) return;
    pending = refreshDueJobs(store, sources)
      .catch(() => console.error(JSON.stringify({ event: 'job_scheduler_unavailable' })))
      .finally(() => { pending = undefined; });
  }
  // Check persisted due times so restarts and manual imports do not reset the schedule.
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await pending; };
}

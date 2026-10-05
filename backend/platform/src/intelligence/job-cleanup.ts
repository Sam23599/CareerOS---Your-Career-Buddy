import { type Db } from 'mongodb';
import { ApiError } from '../errors.js';
import { type JobStore } from '../jobs/store.js';
import { type IntelligenceClient } from './client.js';

type SourceReference = { _id: string; owner: string; jobId: string };
export class JobAnalysisCleanup {
  private references;
  private cursor = '';
  private active: Promise<void> | null = null;
  private timer?: NodeJS.Timeout;
  constructor(db: Db, private jobs: JobStore, private client: IntelligenceClient) {
    this.references = db.collection<SourceReference>('job_analysis_sources');
  }
  async track(owner: string, jobId: string) {
    await this.references.updateOne({ _id: `${owner}:${jobId}` }, { $setOnInsert: { owner, jobId } }, { upsert: true });
  }
  start() {
    void this.flush();
    this.timer = setInterval(() => { void this.flush(); }, 30_000);
    this.timer.unref();
  }
  async stop() { clearInterval(this.timer); await this.active; }
  flush(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.run().catch(() => { console.warn(JSON.stringify({ event: 'job_analysis_cleanup_pending' })); })
      .finally(() => { this.active = null; });
    return this.active;
  }
  private async run() {
    if (!this.client.configured) return;
    const page = await this.references.find({ _id: { $gt: this.cursor } }).sort({ _id: 1 }).limit(25).toArray();
    for (const item of page) {
      try { await this.jobs.get(item.jobId); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'JOB_NOT_FOUND') throw error;
        await this.client.deleteJobAnalyses(item.owner, item.jobId);
        await this.references.deleteOne({ _id: item._id });
      }
      this.cursor = item._id;
    }
    if (page.length < 25) this.cursor = '';
  }
}

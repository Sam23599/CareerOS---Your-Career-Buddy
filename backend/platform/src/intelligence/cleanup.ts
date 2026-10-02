import { type Db } from 'mongodb';
import { type IntelligenceClient } from './client.js';

type PendingCleanup = { _id: string; owner: string; resumeId: string };
export class AnalysisCleanup {
  private queue;
  private active: Promise<void> | null = null;
  private timer?: NodeJS.Timeout;
  constructor(db: Db, private client: IntelligenceClient) {
    this.queue = db.collection<PendingCleanup>('intelligence_cleanup');
  }
  async enqueue(owner: string, resumeId: string) {
    await this.queue.updateOne({ _id: `${owner}:${resumeId}` }, { $setOnInsert: { owner, resumeId } }, { upsert: true });
    void this.flush();
  }
  start() {
    void this.flush();
    this.timer = setInterval(() => { void this.flush(); }, 30_000);
    this.timer.unref();
  }
  async stop() {
    clearInterval(this.timer);
    await this.active;
  }
  flush(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.run().catch(() => {
      console.warn(JSON.stringify({ event: 'analysis_cleanup_pending' }));
    }).finally(() => { this.active = null; });
    return this.active;
  }
  private async run() {
    if (!this.client.configured) return;
    const pending = await this.queue.find().limit(50).toArray();
    for (const item of pending) {
      await this.client.deleteDrafts(item.owner, item.resumeId);
      await this.queue.deleteOne({ _id: item._id });
    }
  }
}

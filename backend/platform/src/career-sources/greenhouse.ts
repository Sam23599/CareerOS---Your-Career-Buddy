import { type JobInput, type JobSource, validateJob } from '../jobs/model.js';
import { plainText } from '../jobs/sources.js';

export function greenhouseBoard(url: URL) {
  if (!['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(url.hostname) || url.protocol !== 'https:' || url.port) return null;
  const match = /^\/([a-z0-9_-]{1,100})\/?$/i.exec(url.pathname);
  return match && !url.search ? match[1].toLowerCase() : null;
}
async function json(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000), redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok || !response.body) throw new Error('Career source is unavailable.');
  const chunks: Uint8Array[] = []; let size = 0; const reader = response.body.getReader();
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 20 * 1024 * 1024) throw new Error('Source response too large.'); chunks.push(value); } }
  finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export function normalizeGreenhouse(payload: unknown, company: string): JobInput[] {
  if (!payload || typeof payload !== 'object' || !('jobs' in payload) || !Array.isArray(payload.jobs) || payload.jobs.length > 10_000) throw new Error('Invalid Greenhouse feed.');
  if (!('meta' in payload) || !payload.meta || typeof payload.meta !== 'object' || !('total' in payload.meta) || payload.meta.total !== payload.jobs.length) throw new Error('Incomplete Greenhouse feed.');
  return payload.jobs.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid job.');
    const item = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || (item.id as number) <= 0 || typeof item.title !== 'string' || typeof item.absolute_url !== 'string' || typeof item.content !== 'string') throw new Error('Invalid job.');
    // Greenhouse may encode the HTML more than once. Render the result as plain text.
    let description = item.content;
    for (let i = 0; i < 3; i++) description = plainText(description);
    const location = item.location && typeof item.location === 'object' && 'name' in item.location && typeof item.location.name === 'string' ? item.location.name : '';
    const job: JobInput = { sourceId: String(item.id), title: item.title.trim(), company, description, location, employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', skills: [], sourceUrl: item.absolute_url, postedAt: null, expiresAt: null, metadata: {} };
    validateJob(job); return job;
  });
}
export class GreenhouseSource implements JobSource {
  readonly id; readonly name = 'Greenhouse'; readonly cooldownMs = 60 * 60 * 1000; readonly reconcileMissing = true;
  constructor(private board: string, private fetcher: typeof fetch = fetch) {
    if (!/^[a-z0-9_-]{1,100}$/i.test(board)) throw new Error('Invalid board token.');
    this.id = `greenhouse:${board.toLowerCase()}`;
  }
  async fetchJobs() {
    const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(this.board)}`;
    const [board, jobs] = await Promise.all([json(endpoint, this.fetcher), json(`${endpoint}/jobs?content=true`, this.fetcher)]);
    if (!board || typeof board !== 'object' || !('name' in board) || typeof board.name !== 'string' || !board.name.trim()) throw new Error('Invalid board identity.');
    return normalizeGreenhouse(jobs, board.name.trim());
  }
}

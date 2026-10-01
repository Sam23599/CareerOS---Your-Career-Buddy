import { type JobInput, type JobSource, validateJob } from './model.js';

export function plainText(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<\/(?:p|div|h[1-6]|li)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity]!)
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity; })
    .replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}
function required(value: unknown) { if (typeof value !== 'string') throw new Error('Invalid source text.'); return value.trim(); }
export function normalizeRemotive(payload: unknown): JobInput[] {
  if (!payload || typeof payload !== 'object' || !('jobs' in payload) || !Array.isArray(payload.jobs) || payload.jobs.length > 10_000) throw new Error('Invalid source response.');
  return payload.jobs.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid source job.');
    const item = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || (item.id as number) <= 0) throw new Error('Invalid source ID.');
    const url = new URL(required(item.url));
    if (url.hostname !== 'remotive.com' || url.protocol !== 'https:') throw new Error('Invalid source link.');
    const date = required(item.publication_date);
    const types: Record<string, JobInput['employmentType']> = { full_time: 'FULL_TIME', part_time: 'PART_TIME', contract: 'CONTRACT', internship: 'INTERNSHIP', temporary: 'TEMPORARY', other: 'OTHER' };
    const job: JobInput = {
      sourceId: String(item.id), title: required(item.title), company: required(item.company_name),
      description: plainText(required(item.description)), location: typeof item.candidate_required_location === 'string' ? item.candidate_required_location.trim() : '',
      employmentType: typeof item.job_type === 'string' ? types[item.job_type] ?? 'UNKNOWN' : 'UNKNOWN', remoteType: 'REMOTE',
      skills: Array.isArray(item.tags) ? [...new Set(item.tags.map(required))] : [], sourceUrl: url.href,
      postedAt: date ? new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(date) ? date : `${date}Z`) : null, expiresAt: null,
      metadata: { category: typeof item.category === 'string' ? item.category.slice(0, 200) : '', salary: typeof item.salary === 'string' ? item.salary.slice(0, 1000) : '' },
    };
    validateJob(job); return job;
  });
}
export class RemotiveSource implements JobSource {
  id = 'remotive'; name = 'Remotive'; cooldownMs = 4 * 60 * 60 * 1000;
  constructor(private fetcher: typeof fetch = fetch) {}
  async fetchJobs() {
    const response = await this.fetcher('https://remotive.com/api/remote-jobs', { signal: AbortSignal.timeout(20_000), redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok || !response.body) throw new Error(`Source returned HTTP ${response.status}.`);
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 20 * 1024 * 1024) throw new Error('Source response too large.'); chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return normalizeRemotive(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }
}
// Deterministic adapter for tests and explicitly requested local demos only.
export class FixtureSource implements JobSource {
  id = 'fixture'; name = 'Demo fixtures'; cooldownMs = 0;
  constructor(private jobs: JobInput[] = [{ sourceId: 'backend-demo', title: 'Demo Backend Engineer', company: 'Example Company (demo)', description: 'A sample role for testing job search. This is not a real vacancy.', location: 'Worldwide', employmentType: 'FULL_TIME', remoteType: 'REMOTE', skills: ['TypeScript', 'MongoDB'], sourceUrl: 'https://example.com/jobs/backend', postedAt: null, expiresAt: null, metadata: {} }]) {}
  async fetchJobs() { return this.jobs; }
}

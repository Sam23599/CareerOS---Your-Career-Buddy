import { type JobInput, type JobSource, validateJob } from '../jobs/model.js';
import { plainText } from '../jobs/sources.js';
import { sourceText } from './http.js';

export const googleCareersUrl = 'https://www.google.com/about/careers/applications/jobs/results/';
export function isGoogleCareers(url: URL) {
  if (url.protocol !== 'https:' || url.port) return false;
  return (url.hostname === 'careers.google.com' && /^\/(?:jobs\/?)?$/.test(url.pathname)) ||
    (['google.com', 'www.google.com'].includes(url.hostname) && /^\/about\/careers(?:\/applications(?:\/jobs\/results)?)?\/?$/.test(url.pathname));
}
export function normalizeGoogle(html: string): JobInput[] {
  // Parse only the public listing data. Never evaluate downloaded scripts or use sign-in links.
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).find(value => /^\s*AF_initDataCallback\(\{key:\s*['"]ds:1['"]/.test(value));
  const json = script && /\bdata:([\s\S]*),\s*sideChannel:/.exec(script)?.[1];
  if (!json) throw new Error('Google careers listing format changed.');
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data) || !Array.isArray(data[0]) || !Number.isSafeInteger(data[2]) || data[2] < 0 || data[3] !== 20 || data[0].length !== Math.min(data[2], 20)) throw new Error('Invalid Google careers listing.');
  const links = new Map([...html.matchAll(/href=["'](?:https:\/\/www\.google\.com\/about\/careers\/applications\/)?jobs\/results\/([0-9]{1,30})(-[a-z0-9-]+)?(?:\?[^"']*)?["']/gi)].map(match => [match[1], `${googleCareersUrl}${match[1]}${match[2] ?? ''}`]));
  return data[0].map((raw: unknown) => {
    if (!Array.isArray(raw) || typeof raw[0] !== 'string' || !/^[0-9]{1,30}$/.test(raw[0]) || typeof raw[1] !== 'string' || typeof raw[7] !== 'string' || !Array.isArray(raw[9])) throw new Error('Invalid Google careers job.');
    const locations = raw[9].map((value: unknown) => { if (!Array.isArray(value) || typeof value[0] !== 'string') throw new Error('Invalid Google careers location.'); return value[0]; });
    const text = (index: number) => { const value: unknown = raw[index]; if (value == null) return ''; if (!Array.isArray(value) || typeof value[1] !== 'string') throw new Error('Invalid Google careers description.'); return plainText(value[1]); };
    const sourceUrl = links.get(raw[0]); if (!sourceUrl) throw new Error('Missing Google careers job link.');
    const job: JobInput = { sourceId: raw[0], title: raw[1].trim(), company: raw[7].trim(), description: [text(4), text(10), text(3), text(15)].filter(Boolean).join('\n\n'), location: [...new Set(locations)].join('; '), employmentType: 'UNKNOWN', remoteType: 'UNKNOWN', skills: [], sourceUrl, postedAt: null, expiresAt: null, metadata: { coverage: 'limited' } };
    validateJob(job); return job;
  });
}
export class GoogleCareersSource implements JobSource {
  readonly id = 'google-careers'; readonly name = 'Google Careers'; readonly cooldownMs = 60 * 60 * 1000;
  // Google's robots.txt disallows automatic pagination. A first-page snapshot cannot prove removal.
  readonly reconcileMissing = false;
  constructor(private fetcher: typeof fetch = fetch) {}
  async fetchJobs() { return normalizeGoogle(await sourceText(googleCareersUrl, this.fetcher)); }
}

import { ApiError } from '../errors.js';
import { type JobSource } from '../jobs/model.js';
import { GreenhouseSource, greenhouseBoard } from './greenhouse.js';
import { GoogleCareersSource, googleCareersUrl, isGoogleCareers } from './google.js';

export type SourceDefinition = { provider: 'greenhouse' | 'google-careers'; key: string; sourceId: string; name: string; careerUrl: string; coverage: 'complete' | 'limited' };
// Bump when recognition changes so saved links are reassessed without losing user settings.
export const registryVersion = 2;
type Registration = { detect: (url: URL) => SourceDefinition | null; create: (source: SourceDefinition) => JobSource };
const adapters: Registration[] = [
  { detect: url => { const board = greenhouseBoard(url); return board ? { provider: 'greenhouse', key: board, sourceId: `greenhouse:${board}`, name: 'Greenhouse', careerUrl: `https://job-boards.greenhouse.io/${board}`, coverage: 'complete' } : null; }, create: source => new GreenhouseSource(source.key) },
  { detect: url => isGoogleCareers(url) ? { provider: 'google-careers', key: 'google', sourceId: 'google-careers', name: 'Google Careers', careerUrl: googleCareersUrl, coverage: 'limited' } : null, create: () => new GoogleCareersSource() },
];
export function careerUrl(value: unknown): URL {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new ApiError(400, 'INVALID_CAREER_SOURCE', 'Provide a valid HTTPS career page URL.');
  let url: URL; try { url = new URL(value.trim()); } catch { throw new ApiError(400, 'INVALID_CAREER_SOURCE', 'Provide a valid HTTPS career page URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) throw new ApiError(400, 'INVALID_CAREER_SOURCE', 'Provide a public HTTPS career page URL without credentials.');
  url.hash = ''; return url;
}
export function detectSource(url: URL): SourceDefinition | null {
  for (const adapter of adapters) { const source = adapter.detect(url); if (source) return source; }
  return null;
}
export function createSource(source: SourceDefinition): JobSource {
  const registration = adapters.find(adapter => adapter.detect(new URL(source.careerUrl))?.provider === source.provider);
  if (!registration) throw new Error('Unsupported source provider.');
  return registration.create(source);
}
export function sourceSupport(value: unknown) {
  const url = careerUrl(value), source = detectSource(url);
  return { provider: source?.provider ?? null, providerName: source?.name ?? null, sourceId: source?.sourceId ?? null, careerUrl: source?.careerUrl ?? url.href, coverage: source?.coverage ?? 'link', canRefresh: Boolean(source), message: source?.coverage === 'limited' ? 'Google Careers imports the first 20 unfiltered public results only. Your filters apply to this snapshot; other matching jobs may be absent.' : source ? `${source.name} detected. Job refresh and scheduled checks are supported.` : 'CareerOS does not support job tracking for this page yet. You can save it as a career bookmark.' };
}

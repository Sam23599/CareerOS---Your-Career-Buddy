import { TaskVerifier } from './tasks.js';
import { ApiError } from '../errors.js';
import { MAX_RESUME_BYTES } from '../resumes/store.js';
import { validateDraft, validateHistory, type Source } from './drafts.js';
import { JobAnalysisVerifier, type JobSource } from './jobs.js';
import { MatchVerifier, type ProfileSkills } from './matching.js';
import { type DraftRecord } from './drafts.js';
import { type JobAnalysisRecord } from './jobs.js';
import { ReviewVerifier } from './reviews.js';

const MAX_OUTPUT = 2 * 1024 * 1024;
const MAX_CHARACTERS = 200_000;
const REPAIR_WARNING = 'Minor PDF structure issues were corrected during extraction. Review the text against your original PDF.';
export type Extraction = {
  schemaVersion: 1; parser: { name: 'pypdf'; version: string }; status: 'extracted' | 'no_text';
  pageCount: number; pages: { number: number; text: string }[]; text: string;
  warnings: { code: 'NO_EXTRACTABLE_TEXT' | 'PAGES_WITHOUT_TEXT' | 'PDF_STRUCTURE_REPAIRED'; message: string }[];
};
const unavailable = () => new ApiError(503, 'INTELLIGENCE_UNAVAILABLE', 'Resume text extraction is temporarily unavailable.');
const invalid = () => new ApiError(502, 'INTELLIGENCE_RESPONSE_INVALID', 'The extractor returned an invalid result. Please retry.');
const upstreamErrors: Record<string, [number, string]> = {
  EXTRACTION_LIMIT: [413, 'This PDF exceeds the extraction size, page or text limit.'],
  INVALID_PDF: [422, 'This PDF could not be read. Try another version.'],
  PDF_ENCRYPTED: [422, 'Password-protected PDFs are not supported yet.'],
  INTELLIGENCE_BUSY: [503, 'The extractor is busy. Please try again shortly.'],
  PARSER_RESOURCE_LIMIT: [503, 'This PDF exceeded the parser memory limit. Try a simpler version.'],
  INTELLIGENCE_TIMEOUT: [504, 'Extraction took too long. Try a simpler PDF.'],
  INTELLIGENCE_UNAVAILABLE: [503, 'Resume text extraction is temporarily unavailable.'],
  INVALID_INPUT: [400, 'The analysis request is invalid.'],
  ANALYSIS_UNAVAILABLE: [503, 'Analysis is temporarily unavailable. Check AI and analysis storage configuration.'],
  ANALYSIS_NOT_FOUND: [404, 'No saved draft is available for this resume.'],
  RESUME_NOT_FOUND: [404, 'Resume not found.'],
  NO_EXTRACTABLE_TEXT: [422, 'No readable text was found. Upload a text-based PDF.'],
  LLM_TIMEOUT: [504, 'Analysis took too long. Please retry.'],
  LLM_RATE_LIMITED: [429, 'The AI provider is busy. Please try again later.'],
  LLM_BUDGET_LIMIT: [413, 'This source exceeds the configured AI input or output limit. Try a shorter version.'],
  LLM_RESPONSE_INVALID: [502, 'The AI result could not be validated. Please retry.'],
  LLM_REFUSED: [422, 'The AI provider could not analyze this source.'],
  JOB_NOT_FOUND: [404, 'Job not found.'],
  JOB_ANALYSIS_NOT_FOUND: [404, 'No saved analysis is available for this job.'],
  JOB_TEXT_EMPTY: [422, 'This listing has no description to analyze.'],
  JOB_ANALYSIS_STALE: [409, 'This listing changed. Analyze its current description before matching.'],
  MATCH_SOURCE_CHANGED: [409, 'A comparison input changed. Reload the inputs and compare again.'],
  MATCHING_LIMIT: [413, 'This comparison exceeds the supported size limit.'],
  REVIEW_LIMIT: [413, 'This review exceeds the supported size limit.'],
};

function fields(value: unknown, names: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...names].sort().join(',');
}
function validText(value: unknown): value is string {
  return typeof value === 'string' && [...value].length <= MAX_CHARACTERS && !/[\r\0]/.test(value);
}
export function validateExtraction(value: unknown): Extraction {
  if (!fields(value, ['schemaVersion', 'parser', 'status', 'pageCount', 'pages', 'text', 'warnings'])
    || value.schemaVersion !== 1 || !fields(value.parser, ['name', 'version']) || value.parser.name !== 'pypdf'
    || typeof value.parser.version !== 'string' || !/^\d+\.\d+\.\d+[a-zA-Z0-9.+-]*$/.test(value.parser.version) || value.parser.version.length > 50
    || !Number.isInteger(value.pageCount) || (value.pageCount as number) < 1 || (value.pageCount as number) > 50
    || !Array.isArray(value.pages) || value.pages.length !== value.pageCount || !validText(value.text)
    || !Array.isArray(value.warnings) || value.warnings.length > 2) throw invalid();
  const pages = value.pages;
  if (pages.some((page, i) => !fields(page, ['number', 'text']) || page.number !== i + 1 || !validText(page.text))
    || value.text !== pages.map(page => page.text).join('\n\n')) throw invalid();
  const readable = pages.some(page => page.text.trim().length > 0);
  if (value.status !== (readable ? 'extracted' : 'no_text')) throw invalid();
  const warningCode = !readable ? 'NO_EXTRACTABLE_TEXT' : pages.some(page => !page.text.trim()) ? 'PAGES_WITHOUT_TEXT' : null;
  const codes = new Set<string>();
  for (const warning of value.warnings) {
    if (!fields(warning, ['code', 'message']) || typeof warning.code !== 'string' || codes.has(warning.code)
      || typeof warning.message !== 'string' || !warning.message || warning.message.length > 300
      || (warning.code === 'PDF_STRUCTURE_REPAIRED' ? warning.message !== REPAIR_WARNING : warning.code !== warningCode)) throw invalid();
    codes.add(warning.code);
  }
  if (warningCode && !codes.has(warningCode)) throw invalid();
  return value as unknown as Extraction;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') || !response.body) throw invalid();
  const length = Number(response.headers.get('content-length'));
  if (length > MAX_OUTPUT) { await response.body.cancel(); throw invalid(); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_OUTPUT) throw invalid();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof SyntaxError) throw invalid();
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class IntelligenceClient {
  readonly configured: boolean;
  private origin?: string;
  constructor(private settings: { url?: string; token?: string }, private fetcher: typeof fetch = fetch) {
    this.configured = Boolean(settings.url && settings.token);
    try {
      const url = new URL(settings.url ?? '');
      if (['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash
        && /^[a-f0-9]{64,}$/i.test(settings.token ?? '')) this.origin = url.origin;
    } catch { /* Invalid optional configuration must not disable the core app. */ }
  }
  private async request(path: string, options: RequestInit, signal?: AbortSignal, timeout = 15_000) {
    if (!this.configured || !this.origin) throw unavailable();
    const deadline = AbortSignal.timeout(timeout);
    try {
      const response = await this.fetcher(this.origin + path, {
        ...options, redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        headers: { ...options.headers, Authorization: `Bearer ${this.settings.token}` },
      });
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw unavailable(); }
      const body = await boundedJson(response);
      if (!response.ok) {
        if (!fields(body, ['error']) || !fields(body.error, ['code', 'message']) || typeof body.error.code !== 'string') throw invalid();
        const mapped = upstreamErrors[body.error.code];
        if (!mapped || mapped[0] !== response.status) throw invalid();
        throw new ApiError(mapped[0], body.error.code, mapped[1]);
      }
      if (response.status !== 200) throw invalid();
      return body;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (deadline.aborted) throw new ApiError(504, 'INTELLIGENCE_TIMEOUT', 'Extraction took too long. Please retry.');
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
  }
  async dependencies() {
    try {
      const body = await this.request('/internal/v1/dependencies', {}, undefined, 5000);
      if (!fields(body, ['intelligence', 'parser', 'postgresql', 'aiConfigured']) || Object.values(body).some(value => typeof value !== 'boolean')) throw invalid();
      return body as { intelligence: boolean; parser: boolean; postgresql: boolean; aiConfigured: boolean };
    } catch { return { intelligence: false, parser: false, postgresql: false, aiConfigured: false }; }
  }
  async status(signal?: AbortSignal) {
    let available = false;
    if (this.configured) {
      try {
        const body = await this.request('/internal/v1/ready', {}, signal, 2000);
        available = fields(body, ['status']) && body.status === 'ready';
      } catch { /* Availability is a feature status, not overall API readiness. */ }
    }
    return { resumeExtraction: { configured: this.configured, available } };
  }
  async extract(data: Buffer, requestId: string, signal: AbortSignal) {
    if (!data.length || data.length > MAX_RESUME_BYTES) throw new ApiError(413, 'EXTRACTION_LIMIT', 'This PDF exceeds the extraction size limit.');
    return validateExtraction(await this.request('/internal/v1/resumes/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Request-Id': requestId }, body: new Uint8Array(data),
    }, signal));
  }
  async capabilities(signal?: AbortSignal, jobs = false) {
    const body = await this.request(jobs ? '/internal/v1/jobs/capabilities' : '/internal/v1/capabilities', {}, signal, 2000);
    if (!fields(body, ['available', 'provider', 'models', 'defaultModel', 'defaultReasoning', 'limits'])
      || typeof body.available !== 'boolean' || body.provider !== 'openai' || !Array.isArray(body.models)
      || body.models.length !== 3 || typeof body.defaultModel !== 'string'
      || (body.defaultReasoning !== null && typeof body.defaultReasoning !== 'string')
      || !fields(body.limits, ['inputBytes', 'outputTokens', 'timeoutSeconds'])
      || body.limits.inputBytes !== 60_000 || body.limits.outputTokens !== 16_384 || body.limits.timeoutSeconds !== 90) throw invalid();
    // Never expose arbitrary provider URLs, tokens or provider-supplied configuration.
    const { modelOptions } = await import('./drafts.js');
    if (body.models.some((item: unknown) => !fields(item, ['id', 'reasoningOptions'])
      || typeof item.id !== 'string' || !Object.hasOwn(modelOptions, item.id)
      || JSON.stringify(item.reasoningOptions) !== JSON.stringify(modelOptions[item.id]))) throw invalid();
    return body;
  }
  private sourceHeaders(owner: string, source: Source) {
    return { 'X-Owner-Id': owner, 'X-Resume-Id': source.resumeId, 'X-Resume-Version': String(source.resumeVersion), 'X-Source-Sha256': source.sha256 };
  }
  async analyze(owner: string, source: Source, data: Buffer, options: { model: string; reasoning: string | null }, signal: AbortSignal, requestId?: string) {
    return validateDraft(await this.request('/internal/v1/resumes/analyze', {
      method: 'POST', headers: { ...this.sourceHeaders(owner, source), 'Content-Type': 'application/pdf',
        'X-LLM-Model': options.model, ...(options.reasoning === null ? {} : { 'X-LLM-Reasoning': options.reasoning }),
        ...(requestId ? { 'X-Request-Id': requestId } : {}) },
      body: new Uint8Array(data),
    }, signal, 140_000), source);
  }
  async draft(owner: string, source: Source, signal?: AbortSignal, analysisId?: string) {
    const record = validateDraft(await this.request(`/internal/v1/resumes/${source.resumeId}/draft`, {
      headers: { ...this.sourceHeaders(owner, source), ...(analysisId ? { 'X-Analysis-Id': analysisId } : {}) },
    }, signal), source);
    if (analysisId !== undefined && record.id !== analysisId) throw invalid();
    return record;
  }
  async deleteDrafts(owner: string, resumeId: string) {
    const body = await this.request(`/internal/v1/resumes/${resumeId}/draft`, {
      method: 'DELETE', headers: { 'X-Owner-Id': owner },
    });
    if (!fields(body, ['status']) || body.status !== 'deleted') throw invalid();
  }
  async draftHistory(owner: string, source: Source, beforeVersion?: number, signal?: AbortSignal) {
    const query = beforeVersion === undefined ? '' : `?beforeVersion=${beforeVersion}`;
    return validateHistory(await this.request(`/internal/v1/resumes/${source.resumeId}/drafts${query}`, {
      headers: this.sourceHeaders(owner, source),
    }, signal), beforeVersion);
  }
  private jobHeaders(owner: string, source: Pick<JobSource, 'jobId' | 'sha256'>) {
    return { 'X-Owner-Id': owner, 'X-Source-Sha256': source.sha256 };
  }
  async analyzeJob(owner: string, source: JobSource, options: { model: string; reasoning: string | null }, signal: AbortSignal) {
    const body = JSON.stringify(source);
    if (Buffer.byteLength(body) > 60_000) throw new ApiError(413, 'LLM_BUDGET_LIMIT', 'This listing exceeds the configured AI input limit.');
    return JobAnalysisVerifier.record(await this.request(`/internal/v1/jobs/${source.jobId}/analyze`, {
      method: 'POST', headers: { ...this.jobHeaders(owner, source), 'Content-Type': 'application/json',
        'X-LLM-Model': options.model, ...(options.reasoning === null ? {} : { 'X-LLM-Reasoning': options.reasoning }) }, body,
    }, signal, 140_000), source.jobId, source.sha256);
  }
  async jobAnalysis(owner: string, source: JobSource, analysisId?: string, signal?: AbortSignal) {
    return JobAnalysisVerifier.record(await this.request(`/internal/v1/jobs/${source.jobId}/analysis`, {
      headers: { ...this.jobHeaders(owner, source), ...(analysisId ? { 'X-Analysis-Id': analysisId } : {}) },
    }, signal), source.jobId, undefined, analysisId);
  }
  async jobHistory(owner: string, source: JobSource, beforeVersion?: number, signal?: AbortSignal) {
    const query = beforeVersion === undefined ? '' : `?beforeVersion=${beforeVersion}`;
    return JobAnalysisVerifier.history(await this.request(`/internal/v1/jobs/${source.jobId}/analyses${query}`, {
      headers: this.jobHeaders(owner, source),
    }, signal), beforeVersion);
  }
  async startJobTask(owner: string, source: JobSource, options: { model: string; reasoning: string | null }, requestKey: string) {
    const body = await this.request(`/internal/v1/jobs/${source.jobId}/tasks`, { method: 'POST',
      headers: { ...this.jobHeaders(owner, source), 'Content-Type': 'application/json', 'X-LLM-Model': options.model, 'X-Request-Key': requestKey,
        ...(options.reasoning === null ? {} : { 'X-LLM-Reasoning': options.reasoning }) }, body: JSON.stringify(source) });
    if (!fields(body, ['taskId']) || !TaskVerifier.uuid(body.taskId)) throw invalid();
    return body;
  }
  async tasks(owner: string, jobId?: string) {
    return TaskVerifier.history(await this.request(jobId ? `/internal/v1/jobs/${jobId}/tasks` : '/internal/v1/tasks', { headers: { 'X-Owner-Id': owner } }));
  }
  async cancelTask(owner: string, id: string) {
    if (!TaskVerifier.uuid(id)) throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid task ID.');
    const body = await this.request(`/internal/v1/tasks/${id}/cancel`, { method: 'POST', headers: { 'X-Owner-Id': owner } });
    if (!fields(body, ['status']) || body.status !== 'cancelled') throw invalid();
    return body;
  }
  async deleteJobAnalyses(owner: string, jobId: string) {
    const body = await this.request(`/internal/v1/jobs/${jobId}/analysis`, { method: 'DELETE', headers: { 'X-Owner-Id': owner } });
    if (!fields(body, ['status']) || body.status !== 'deleted') throw invalid();
  }
  async compare(owner: string, resume: DraftRecord, job: JobAnalysisRecord, profile: ProfileSkills | null, signal: AbortSignal) {
    return MatchVerifier.result(await this.request('/internal/v1/matching/compare', {
      method: 'POST', headers: { 'X-Owner-Id': owner, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: resume.source, draftId: resume.id, jobId: job.source.jobId,
        jobHash: job.source.sha256, jobAnalysisId: job.id, profile }),
    }, signal), resume, job, profile);
  }
  async review(owner: string, resume: DraftRecord, job: JobAnalysisRecord | null, profile: ProfileSkills | null, signal: AbortSignal) {
    return ReviewVerifier.result(await this.request('/internal/v1/resumes/review', {
      method: 'POST', headers: { 'X-Owner-Id': owner, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: resume.source, draftId: resume.id, job: job ? {
        jobId: job.source.jobId, jobHash: job.source.sha256, jobAnalysisId: job.id, profile,
      } : null }),
    }, signal), resume, job, profile);
  }
}

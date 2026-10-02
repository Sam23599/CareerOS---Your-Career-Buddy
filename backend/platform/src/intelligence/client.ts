import { ApiError } from '../errors.js';
import { MAX_RESUME_BYTES } from '../resumes/store.js';

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
}

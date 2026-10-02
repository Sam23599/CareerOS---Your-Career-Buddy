import { Ajv } from 'ajv';
import schema from './resume-draft.schema.json' with { type: 'json' };
import { ApiError } from '../errors.js';
import { validateExtraction, type Extraction } from './client.js';

export type Source = { resumeId: string; resumeVersion: number; sha256: string };
export type DraftRecord = {
  schemaVersion: 1; id: string; version: number; source: Source; status: 'ready'; analyzerVersion: 'resume-draft-v1';
  provider: 'openai'; model: string; reasoning: string | null; createdAt: string;
  usage: { inputTokens: number; outputTokens: number }; extraction: Extraction; draft: Record<string, unknown>;
};
export type DraftSummary = Pick<DraftRecord, 'id' | 'version' | 'model' | 'reasoning' | 'createdAt'>;
export type DraftHistory = { versions: DraftSummary[]; nextBeforeVersion: number | null };
const validate = new Ajv({ strict: true }).compile(schema);
export const modelOptions: Record<string, string[]> = {
  'gpt-4.1': [], 'gpt-6-luna': ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  'gpt-6.1-sol': ['low', 'medium', 'high', 'xhigh', 'max'],
};
export function validateModel(body: unknown): { model: string; reasoning: string | null } {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'model,reasoning') throw new ApiError(400, 'INVALID_INPUT', 'Choose a supported model and reasoning option.');
  const { model, reasoning } = body as { model: unknown; reasoning: unknown };
  if (typeof model !== 'string' || !Object.hasOwn(modelOptions, model)
    || (modelOptions[model].length ? typeof reasoning !== 'string' || !modelOptions[model].includes(reasoning) : reasoning !== null)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Choose a supported model and reasoning option.');
  }
  return { model, reasoning: reasoning as string | null };
}
export function validateDraft(value: unknown, source: Source): DraftRecord {
  const invalid = () => new ApiError(502, 'INTELLIGENCE_RESPONSE_INVALID', 'The analysis service returned an invalid draft.');
  if (!validate(value)) throw invalid();
  const result = value as DraftRecord;
  if (result.source.resumeId !== source.resumeId || result.source.resumeVersion !== source.resumeVersion
    || result.source.sha256 !== source.sha256 || !Number.isFinite(Date.parse(result.createdAt))) throw invalid();
  try { validateModel({ model: result.model, reasoning: result.reasoning }); }
  catch { throw invalid(); }
  validateExtraction(result.extraction);
  const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();
  const pages = result.extraction.pages.map(page => normalize(page.text));
  function verify(item: unknown) {
    if (Array.isArray(item)) item.forEach(verify);
    else if (item && typeof item === 'object') {
      const object = item as Record<string, unknown>;
      if ('value' in object && 'evidence' in object) {
        const fact = object as { value: string | null; evidence: { page: number; quote: string }[] };
        if (fact.value === null ? fact.evidence.length > 0 : !fact.value.trim() || !fact.evidence.length) throw invalid();
        if (fact.evidence.some(evidence => !pages[evidence.page - 1]?.includes(normalize(evidence.quote)))) throw invalid();
        if (fact.value !== null) {
          const escaped = normalize(fact.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const copied = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu');
          if (!fact.evidence.some(evidence => copied.test(normalize(evidence.quote)))) throw invalid();
        }
      } else Object.values(object).forEach(verify);
    }
  }
  verify(result.draft);
  return result;
}

export function validateHistory(value: unknown, beforeVersion?: number): DraftHistory {
  const invalid = () => new ApiError(502, 'INTELLIGENCE_RESPONSE_INVALID', 'The analysis service returned invalid version history.');
  const fields = (item: unknown, names: string): item is Record<string, unknown> => Boolean(item && typeof item === 'object'
    && !Array.isArray(item) && Object.keys(item).sort().join(',') === names);
  const version = (item: unknown): item is number => Number.isInteger(item) && (item as number) >= 1 && (item as number) <= 2147483647;
  if (!fields(value, 'nextBeforeVersion,versions') || !Array.isArray(value.versions) || value.versions.length > 20) throw invalid();
  const ids = new Set<string>();
  let previous = beforeVersion ?? 2147483648;
  for (const item of value.versions) {
    if (!fields(item, 'createdAt,id,model,reasoning,version') || typeof item.id !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.id) || ids.has(item.id)
      || !version(item.version) || item.version >= previous || typeof item.createdAt !== 'string'
      || item.createdAt.length > 80 || !Number.isFinite(Date.parse(item.createdAt))) throw invalid();
    try { validateModel({ model: item.model, reasoning: item.reasoning }); } catch { throw invalid(); }
    ids.add(item.id); previous = item.version;
  }
  if (value.nextBeforeVersion !== null && (!version(value.nextBeforeVersion) || value.versions.length !== 20
    || value.nextBeforeVersion !== previous)) throw invalid();
  return value as unknown as DraftHistory;
}

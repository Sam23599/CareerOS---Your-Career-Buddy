import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import schema from './job-analysis.schema.json' with { type: 'json' };
import { ApiError } from '../errors.js';
import { validateHistory, validateModel } from './drafts.js';

export type JobSource = { jobId: string; normalizerVersion: 'job-source-v1'; sha256: string; sections: { id: 'title' | 'company' | 'location' | 'description'; text: string }[] };
export type JobEvidence = { section: JobSource['sections'][number]['id']; quote: string; start: number; end: number };
export type JobFact = { value: string | null; evidence: JobEvidence[] };
export type Requirement = JobFact & { priority: 'required' | 'preferred' | 'unspecified'; priorityEvidence: JobEvidence[] };
export type JobWarning = { code: 'AMBIGUOUS_REQUIREMENT' | 'POSSIBLE_CONTRADICTION'; message: string; evidence: JobEvidence[] };
export type JobAnalysisRecord = {
  schemaVersion: 1; id: string; version: number; source: JobSource; analyzerVersion: 'job-analysis-v1'; provider: 'openai';
  model: string; reasoning: string | null; usage: { inputTokens: number; outputTokens: number }; createdAt: string;
  analysis: Record<string, JobFact | JobFact[] | Requirement[] | JobWarning[]>;
};
export type JobAnalysisSummary = Pick<JobAnalysisRecord, 'id' | 'version' | 'model' | 'reasoning' | 'createdAt'> & { sourceHash: string };
export type JobAnalysisHistory = { versions: JobAnalysisSummary[]; nextBeforeVersion: number | null };
export const warningMessages = {
  AMBIGUOUS_REQUIREMENT: 'This requirement is ambiguous. Review the quoted listing text.',
  POSSIBLE_CONTRADICTION: 'These statements may conflict. Confirm the requirement on the original listing.',
};

export class JobTextSource {
  static hash(source: Pick<JobSource, 'normalizerVersion' | 'sections'>) {
    return createHash('sha256').update(JSON.stringify({ normalizerVersion: source.normalizerVersion, sections: source.sections })).digest('hex');
  }
  static create(job: { id: string; title: string; company: string; location: string; description: string }): JobSource {
    const sections = (['title', 'company', 'location', 'description'] as const).map(id => ({ id, text: job[id].replace(/\r\n?/g, '\n').replaceAll('\0', '').trim() }));
    const source = { jobId: job.id, normalizerVersion: 'job-source-v1' as const, sections };
    return { ...source, sha256: this.hash(source) };
  }
}

export class RequirementPriority {
  static required = /(?<![\p{L}\p{N}_])(required|mandatory|must|essential|minimum)(?![\p{L}\p{N}_])/iu;
  static preferred = /(?<![\p{L}\p{N}_])(preferred|desirable|optional|nice[ -]to[ -]have|bonus)(?![\p{L}\p{N}_])/iu;
  static negated = /(?<![\p{L}\p{N}_])(?:not|no|never)\s+(?:strictly\s+)?(?:required|mandatory)(?![\p{L}\p{N}_])/iu;
  static headings: Record<string, Requirement['priority']> = {
    'required skills': 'required', 'required qualifications': 'required', 'minimum qualifications': 'required',
    'essential requirements': 'required', 'mandatory requirements': 'required', 'must have': 'required',
    'preferred skills': 'preferred', 'preferred qualifications': 'preferred', 'nice to have': 'preferred',
    'desirable skills': 'preferred', 'optional skills': 'preferred',
  };
  static resolve(sections: Record<string, string[]>, evidence: JobEvidence): Pick<Requirement, 'priority' | 'priorityEvidence'> {
    const unknown = { priority: 'unspecified' as const, priorityEvidence: [] };
    if (evidence.section !== 'description') return unknown;
    const chars = sections.description;
    const start = chars.slice(0, evidence.start).lastIndexOf('\n') + 1;
    const next = chars.indexOf('\n', evidence.end), end = next < 0 ? chars.length : next;
    const line = chars.slice(start, end).join('');
    const required = this.required.test(line), preferred = this.preferred.test(line);
    if (this.negated.test(line) || (required && preferred) || Array.from(line).length > 6000) return unknown;
    if (required || preferred) return { priority: required ? 'required' : 'preferred', priorityEvidence: [{ section: 'description', quote: line, start, end }] };
    let heading: Pick<Requirement, 'priority' | 'priorityEvidence'> = unknown;
    let offset = 0;
    for (const previous of chars.slice(0, start).join('').match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const cleaned = previous.trim().replace(/^[#*:\- ]+|[#*:\- ]+$/g, '').toLowerCase();
      if (Object.hasOwn(this.headings, cleaned)) {
        const quote = previous.replace(/\n$/, '');
        heading = { priority: this.headings[cleaned], priorityEvidence: [{ section: 'description', quote, start: offset, end: offset + Array.from(quote).length }] };
      } else if ((previous.trim().endsWith(':') && Array.from(previous).length < 120)
        || ['responsibilities', 'benefits', 'about us', 'about the role', 'qualifications', 'requirements'].includes(cleaned)) heading = unknown;
      offset += Array.from(previous).length;
    }
    return heading;
  }
}

const validate = new Ajv({ strict: true }).compile(schema);
export class JobAnalysisVerifier {
  static invalid() { return new ApiError(502, 'INTELLIGENCE_RESPONSE_INVALID', 'The analysis service returned an invalid job analysis.'); }
  static record(value: unknown, jobId: string, expectedHash?: string, analysisId?: string): JobAnalysisRecord {
    const invalid = this.invalid;
    if (!validate(value)) throw invalid();
    const record = value as JobAnalysisRecord;
    if (record.source.jobId !== jobId || (expectedHash !== undefined && record.source.sha256 !== expectedHash)
      || (analysisId !== undefined && record.id !== analysisId) || JobTextSource.hash(record.source) !== record.source.sha256
      || !Number.isFinite(Date.parse(record.createdAt)) || record.source.sections.map(item => item.id).join(',') !== 'title,company,location,description'
      || record.source.sections.some(item => /[\r\0]/.test(item.text) || item.text !== item.text.trim())) throw invalid();
    try { validateModel({ model: record.model, reasoning: record.reasoning }); } catch { throw invalid(); }
    const sections = Object.fromEntries(record.source.sections.map(item => [item.id, Array.from(item.text)]));
    const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();
    const evidence = (quotes: JobEvidence[]) => {
      if (quotes.some(item => item.end <= item.start || sections[item.section].slice(item.start, item.end).join('') !== item.quote)) throw invalid();
    };
    for (const [key, item] of Object.entries(record.analysis)) {
      if (key === 'warnings') {
        for (const warning of item as JobWarning[]) {
          evidence(warning.evidence);
          if (warning.message !== warningMessages[warning.code]) throw invalid();
        }
        continue;
      }
      for (const fact of Array.isArray(item) ? item as JobFact[] : [item as JobFact]) {
        evidence(fact.evidence);
        if (fact.value === null ? fact.evidence.length > 0 || Array.isArray(item) : !normalize(fact.value) || !fact.evidence.length) throw invalid();
        if (fact.value !== null) {
          const escaped = normalize(fact.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const copied = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu');
          if (!fact.evidence.some(quote => copied.test(normalize(quote.quote)))) throw invalid();
        }
        if ('priority' in fact) {
          const requirement = fact as Requirement;
          evidence(requirement.priorityEvidence);
          const decisions = fact.evidence.map(quote => {
            const text = sections[quote.section].join(''), first = text.indexOf(quote.quote);
            return text.indexOf(quote.quote, first + quote.quote.length) < 0
              ? RequirementPriority.resolve(sections, quote) : { priority: 'unspecified' as const, priorityEvidence: [] };
          }).filter(item => item.priority !== 'unspecified');
          const expected = decisions.length && new Set(decisions.map(item => item.priority)).size === 1
            ? decisions[0] : { priority: 'unspecified', priorityEvidence: [] };
          if (requirement.priority !== expected.priority || JSON.stringify(requirement.priorityEvidence) !== JSON.stringify(expected.priorityEvidence)) throw invalid();
        }
      }
    }
    return record;
  }
  static history(value: unknown, beforeVersion?: number): JobAnalysisHistory {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'nextBeforeVersion,versions') throw this.invalid();
    const history = value as JobAnalysisHistory;
    if (!Array.isArray(history.versions) || history.versions.some(item => !item || typeof item !== 'object'
      || Object.keys(item).sort().join(',') !== 'createdAt,id,model,reasoning,sourceHash,version' || !/^[a-f0-9]{64}$/.test(item.sourceHash))) throw this.invalid();
    validateHistory({ ...history, versions: history.versions.map(({ sourceHash: _sourceHash, ...item }) => item) }, beforeVersion);
    return history;
  }
}

import { Ajv } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import schema from './resume-review.schema.json' with { type: 'json' };
import { ApiError } from '../errors.js';
import { type DraftRecord, type Source } from './drafts.js';
import { type JobAnalysisRecord, type JobFact } from './jobs.js';
import { MatchVerifier, type MatchResult, type ProfileSkills } from './matching.js';

export type ResumeFinding = {
  code: string; severity: 'warning' | 'suggestion'; title: string; message: string; action: string;
  fields: string[]; evidence: { page: number; quote: string }[];
};
export type PreparationItem = { matchIndex: number; kind: 'not_found' | 'profile_only' | 'review'; action: string };
export type ReviewReport = {
  schemaVersion: 1; reviewerVersion: 'resume-checks-v1'; source: { resume: Source; draftId: string; draftVersion: number };
  sections: { section: string; present: boolean }[]; findings: ResumeFinding[]; match: MatchResult | null; preparation: PreparationItem[];
  keywords: { term: JobFact; status: 'found' | 'not_found'; evidence: { page: number; quote: string }[] }[];
};
export type ReviewResponse = { report: ReviewReport; sourceStatus: { expired: boolean } };
export type ReviewInput = { draftId: string; job: { jobId: string; jobAnalysisId: string; includeProfileSkills: boolean } | null };
const validate = new Ajv({ strict: true }).compile(schema);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fields = (value: unknown, keys: string): value is Record<string, unknown> => Boolean(value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys);

export class ReviewVerifier {
  static input(value: unknown): ReviewInput {
    const invalid = () => new ApiError(400, 'INVALID_INPUT', 'Choose a saved CV analysis and optional job analysis.');
    if (!fields(value, 'draftId,job') || typeof value.draftId !== 'string' || !uuid.test(value.draftId)) throw invalid();
    if (value.job !== null && (!fields(value.job, 'includeProfileSkills,jobAnalysisId,jobId')
      || typeof value.job.jobId !== 'string' || !/^[a-f0-9]{64}$/.test(value.job.jobId)
      || typeof value.job.jobAnalysisId !== 'string' || !uuid.test(value.job.jobAnalysisId)
      || typeof value.job.includeProfileSkills !== 'boolean')) throw invalid();
    return value as unknown as ReviewInput;
  }

  static result(value: unknown, resume: DraftRecord, job: JobAnalysisRecord | null, profile: ProfileSkills | null): ReviewReport {
    const invalid = () => new ApiError(502, 'INTELLIGENCE_RESPONSE_INVALID', 'The review service returned an invalid report. Please retry.');
    if (!validate(value)) throw invalid();
    const report = value as ReviewReport;
    if (!isDeepStrictEqual(report.source, { resume: resume.source, draftId: resume.id, draftVersion: resume.version })) throw invalid();
    const sections = ['fullName', 'contact', 'summary', 'skills', 'experience', 'education'];
    if (!isDeepStrictEqual(report.sections.map(item => item.section), sections)) throw invalid();
    const savedEvidence: unknown[] = [];
    function collect(value: unknown) {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        if ('value' in object && Array.isArray(object.evidence)) savedEvidence.push(...object.evidence);
        else Object.values(object).forEach(collect);
      }
    }
    collect(resume.draft);
    const codes = new Set<string>();
    for (const finding of report.findings) {
      if (codes.has(finding.code)) throw invalid(); codes.add(finding.code);
      for (const field of finding.fields) {
        if (field === 'extraction.warnings') {
          if (!resume.extraction.warnings.some(warning => warning.code === finding.code && warning.message === finding.message)
            || finding.evidence.length || finding.severity !== 'warning') throw invalid();
          continue;
        }
        let current: unknown = resume.draft;
        for (const key of field.split('.')) {
          if (['__proto__', 'constructor', 'prototype'].includes(key) || !current || typeof current !== 'object' || !Object.hasOwn(current, key)) throw invalid();
          current = (current as Record<string, unknown>)[key];
        }
      }
      if (finding.evidence.some(quote => !savedEvidence.some(saved => isDeepStrictEqual(saved, quote)))) throw invalid();
    }
    if (job) {
      report.match = MatchVerifier.result(report.match, resume, job, profile);
      const indexes = new Set<number>();
      for (const item of report.preparation) {
        const match = report.match.items[item.matchIndex];
        const kind = match?.status === 'not_found' ? 'not_found' : match?.status === 'needs_review' ? 'review'
          : match?.candidate?.source === 'profile' ? 'profile_only' : null;
        if (!kind || item.kind !== kind || indexes.has(item.matchIndex)) throw invalid();
        indexes.add(item.matchIndex);
      }
      const count = report.match.items.filter(item => item.status !== 'matched' || item.candidate?.source === 'profile').length;
      if (report.preparation.length !== count) throw invalid();
      const terms = new Set<string>();
      for (const keyword of report.keywords) {
        if (!(job.analysis.keywords as JobFact[]).some(term => isDeepStrictEqual(term, keyword.term)) || !keyword.term.value) throw invalid();
        const key = keyword.term.value.toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
        if (terms.has(key)) throw invalid(); terms.add(key);
        if ((keyword.status === 'found') !== (keyword.evidence.length === 1)
          || keyword.evidence.some(quote => !resume.extraction.pages[quote.page - 1]?.text.includes(quote.quote)
            || quote.quote.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en') !== key)) throw invalid();
      }
    } else if (report.match !== null || report.preparation.length || report.keywords.length || profile !== null) throw invalid();
    return report;
  }
}

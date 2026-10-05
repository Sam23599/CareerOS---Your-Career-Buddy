import { Ajv } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import schema from './matching.schema.json' with { type: 'json' };
import { ApiError } from '../errors.js';
import { type DraftRecord, type Source } from './drafts.js';
import { type JobAnalysisRecord, type JobFact, type Requirement } from './jobs.js';

export type ProfileSkills = { version: number; skills: string[] };
export type CandidateEvidence = { source: 'resume' | 'profile'; field: string; value: string; evidence: { page: number; quote: string }[] };
export type MatchItem = {
  category: string; requirement: Requirement; status: 'matched' | 'not_found' | 'needs_review'; weight: number; candidate: CandidateEvidence | null;
};
export type MatchResult = {
  schemaVersion: 1; matcherVersion: 'skill-coverage-v1';
  source: { resume: Source; draftId: string; draftVersion: number; jobId: string; jobHash: string; jobAnalysisId: string; jobAnalysisVersion: number; profileVersion: number | null };
  score: number | null; matchedWeight: number; totalWeight: number; items: MatchItem[]; notStated: string[];
};
export type MatchResponse = { match: MatchResult; sourceStatus: { expired: boolean } };
const validate = new Ajv({ strict: true }).compile(schema);
const weights = { required: 3, unspecified: 2, preferred: 1 };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export class MatchVerifier {
  static input(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'draftId,includeProfileSkills,jobAnalysisId,resumeId') {
      throw new ApiError(400, 'INVALID_INPUT', 'Choose a resume, saved analyses and whether to include profile skills.');
    }
    const input = value as { resumeId: string; draftId: string; jobAnalysisId: string; includeProfileSkills: boolean };
    if ([input.resumeId, input.draftId, input.jobAnalysisId].some(id => typeof id !== 'string' || !uuid.test(id))
      || typeof input.includeProfileSkills !== 'boolean') throw new ApiError(400, 'INVALID_INPUT', 'Choose valid resume and analysis IDs.');
    return input;
  }

  static result(value: unknown, resume: DraftRecord, job: JobAnalysisRecord, profile: ProfileSkills | null): MatchResult {
    const invalid = () => new ApiError(502, 'INTELLIGENCE_RESPONSE_INVALID', 'The comparison service returned an invalid result. Please retry.');
    if (!validate(value)) throw invalid();
    const match = value as MatchResult;
    const expected = { resume: resume.source, draftId: resume.id, draftVersion: resume.version, jobId: job.source.jobId,
      jobHash: job.source.sha256, jobAnalysisId: job.id, jobAnalysisVersion: job.version, profileVersion: profile?.version ?? null };
    if (!isDeepStrictEqual(match.source, expected)) throw invalid();
    for (const item of match.items) {
      const saved = job.analysis[item.category];
      const facts = Array.isArray(saved) ? saved as JobFact[] : saved ? [saved as JobFact] : [];
      if (!facts.some(fact => isDeepStrictEqual('priority' in fact ? fact : { ...fact, priority: 'unspecified', priorityEvidence: [] }, item.requirement))) throw invalid();
      const scored = ['skills', 'technologies'].includes(item.category);
      if (item.weight !== (scored && item.status !== 'needs_review' ? weights[item.requirement.priority] : 0)
        || (item.status === 'matched') !== Boolean(item.candidate) || (!scored && item.status !== 'needs_review')) throw invalid();
      if (item.candidate) {
        const candidate = item.candidate;
        if (candidate.source === 'profile') {
          if (!profile || candidate.field !== 'skills' || candidate.evidence.length || !profile.skills.includes(candidate.value)) throw invalid();
        } else {
          if (!/^(skills|technologies|(?:experience|projects)\.[0-9]+\.skills)$/.test(candidate.field)) throw invalid();
          let field: unknown = resume.draft;
          for (const key of candidate.field.split('.')) field = field && typeof field === 'object' ? (field as Record<string, unknown>)[key] : undefined;
          if (!Array.isArray(field) || !field.some(fact => fact.value === candidate.value && isDeepStrictEqual(fact.evidence, candidate.evidence))) throw invalid();
        }
      }
    }
    const total = match.items.reduce((sum, item) => sum + item.weight, 0);
    const matched = match.items.reduce((sum, item) => sum + (item.status === 'matched' ? item.weight : 0), 0);
    if (match.totalWeight !== total || match.matchedWeight !== matched || match.score !== (total ? Math.floor((matched * 100 + Math.floor(total / 2)) / total) : null)) throw invalid();
    return match;
  }
}

import { ApiError } from '../errors.js';
import { parseSavedQuery } from '../saved-jobs/store.js';
import { type Preferences } from '../profiles/model.js';
import { type Source } from './drafts.js';
import { type MatchResult } from './matching.js';

export type RankingInput = {
  resumeId: string; draftId: string; includeProfileSkills: boolean; usePreferences: boolean;
  filters: { status: string; priority: string; location?: string; postedFrom?: string; postedTo?: string; applicationStatus?: string; companyHistory?: string };
};
export type RankingJob = {
  jobId: string; title: string; company: string; location: string; priority: string; savedAt: string;
};
export type PreferenceReason = {
  kind: 'role' | 'location' | 'work_mode'; wanted: string[]; actual: string;
  status: 'matched' | 'not_matched' | 'unknown';
};
export type RankedJob = RankingJob & {
  rank: number; score: number; matchedWeight: number; totalWeight: number;
  jobAnalysisId: string; jobAnalysisVersion: number;
  matchedSkills: string[]; profileOnlySkills: string[];
  missingSkills: { value: string; priority: string }[]; reviewCount: number;
  preferenceMatches: number; preferences: PreferenceReason[];
};
export type DeferredJob = RankingJob & {
  reason: 'analysis_required' | 'stale_analysis' | 'expired' | 'unavailable' | 'not_interested' | 'no_scorable_skills';
};
export type RankingResponse = {
  rankingVersion: 'saved-skill-coverage-v1'; createdAt: string; total: number; filters: RankingInput['filters'];
  source: { resume: Source; draftId: string; draftVersion: number; profileVersion: number | null };
  ranked: RankedJob[]; unranked: DeferredJob[];
};

function normalized(value: string) { return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' '); }
// Literal phrase boundaries, never fuzzy or inferred semantic preferences.
function containsPhrase(actual: string, wanted: string) {
  const escaped = normalized(wanted).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(normalized(actual));
}

export class SavedJobRanker {
  static input(value: unknown): RankingInput {
    const bad = () => new ApiError(400, 'INVALID_INPUT', 'Choose a saved CV analysis, ranking options and saved-job filters.');
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'draftId,filters,includeProfileSkills,resumeId,usePreferences') throw bad();
    const input = value as RankingInput;
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    if ([input.resumeId, input.draftId].some(id => typeof id !== 'string' || !uuid.test(id))
      || typeof input.includeProfileSkills !== 'boolean' || typeof input.usePreferences !== 'boolean'
      || !input.filters || typeof input.filters !== 'object' || Array.isArray(input.filters)
      || Object.keys(input.filters).some(key => !['status', 'priority', 'location', 'postedFrom', 'postedTo', 'applicationStatus', 'companyHistory'].includes(key))
      || typeof input.filters.status !== 'string' || typeof input.filters.priority !== 'string') throw bad();
    parseSavedQuery({ ...input.filters, limit: '50' });
    return input;
  }

  preferences(job: { title: string; location: string; remoteType: string }, preferences: Preferences | null): PreferenceReason[] {
    if (!preferences) return [];
    const values: [PreferenceReason['kind'], string[], string][] = [
      ['role', preferences.roles, job.title], ['location', preferences.locations, job.location],
      ['work_mode', preferences.workModes, job.remoteType === 'UNKNOWN' ? '' : job.remoteType],
    ];
    return values.filter(([, wanted]) => wanted.length).map(([kind, wanted, actual]) => ({
      kind, wanted, actual, status: !actual.trim() ? 'unknown' : wanted.some(value => kind === 'work_mode'
        ? value === actual : containsPhrase(actual, value)) ? 'matched' : 'not_matched',
    }));
  }

  summarize(job: RankingJob, match: MatchResult, preferences: PreferenceReason[]): RankedJob | DeferredJob {
    if (match.score === null) return { ...job, reason: 'no_scorable_skills' };
    return {
      ...job, rank: 0, score: match.score, matchedWeight: match.matchedWeight, totalWeight: match.totalWeight,
      jobAnalysisId: match.source.jobAnalysisId, jobAnalysisVersion: match.source.jobAnalysisVersion,
      matchedSkills: match.items.filter(item => item.weight && item.status === 'matched' && item.requirement.value !== null).map(item => item.requirement.value!),
      profileOnlySkills: match.items.filter(item => item.candidate?.source === 'profile' && item.requirement.value !== null).map(item => item.requirement.value!),
      missingSkills: match.items.filter(item => item.weight && item.status === 'not_found' && item.requirement.value !== null)
        .map(item => ({ value: item.requirement.value!, priority: item.requirement.priority })),
      reviewCount: match.items.filter(item => item.status === 'needs_review').length,
      preferenceMatches: preferences.filter(item => item.status === 'matched').length, preferences,
    };
  }

  sort(jobs: RankedJob[]) {
    const priority: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return [...jobs].sort((a, b) => b.score - a.score || b.preferenceMatches - a.preferenceMatches
      || priority[b.priority] - priority[a.priority] || Date.parse(b.savedAt) - Date.parse(a.savedAt)
      || a.jobId.localeCompare(b.jobId)).map((job, index) => ({ ...job, rank: index + 1 }));
  }
}

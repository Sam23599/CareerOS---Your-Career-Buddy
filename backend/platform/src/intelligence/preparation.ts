import { Ajv } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import schema from './preparation.schema.json' with { type: 'json' };
import inputSchema from './preparation-input.schema.json' with { type: 'json' };
import historySchema from './preparation-history.schema.json' with { type: 'json' };
import reviewSchema from './preparation-review.schema.json' with { type: 'json' };
import { ApiError } from '../errors.js';
import { type MatchResult, type ProfileSkills, MatchVerifier } from './matching.js';
import { type DraftRecord } from './drafts.js';

export type GapChoice = { matchIndex: number; classification: 'already_know' | 'need_evidence' | 'want_to_learn' | 'unsure' };
export type PreparationGoals = { choices: GapChoice[]; hoursPerWeek: number; weeks: number; goal: string };
export type PlanAction = { id: string; matchIndex: number; kind: 'learn' | 'practice' | 'project' | 'checkpoint' | 'interview' | 'cv_evidence' | 'verify'; week: number; hours: number; title: string; detail: string; outcome?: string };
export type WeeklyGoal = { week: number; objective: string; milestone: string };
export type ReviewedAction = { id: string; title: string; detail: string; status: 'planned' | 'skipped' | 'done' };
export type PlanReview = { revision: number; actions: ReviewedAction[] };
export type PreparationRecord = { schemaVersion: 1; plannerVersion: 'preparation-v1' | 'preparation-v2'; id: string; version: number;
  source: MatchResult['source']; goals: PreparationGoals; provider: 'openai'; model: string; reasoning: string | null;
  usage: { inputTokens: number; outputTokens: number }; createdAt: string;
  plan: { overview: string; actions: PlanAction[]; cautions: string[]; weeks?: WeeklyGoal[] }; review: PlanReview };
export type PreparationInput = { context: { resume: DraftRecord['source']; draftId: string; jobId: string; jobHash: string; jobAnalysisId: string; profile: ProfileSkills | null };
  goals: PreparationGoals; model: string; reasoning: string | null; requestKey: string };
export type PreparationSummary = Pick<PreparationRecord, 'id' | 'version' | 'source' | 'model' | 'reasoning' | 'createdAt'> & { reviewRevision: number; stale?: boolean };
export type PreparationHistory = { versions: PreparationSummary[]; nextBeforeVersion: number | null };
export type PreparationResponse = { record: PreparationRecord; match: MatchResult; sourceStatus: { stale: boolean; expired: boolean; profileChanged: boolean } };
const ajv = new Ajv({ strict: true });
const validate = ajv.compile(schema), validateInput = ajv.compile(inputSchema), validateHistory = ajv.compile(historySchema), validateReview = ajv.compile(reviewSchema);
export class PreparationVerifier {
  static input(value: unknown): PreparationInput {
    if (!validateInput(value)) throw new ApiError(400, 'INVALID_INPUT', 'Choose valid preparation goals, time and sources.');
    return value as PreparationInput;
  }
  static review(value: unknown): PlanReview {
    if (!validateReview(value)) throw new ApiError(400, 'INVALID_INPUT', 'Provide valid reviewed actions and revision.');
    const review = value as PlanReview;
    if (new Set(review.actions.map(item => item.id)).size !== review.actions.length) throw new ApiError(400, 'INVALID_INPUT', 'Review each action once.');
    return review;
  }
  static invalid(): never { throw new ApiError(502, 'INTELLIGENCE_RESPONSE_INVALID', 'The preparation service returned an invalid plan.'); }
  static record(value: unknown, jobId: string, planId?: string): PreparationRecord {
    if (!validate(value)) this.invalid();
    const record = value as PreparationRecord;
    if (record.source.jobId !== jobId || (planId && record.id !== planId) || !Number.isFinite(Date.parse(record.createdAt))) this.invalid();
    const choices = new Map(record.goals.choices.map(item => [item.matchIndex, item.classification])), hours = new Map<number, number>();
    const covered = new Set<number>(), ids = new Set<string>();
    if (choices.size !== record.goals.choices.length) this.invalid();
    for (const action of record.plan.actions) {
      const choice = choices.get(action.matchIndex);
      if (!choice || ids.has(action.id) || action.week > record.goals.weeks
        || (['already_know', 'need_evidence'].includes(choice) && ['learn', 'project'].includes(action.kind))
        || (choice === 'unsure' && !['verify', 'checkpoint'].includes(action.kind))
        || (choice === 'want_to_learn' && action.kind === 'cv_evidence')) this.invalid();
      ids.add(action.id); covered.add(action.matchIndex); hours.set(action.week, (hours.get(action.week) ?? 0) + action.hours);
    }
    if (covered.size !== choices.size || [...hours.values()].some(value => value > record.goals.hoursPerWeek)
      || new Set(record.review.actions.map(item => item.id)).size !== record.review.actions.length
      || record.review.actions.some(item => !ids.has(item.id))) this.invalid();
    if ((record.plannerVersion === 'preparation-v2') !== Boolean(record.plan.weeks)) this.invalid();
    if (record.plan.weeks) {
      const expected = Array.from({ length: record.goals.weeks }, (_, i) => i + 1);
      if (!isDeepStrictEqual(record.plan.weeks.map(item => item.week), expected) || !isDeepStrictEqual([...hours.keys()].sort((a, b) => a - b), expected)
        || record.plan.actions.some((action, i, items) => i > 0 && action.week < items[i - 1].week)
        || expected.some(week => !['checkpoint', 'verify', 'interview'].includes(record.plan.actions.filter(action => action.week === week).at(-1)!.kind))
        || record.plan.actions.some(action => !action.outcome?.trim() || !action.title.trim() || !action.detail.trim())
        || record.plan.weeks.some(week => !week.objective.trim() || !week.milestone.trim())) this.invalid();
    }
    return record;
  }
  static bound(record: PreparationRecord, match: MatchResult) {
    if (!isDeepStrictEqual(record.source, match.source) || record.goals.choices.some(item => !match.items[item.matchIndex]?.requirement.value)) this.invalid();
  }
  static history(value: unknown, jobId: string, before?: number): PreparationHistory {
    if (!validateHistory(value)) this.invalid();
    const history = value as PreparationHistory;
    const ids = new Set<string>(); let previous = before ?? Infinity;
    for (const item of history.versions) {
      if (item.source.jobId !== jobId || ids.has(item.id) || item.version >= previous || !Number.isFinite(Date.parse(item.createdAt))) this.invalid();
      ids.add(item.id); previous = item.version;
    }
    if (history.nextBeforeVersion !== null && history.nextBeforeVersion !== history.versions.at(-1)?.version) this.invalid();
    return history;
  }
  static selection(value: Record<string, unknown>) {
    return MatchVerifier.input({ resumeId: value.resumeId, draftId: value.draftId, jobAnalysisId: value.jobAnalysisId, includeProfileSkills: value.includeProfileSkills });
  }
}

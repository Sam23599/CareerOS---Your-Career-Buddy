import { Ajv } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import schema from './cady.schema.json' with { type: 'json' };
import inputSchema from './cady-input.schema.json' with { type: 'json' };
import { ApiError } from '../errors.js';
import { type DraftRecord, type Source } from './drafts.js';
import { type JobAnalysisRecord, type JobFact } from './jobs.js';
import { type MatchResult, type ProfileSkills } from './matching.js';

export type CadyInput = { resume: Source; draftId: string; jobs: { jobId: string; jobHash: string; jobAnalysisId: string }[];
  profile: ProfileSkills | null; question: string; history: { role: 'user' | 'assistant'; text: string }[]; model: string; reasoning: string | null };
export type CadyResult = { schemaVersion: 1; assistantVersion: 'cady-v1'; resume: Source; draftId: string; draftVersion: number;
  sources: MatchResult['source'][]; profileVersion: number | null; answer: { paragraphs: { text: string; references: string[] }[]; followUps: string[] };
  references: { id: string; label: string; text: string }[]; model: string; reasoning: string | null; usage: { inputTokens: number; outputTokens: number } };
const ajv = new Ajv({ strict: true }), validate = ajv.compile(schema), validateInput = ajv.compile(inputSchema);
export class CadyVerifier {
  static clean(value: string) {
    return value.replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b|https?:\/\/\S+|www\.\S+/g, '[contact removed]').replace(/(?<!\w)\+?\d[\d ().-]{7,}\d(?!\w)/g, '[contact removed]');
  }
  static input(value: unknown): CadyInput {
    if (!validateInput(value)) throw new ApiError(400, 'INVALID_INPUT', 'Choose valid context and a question of up to 2,000 characters.');
    const input = value as CadyInput;
    if (!input.question.trim() || new Set(input.jobs.map(job => job.jobId)).size !== input.jobs.length) throw new ApiError(400, 'INVALID_INPUT', 'Choose distinct jobs and enter a question.');
    return input;
  }
  static result(value: unknown, cv: DraftRecord, jobs: JobAnalysisRecord[], profile: ProfileSkills | null, options: { model: string; reasoning: string | null }): CadyResult {
    const invalid = () => new ApiError(502, 'INTELLIGENCE_RESPONSE_INVALID', 'Cady returned an invalid answer. Please retry.');
    if (!validate(value)) throw invalid();
    const result = value as CadyResult;
    const sources = jobs.map(job => ({ resume: cv.source, draftId: cv.id, draftVersion: cv.version, jobId: job.source.jobId,
      jobHash: job.source.sha256, jobAnalysisId: job.id, jobAnalysisVersion: job.version, profileVersion: profile?.version ?? null }));
    if (!isDeepStrictEqual(result.resume, cv.source) || result.draftId !== cv.id || result.draftVersion !== cv.version
      || !isDeepStrictEqual(result.sources, sources) || result.profileVersion !== (profile?.version ?? null) || result.model !== options.model || result.reasoning !== options.reasoning) throw invalid();
    const ids = new Set<string>();
    for (const ref of result.references) {
      if (ids.has(ref.id)) throw invalid(); ids.add(ref.id);
      if (/^cv-\d+$/.test(ref.id)) {
        const facts = [...(cv.draft.skills as { value: string | null }[]), ...(cv.draft.technologies as { value: string | null }[])].slice(0, 30);
        const fact = facts[Number(ref.id.slice(3))];
        if (!fact?.value || ref.text !== this.clean(fact.value) || ref.label !== 'Selected CV skill') throw invalid();
      } else if (/^profile-\d+$/.test(ref.id)) {
        const skill = profile?.skills.slice(0, 10)[Number(ref.id.slice(8))];
        if (!skill || ref.text !== this.clean(skill) || ref.label !== 'Profile skill (self-reported)') throw invalid();
      } else {
        const match = /^job-(\d+)(?:-requirement-(\d+))?$/.exec(ref.id), job = match ? jobs[Number(match[1])] : undefined;
        if (!job || !match) throw invalid();
        if (!match[2]) {
          if (ref.text !== this.clean((job.analysis.title as JobFact).value ?? 'Selected job') || ref.label !== `Job ${Number(match[1]) + 1}`) throw invalid();
        } else {
          const facts = Object.values(job.analysis).flat();
          if (!facts.some(fact => fact && 'value' in fact && typeof fact.value === 'string' && this.clean(fact.value) === ref.text) || ref.label !== `Job ${Number(match[1]) + 1} requirement`) throw invalid();
        }
      }
    }
    if (result.answer.paragraphs.some(paragraph => new Set(paragraph.references).size !== paragraph.references.length || paragraph.references.some(ref => !ids.has(ref)))) throw invalid();
    return result;
  }
}

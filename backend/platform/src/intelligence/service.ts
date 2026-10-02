import { createHash } from 'node:crypto';
import { ApiError } from '../errors.js';
import { type ResumeStore } from '../resumes/store.js';
import { type ProfileStore } from '../profiles/store.js';
import { parseProfilePatch } from '../profiles/validation.js';
import { type IntelligenceClient } from './client.js';
import { type Source, validateModel } from './drafts.js';

export class ResumeAnalysisService {
  constructor(private resumes: ResumeStore, private client: IntelligenceClient, private profiles?: ProfileStore) {}
  async source(owner: string, id: string) {
    const { item, data } = await this.resumes.download(owner, id);
    return { data, source: { resumeId: item.id, resumeVersion: item.version, sha256: createHash('sha256').update(data).digest('hex') } };
  }
  async requireSource(owner: string, source: Source) {
    const { resumes } = await this.resumes.list(owner);
    if (!resumes.some(item => item.id === source.resumeId && item.version === source.resumeVersion && !item.deleting)) {
      throw new ApiError(404, 'RESUME_NOT_FOUND', 'Resume not found.');
    }
  }
  async analyze(owner: string, id: string, input: unknown, signal: AbortSignal, requestId?: string) {
    const options = validateModel(input);
    const { data, source } = await this.source(owner, id);
    const record = await this.client.analyze(owner, source, data, options, signal, requestId);
    await this.requireSource(owner, source);
    return record;
  }
  async get(owner: string, id: string, signal?: AbortSignal, analysisId?: string) {
    const { source } = await this.source(owner, id);
    const record = await this.client.draft(owner, source, signal, analysisId);
    await this.requireSource(owner, source);
    return record;
  }
  async apply(user: { id: string; name: string }, id: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).sort().join(',') !== 'analysisId,patch') throw new ApiError(400, 'INVALID_INPUT', 'Provide a draft ID and reviewed profile changes.');
    const { analysisId, patch } = input as { analysisId: unknown; patch: unknown };
    if (typeof analysisId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(analysisId)) {
      throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid saved draft ID.');
    }
    const record = await this.get(user.id, id, undefined, analysisId).catch(error => {
      if (error instanceof ApiError && error.code === 'ANALYSIS_NOT_FOUND') {
        throw new ApiError(409, 'DRAFT_CHANGED', 'This draft is unavailable. Reopen and review a saved draft.');
      }
      throw error;
    });
    if (analysisId !== record.id) throw new ApiError(409, 'DRAFT_CHANGED', 'The saved draft changed. Reopen and review the latest draft.');
    if (!this.profiles) throw new ApiError(503, 'ANALYSIS_UNAVAILABLE', 'Profile review is unavailable.');
    const parsed = parseProfilePatch(patch);
    const supported = ['fullName', 'headline', 'summary', 'location', 'phone', 'skills', 'experience', 'education', 'certifications', 'links'];
    if (!Object.keys(parsed.changes).length || Object.keys(parsed.changes).some(key => !supported.includes(key))) {
      throw new ApiError(400, 'INVALID_INPUT', 'Select supported profile fields to apply.');
    }
    await this.requireSource(user.id, record.source);
    return this.profiles.update(user, parsed.version, parsed.changes);
  }
  async history(owner: string, id: string, beforeVersion?: number) {
    const { source } = await this.source(owner, id);
    const history = await this.client.draftHistory(owner, source, beforeVersion);
    await this.requireSource(owner, source);
    return history;
  }
}

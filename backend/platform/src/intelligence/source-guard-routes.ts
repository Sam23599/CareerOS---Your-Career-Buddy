import { timingSafeEqual } from 'node:crypto';
import { type Express } from 'express';
import { ApiError } from '../errors.js';
import { type ProfileStore } from '../profiles/store.js';
import { type ResumeStore } from '../resumes/store.js';
import { type JobStore } from '../jobs/store.js';
import { JobAnalysisService } from './job-service.js';
import { ResumeAnalysisService } from './service.js';
import { type IntelligenceClient } from './client.js';
import { TaskVerifier } from './tasks.js';

export class SourceGuardRoutes {
  constructor(private resumes: ResumeStore, private jobs: JobStore, private client: IntelligenceClient, private profiles?: ProfileStore) {}
  register(app: Express, token: string) {
    app.post('/internal/v1/intelligence/sources/check', async (req, res) => {
      const sent = req.get('Authorization') ?? '', expected = `Bearer ${token}`;
      if (!/^[a-f0-9]{64,}$/i.test(token) || Buffer.byteLength(sent) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) throw new ApiError(401, 'UNAUTHENTICATED', 'Service authentication required.');
      if (!req.is('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
      const body = req.body;
      if (Object.keys(req.query).length || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'jobHash,jobId,owner,profileVersion,resume'
        || !TaskVerifier.uuid(body.owner) || typeof body.jobId !== 'string' || !/^[a-f0-9]{64}$/.test(body.jobId) || typeof body.jobHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.jobHash)
        || !body.resume || Object.keys(body.resume).sort().join(',') !== 'resumeId,resumeVersion,sha256' || !TaskVerifier.uuid(body.resume.resumeId)
        || !Number.isSafeInteger(body.resume.resumeVersion) || body.resume.resumeVersion < 1 || typeof body.resume.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.resume.sha256)
        || (body.profileVersion !== null && (!Number.isInteger(body.profileVersion) || body.profileVersion < 0))) throw new ApiError(400, 'INVALID_INPUT', 'Invalid source references.');
      try {
        const [resume, job, profile] = await Promise.all([new ResumeAnalysisService(this.resumes, this.client).source(body.owner, body.resume.resumeId),
          new JobAnalysisService(this.jobs, this.client).source(body.jobId), body.profileVersion === null ? null : this.profiles?.get({ id: body.owner, name: '' })]);
        if (resume.source.sha256 !== body.resume.sha256 || resume.source.resumeVersion !== body.resume.resumeVersion || job.source.sha256 !== body.jobHash || job.expired
          || (body.profileVersion !== null && (!profile || profile.version !== body.profileVersion))) throw new ApiError(409, 'MATCH_SOURCE_CHANGED', 'Source changed.');
        res.json({ status: 'current' });
      } catch (error) {
        if (error instanceof ApiError && [404, 409].includes(error.status)) throw new ApiError(409, 'MATCH_SOURCE_CHANGED', 'Source unavailable or changed.');
        throw error;
      }
    });
  }
}

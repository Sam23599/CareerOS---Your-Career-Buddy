export const employmentTypes = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY', 'OTHER', 'UNKNOWN'] as const;
export const remoteTypes = ['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN'] as const;
export type JobInput = {
  sourceId: string; title: string; company: string; description: string; location: string;
  employmentType: typeof employmentTypes[number]; remoteType: typeof remoteTypes[number]; skills: string[];
  sourceUrl: string; postedAt: Date | null; expiresAt: Date | null; metadata: { category?: string; salary?: string; coverage?: 'limited'; normalizationVersion?: number; inferredFields?: string[]; contactEmails?: string[] };
};
export type Job = JobInput & { _id: string; source: string; createdAt: Date; updatedAt: Date };
export interface JobSource { id: string; name: string; cooldownMs: number; reconcileMissing?: boolean; fetchJobs(): Promise<JobInput[]> }

export function validateJob(job: JobInput): void {
  for (const field of ['sourceId', 'title', 'company', 'description', 'location', 'sourceUrl'] as const) {
    if (typeof job[field] !== 'string' || job[field].length > (field === 'description' ? 100_000 : 2048)) throw new Error(`Invalid job ${field}.`);
  }
  if (!job.sourceId.trim() || !job.title.trim() || !job.company.trim()) throw new Error('Missing job identity.');
  const url = new URL(job.sourceUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid job URL.');
  if (!employmentTypes.includes(job.employmentType) || !remoteTypes.includes(job.remoteType)) throw new Error('Invalid job type.');
  if (!Array.isArray(job.skills) || job.skills.length > 100 || job.skills.some(skill => typeof skill !== 'string' || skill.length > 200)) throw new Error('Invalid job skills.');
  for (const date of [job.postedAt, job.expiresAt]) if (date !== null && (!(date instanceof Date) || !Number.isFinite(date.getTime()))) throw new Error('Invalid job date.');
}
export function publicJob(job: Job) { const { _id, ...data } = job; return { id: _id, ...data }; }

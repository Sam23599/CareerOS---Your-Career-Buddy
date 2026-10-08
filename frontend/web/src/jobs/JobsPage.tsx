import { SaveJobButton } from '../saved-jobs/SaveJobButton';
import { JobAnalysisPanel } from './JobAnalysisPanel';
import { JobMatchPanel } from './JobMatchPanel';
import { limitedCoverageMessage } from '../career-sources/types';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { workspaceLabels } from '../ui/navigation';

export type Job = {
  id: string; title: string; company: string; description: string; location: string; employmentType: string; remoteType: string;
  skills: string[]; source: string; sourceUrl: string; postedAt: string | null; expiresAt: string | null; updatedAt: string;
  metadata: { salary?: string; category?: string; coverage?: 'limited'; inferredFields?: string[]; contactEmails?: string[] };
};
type Results = { jobs: Job[]; total: number; page: number; limit: number };
const label = (value: string) => value === 'UNKNOWN' ? 'Not specified' : value.toLowerCase().replaceAll('_', ' ');
function sourceName(source: string) { return source === 'remotive' ? 'Remotive' : source === 'google-careers' ? 'Google Careers' : source === 'fixture' ? 'Demo fixtures' : source.startsWith('greenhouse:') ? `Greenhouse · ${source.slice(11)}` : source; }
function companyFeed(source: string) { return source === 'google-careers' || source.includes(':'); }
function useJobsData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/jobs${path}`, { signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || 'Could not load jobs.'); return body as T;
    }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load jobs.'); });
    return () => controller.abort();
  }, [path, attempt]);
  return { data, error, retry: () => { setError(''); setAttempt(value => value + 1); } };
}
function Loading({ error, retry }: { error: string; retry: () => void }) {
  return error ? <><p role="alert" className="form-error">{error}</p><button onClick={retry}>Retry</button></> : <p role="status">Loading jobs…</p>;
}
function JobFacts({ job }: { job: Job }) {
  return <><p>{job.company} · {job.location || 'Location not specified'}</p><p className="muted">{label(job.remoteType)} · {label(job.employmentType)}{job.postedAt && ` · Posted ${new Date(job.postedAt).toLocaleDateString()}`}</p>{job.metadata.coverage === 'limited' && <p className="muted">{limitedCoverageMessage}</p>}</>;
}
function JobResults() {
  const [params, setParams] = useSearchParams();
  const { data, error, retry } = useJobsData<Results>(`?${params.toString()}`);
  const { data: sourceData } = useJobsData<{ sources: string[] }>('/sources');
  const sources = [...new Set(['remotive', ...(sourceData?.sources ?? []), ...(params.get('source') ? [params.get('source')!] : [])])];
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const next = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
    setParams(next);
  }
  function page(number: number) { const next = new URLSearchParams(params); next.set('page', String(number)); setParams(next); }
  return <div className="profile-page">
    <nav className="profile-nav"><Link to="/dashboard">Your workspace</Link><Link to="/career-sources">Your career sources</Link></nav><h1>{workspaceLabels.jobs}</h1>
    <p className="description">Explore opportunities and check location requirements on the original listing. Remote does not always mean worldwide.</p>
    <form className="panel profile-section" onSubmit={search} aria-label="Job search"><div className="profile-grid">
      <label>Search jobs<input name="q" defaultValue={params.get('q') ?? ''} maxLength={100} placeholder="Title, company, keyword…" /></label>
      <label>Location<input name="location" defaultValue={params.get('location') ?? ''} maxLength={100} placeholder="India, Europe, Worldwide…" /></label>
      <label>Company<input name="company" defaultValue={params.get('company') ?? ''} maxLength={100} /></label>
      <label>Skill / description keyword<input name="skill" defaultValue={params.get('skill') ?? ''} maxLength={100} /></label>
      <label>Employment type<select name="employmentType" defaultValue={params.get('employmentType') ?? ''}><option value="">Any type</option>{['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY', 'OTHER', 'UNKNOWN'].map(type => <option key={type} value={type}>{label(type)}</option>)}</select></label>
      <label>Work mode<select name="remoteType" defaultValue={params.get('remoteType') ?? ''}><option value="">Any work mode</option>{['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN'].map(type => <option key={type} value={type}>{label(type)}</option>)}</select></label>
      <label>Source<select name="source" defaultValue={params.get('source') ?? ''}><option value="">All sources</option><optgroup label="Job platforms">{sources.filter(source => !companyFeed(source)).map(source => <option key={source} value={source}>{sourceName(source)}</option>)}</optgroup><optgroup label="Company career feeds">{sources.filter(companyFeed).map(source => <option key={source} value={source}>{sourceName(source)}</option>)}</optgroup></select></label>
    </div><div className="actions"><button>Search</button><button className="secondary" type="button" onClick={() => setParams({})}>Clear filters</button></div></form>
    {!data ? <Loading error={error} retry={retry} /> : <>
      <p className="muted">Selected filters must all match. Some listings have unknown work modes or employment types; skill searches also check the description.</p><p role="status">{data.total} {data.total === 1 ? 'job' : 'jobs'} found</p>
      {!data.jobs.length && <p>No jobs match this search. Try broader filters or check again after the next import.</p>}
      {data.jobs.map(job => <article className="panel profile-section" key={job.id}>
        <h2><Link to={`/jobs/${job.id}?${params.toString()}`}>{job.title}</Link></h2><JobFacts job={job} />
        <SaveJobButton jobId={job.id} />
        {job.skills.length > 0 && <ul className="profile-tags">{job.skills.slice(0, 8).map(skill => <li key={skill}>{skill}</li>)}</ul>}
        <p className="muted">Source: <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer">{sourceName(job.source)}</a></p>
      </article>)}
      <nav className="actions" aria-label="Job pages"><button disabled={data.page <= 1} onClick={() => page(data.page - 1)}>Previous</button><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}</span><button disabled={data.page * data.limit >= data.total} onClick={() => page(data.page + 1)}>Next</button></nav>
    </>}
    <p className="muted">Remotive listings are delayed by 24 hours. Availability is confirmed on the source site.</p>
  </div>;
}
export function JobsPage() { const [params] = useSearchParams(); return <JobResults key={params.toString()} />; }
function JobDetail({ id }: { id: string }) {
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const [viewedAt] = useState(Date.now);
  const [params] = useSearchParams();
  const { data, error, retry } = useJobsData<{ job: Job }>(`/${encodeURIComponent(id)}`);
  const job = data?.job;
  return <div className="profile-page job-detail"><Link to={`/jobs?${params.toString()}`}>← Back to jobs</Link>
    {!job ? <Loading error={error} retry={retry} /> : <>
      <section className="panel profile-section"><h1>{job.title}</h1><JobFacts job={job} />
        {job.expiresAt && Date.parse(job.expiresAt) <= viewedAt && <p role="status">This listing has expired.</p>}
        {!!job.metadata.inferredFields?.length && <p className="muted">Some metadata was extracted from the listing text. Confirm details on the original site.</p>}
        {job.metadata.salary && <p>Salary: {job.metadata.salary}</p>}
        {job.metadata.category && <p>Category: {job.metadata.category}</p>}
        <p>Source: {sourceName(job.source)} · Last imported {new Date(job.updatedAt).toLocaleDateString()}</p>
        <a className="profile-edit-link" href={job.sourceUrl} target="_blank" rel="noopener noreferrer">View original listing on {sourceName(job.source)}</a>
        <SaveJobButton jobId={job.id} />
      </section>
      {job.skills.length > 0 && <section className="panel profile-section"><h2>Skills</h2><ul className="profile-tags">{job.skills.map(skill => <li key={skill}>{skill}</li>)}</ul></section>}
      <section className="panel profile-section"><h2>Company research and contacts</h2><p className="muted">External research links. CareerOS has not imported employee reviews or verified a recruiter for this job.</p><div className="actions"><a target="_blank" rel="noopener noreferrer" href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(job.company)}`}>LinkedIn jobs</a><a target="_blank" rel="noopener noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent(job.company + ' employee reviews site:glassdoor.com')}`}>Glassdoor reviews</a><a target="_blank" rel="noopener noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent(job.company + ' employee reviews site:ambitionbox.com')}`}>AmbitionBox reviews</a><a target="_blank" rel="noopener noreferrer" href="https://app.apollo.io/">Research contacts in Apollo</a></div>{!!job.metadata.contactEmails?.length && <div><h3>Emails published in this listing</h3><ul>{job.metadata.contactEmails.map(email => <li key={email}><a href={`mailto:${email}`}>{email}</a></li>)}</ul><p className="muted">These addresses come from the source text. Recruiter identity and deliverability are not independently verified.</p></div>}<p className="muted">Save verified contacts in your private job notes. External services may require their own account or credits.</p></section>
      <JobMatchPanel jobId={job.id} revision={analysisRevision} jobLabel={`${job.title} · ${job.company}`} />
      <JobAnalysisPanel job={job} onSaved={() => setAnalysisRevision(value => value + 1)} />
      <details className="panel profile-section" open><summary>Original job description</summary><p className="profile-prose">{job.description || 'See the original listing for the full description.'}</p></details>
    </>}
  </div>;
}
export function JobDetailPage() { const { id = '' } = useParams(); return <JobDetail key={id} id={id} />; }

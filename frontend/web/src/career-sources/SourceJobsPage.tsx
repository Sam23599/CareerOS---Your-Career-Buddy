import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { type Job } from '../jobs/JobsPage';
import { SaveJobButton } from '../saved-jobs/SaveJobButton';
import { Icon, PageHeading } from '../ui/WorkspaceUi';
import { type CareerSource, type SourceFilters, limitedCoverageMessage } from './types';

type Results = { source: CareerSource; filters: SourceFilters; temporary: boolean; jobs: Job[]; total: number; page: number; limit: number };
function SourceJobs({ id }: { id: string }) {
  const [params, setParams] = useSearchParams(), [data, setData] = useState<Results | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const query = params.toString();
  useEffect(() => {
    let active = true;
    void authenticatedRequest<Results>(`/career-sources/${encodeURIComponent(id)}/jobs?${query}`).then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load source jobs.'); });
    return () => { active = false; };
  }, [id, query, attempt]);
  function page(number: number) { const next = new URLSearchParams(params); next.set('page', String(number)); setParams(next); }
  return <div className="profile-page workspace-page"><Link className="workspace-back-link" to="/career-sources">← Career sources</Link><PageHeading eyebrow="Source matches" title={data ? `${data.source.company} jobs` : 'Matching jobs'} description="Explore listings matched to your source filters and save the opportunities you want to follow." />
    {error && <><p role="alert" className="form-error">{error}</p><button onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></>}
    {!data && !error && <p role="status">Loading matching jobs…</p>}
    {data && <><p className="description">{data.temporary ? 'Matching filters for this check' : 'Matching your saved source filters'}: {data.filters.keywords.join(', ') || 'all roles'} · {data.filters.locations.join(', ') || 'all locations'}.</p>
      {data.temporary && <p className="muted">Your saved source filters are unchanged. <Link to={`/career-sources/${id}/jobs`}>Use saved filters</Link></p>}
      {data.source.coverage === 'limited' && <p className="muted">{limitedCoverageMessage}</p>}
      <p className="workspace-results-summary">{data.total} matching {data.total === 1 ? 'job' : 'jobs'}</p>{!data.jobs.length && <p className="workspace-empty-state">No matches yet. Check the source or broaden your keywords and locations.</p>}
      <div className="workspace-list">{data.jobs.map(job => <article className="panel profile-section source-job-card" key={job.id}><div className="workspace-card-heading"><span className="workspace-card-icon"><Icon name="jobs" /></span><div className="workspace-card-copy"><h2><Link to={`/jobs/${job.id}`}>{job.title}</Link></h2><p>{job.company} · {job.location || 'Location not specified'}</p></div><SaveJobButton jobId={job.id} /></div><p className="muted workspace-card-meta">Source: <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer">{data.source.providerName}</a></p></article>)}</div>
      <nav className="actions workspace-pagination" aria-label="Source job pages"><button disabled={data.page <= 1} onClick={() => page(data.page - 1)}>Previous</button><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}</span><button disabled={data.page * data.limit >= data.total} onClick={() => page(data.page + 1)}>Next</button></nav>
    </>}
  </div>;
}
export function SourceJobsPage() { const { id = '' } = useParams(), [params] = useSearchParams(); return <SourceJobs key={`${id}:${params.toString()}`} id={id} />; }

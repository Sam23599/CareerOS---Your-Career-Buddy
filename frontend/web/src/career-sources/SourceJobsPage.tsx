import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { type Job } from '../jobs/JobsPage';
import { SaveJobButton } from '../saved-jobs/SaveJobButton';
import { PageHeading } from '../ui/WorkspaceUi';
import { type CareerSource, type SourceFilters, limitedCoverageMessage } from './types';

type Results = { source: CareerSource; filters: SourceFilters; temporary: boolean; jobs: (Job & { isNew: boolean })[]; total: number; newTotal: number; page: number; limit: number; since: string; visitedAt: string };
function SourceJobs({ id }: { id: string }) {
  const [params, setParams] = useSearchParams(), [data, setData] = useState<Results | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const boundary = useRef<string | undefined>(undefined), acknowledged = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const edits = useRef<Record<string, string>>({});
  const query = params.toString();
  useEffect(() => {
    const controller = new AbortController();
    const next = new URLSearchParams(query); if (boundary.current) next.set('since', boundary.current);
    void authenticatedRequest<Results>(`/career-sources/${encodeURIComponent(id)}/jobs?${next}`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { boundary.current ??= result.since; setData(result); setError(''); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load jobs.'); });
    return () => controller.abort();
  }, [id, query, attempt]);
  useEffect(() => {
    if (!data || acknowledged.current) return;
    acknowledged.current = true;
    void authenticatedRequest(`/career-sources/${encodeURIComponent(id)}/view`, { method: 'POST', body: JSON.stringify({ visitedAt: data.visitedAt }) }).catch(() => { acknowledged.current = false; });
  }, [data, id]);
  useEffect(() => () => clearTimeout(timer.current), []);
  function edit(key: string, value: string, debounce = false) {
    clearTimeout(timer.current);
    edits.current[key] = value;
    const apply = () => {
      const changes = edits.current; edits.current = {};
      setParams(current => { const next = new URLSearchParams(current); next.delete('page'); for (const [name, text] of Object.entries(changes)) { if (text) next.set(name, text); else next.delete(name); } return next; }, { replace: true });
    };
    if (debounce) timer.current = setTimeout(apply, 300); else apply();
  }
  function page(number: number) { const next = new URLSearchParams(params); next.set('page', String(number)); setParams(next); }
  return <div className="profile-page workspace-page"><Link className="workspace-back-link" to="/career-sources">← Career sources</Link><PageHeading eyebrow="Company feed" title={data ? `${data.source.company} jobs` : 'Matching jobs'} description="New listings since your last visit appear first." />
    <div className="panel workspace-filter-bar profile-grid"><label>Search this feed<input defaultValue={params.get('q') ?? ''} maxLength={100} placeholder="Role, company, skill…" onChange={event => edit('q', event.target.value, true)} /></label><label>Location<input defaultValue={params.get('location') ?? ''} maxLength={100} onChange={event => edit('location', event.target.value, true)} /></label><label>Sort<select value={params.get('sort') ?? 'newest'} onChange={event => edit('sort', event.target.value)}><option value="newest">Newest added</option><option value="oldest">Oldest added</option><option value="posted">Posting date</option><option value="title">Job title</option></select></label></div>
    {error && <><p role="alert" className="form-error">{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry</button></>}
    {!data && !error && <p role="status">Loading matching jobs…</p>}
    {data && <><details className="compact-details"><summary>{data.temporary ? 'Temporary source filters' : 'Saved source filters'}</summary><p>{data.filters.keywords.join(', ') || 'All roles'} · {data.filters.locations.join(', ') || 'All locations'}</p>{data.temporary && <Link to={`/career-sources/${id}/jobs`}>Use saved filters</Link>}<p className="muted">Search above refines this view; it does not change your saved filters or refresh the provider.</p></details>
      {data.source.coverage === 'limited' && <p className="muted">{limitedCoverageMessage}</p>}
      <p className="workspace-results-summary" role="status">{data.total} matches · {data.newTotal} new since your last visit</p>{!data.jobs.length && <p className="workspace-empty-state">No matches. Broaden the search or check the source.</p>}
      {[true, false].map(isNew => { const jobs = data.jobs.filter(job => job.isNew === isNew); return jobs.length > 0 && <section key={String(isNew)} aria-label={isNew ? 'New jobs' : 'Earlier jobs'}><h2 className="feed-group-heading">{isNew ? 'New since your last visit' : 'Earlier listings'}</h2><div className="workspace-list">{jobs.map(job => <article className="panel profile-section source-job-card" key={job.id}><div className="workspace-card-heading compact-card-heading"><div className="workspace-card-copy"><h3><Link to={`/jobs/${job.id}`}>{job.title}</Link></h3><p>{job.company} · {job.location || 'Location not specified'}</p></div><SaveJobButton jobId={job.id} /></div><p className="muted workspace-card-meta"><a href={job.sourceUrl} target="_blank" rel="noopener noreferrer">Original listing</a></p></article>)}</div></section>; })}
      <nav className="actions workspace-pagination" aria-label="Source job pages"><button disabled={data.page <= 1} onClick={() => page(data.page - 1)}>Previous</button><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}</span><button disabled={data.page * data.limit >= data.total} onClick={() => page(data.page + 1)}>Next</button></nav>
    </>}
  </div>;
}
export function SourceJobsPage() { const { id = '' } = useParams(); return <SourceJobs key={id} id={id} />; }

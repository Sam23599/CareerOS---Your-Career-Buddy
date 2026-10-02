import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { notificationsChanged } from '../notifications/NotificationLink';
import { SourceForm } from './SourceForm';
import { type CareerSource, type SourceFilters, type SourceKind, limitedCoverageMessage } from './types';

type Results = { sources: CareerSource[]; total: number; page: number; limit: number };
function SourceCard({ source, reload, saved }: { source: CareerSource; reload: () => void; saved: (kind: SourceKind, message?: string) => void }) {
  const [editing, setEditing] = useState<SourceKind | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [quick, setQuick] = useState({ keywords: source.keywords.join(', '), locations: source.locations.join(', ') });
  const [checkedFilters, setCheckedFilters] = useState<SourceFilters | null>(null);
  const filterId = useId();
  const tags = (value: string) => [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))];
  const filters = { keywords: tags(quick.keywords), locations: tags(quick.locations) };
  const changedFilters = JSON.stringify(filters) !== JSON.stringify({ keywords: source.keywords, locations: source.locations });
  const matchQuery = checkedFilters ? `?${new URLSearchParams({ keywords: JSON.stringify(checkedFilters.keywords), locations: JSON.stringify(checkedFilters.locations) })}` : '';
  const bookmark = source.kind === 'bookmark';
  async function check() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await authenticatedRequest<{ failed: boolean; cached: boolean; temporary: boolean; filters: SourceFilters; matchingCount: number | null }>(`/career-sources/${source.id}/refresh`, { method: 'POST', body: JSON.stringify(changedFilters ? { filters } : {}), signal: AbortSignal.timeout(45_000) });
      setCheckedFilters(result.temporary && !result.failed ? result.filters : null);
      setMessage(result.failed ? 'The source could not be refreshed. Existing listings were kept. Try again later.' : result.temporary ? `${result.matchingCount} matching ${result.matchingCount === 1 ? 'job' : 'jobs'} for this check. ${result.cached ? 'Used the latest cached import.' : 'Career board refreshed.'} Saved filters and alerts stay unchanged.` : result.cached ? 'Checked matching jobs using the latest cached import. Provider imports are limited to once an hour.' : 'Career board refreshed.');
      reload(); if (!result.temporary) notificationsChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check this source.'); }
    finally { setBusy(false); }
  }
  function resetFilters() { setQuick({ keywords: source.keywords.join(', '), locations: source.locations.join(', ') }); setCheckedFilters(null); setMessage(''); setError(''); }
  async function updateFilters() {
    setBusy(true); setError(''); setMessage('');
    try {
      await authenticatedRequest(`/career-sources/${source.id}`, { method: 'PATCH', body: JSON.stringify({ kind: source.kind, company: source.company, careerUrl: source.careerUrl, scanHours: source.scanHours, enabled: source.enabled, revision: source.revision, ...filters }) });
      saved(source.kind, `Saved filters updated for ${source.company}. Future checks and alerts will use them.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update saved filters.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Remove ${source.company} from your ${bookmark ? 'career bookmarks' : 'job sources'}?`)) return;
    setBusy(true); setError('');
    try { await authenticatedRequest(`/career-sources/${source.id}`, { method: 'DELETE' }); reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove this source.'); }
    finally { setBusy(false); }
  }
  if (editing) return <SourceForm source={source} kind={editing} onCancel={() => setEditing(null)} onSaved={kind => { setEditing(null); saved(kind); }} />;
  return <article className="panel profile-section career-source-card">
    <h2>{source.company}</h2><p><a href={source.careerUrl} target="_blank" rel="noopener noreferrer">Open career page</a> · {bookmark ? 'Career bookmark' : `${source.providerName ?? 'Provider unavailable'} · job source`}{!bookmark && !source.enabled && ' · Paused'}</p>
    {bookmark ? <p className="muted">{source.canEnableTracking ? `${source.providerName} supports job tracking. Enable it when you are ready.` : 'Job tracking is not supported for this page yet. Open it to browse manually.'}</p> : <>
    {source.coverage === 'limited' && <p className="muted">{limitedCoverageMessage}</p>}
    <p className="muted">Saved filters · Keywords: {source.keywords.join(', ') || 'All roles'} · Locations: {source.locations.join(', ') || 'All locations'}</p>
    {source.canRefresh && <>
      <p>{source.lastCheckedAt ? `Last check with saved filters: ${new Date(source.lastCheckedAt).toLocaleString()} · ${source.status === 'failed' ? 'Failed' : `${source.matchingCount} matches, ${source.newCount} newly found`}` : 'No checks with saved filters yet.'}</p>
      {source.importedAt && <p className="muted">Listings imported: {new Date(source.importedAt).toLocaleString()}</p>}
      <p className="muted">{source.scanHours ? `Every ${source.scanHours} hours${source.nextScanAt ? ` · Next due: ${new Date(source.nextScanAt).toLocaleString()}` : ''}` : 'Manual checks only'}</p>
      <Link to={`/career-sources/${source.id}/jobs${matchQuery}`}>{checkedFilters ? 'View matches for this check' : 'View matching jobs'}</Link>
    </>}</>}
    {source.canRefresh && <fieldset className="quick-check-filters" disabled={busy}>
      <legend>Filters for Check now (optional)</legend>
      <div className="profile-grid"><label>Keywords for this check<input aria-describedby={`${filterId}-help`} maxLength={3000} placeholder="Engineer, Python, intern" value={quick.keywords} onChange={event => setQuick({ ...quick, keywords: event.target.value })} /></label>
        <label>Locations for this check<input aria-describedby={`${filterId}-help`} maxLength={3000} placeholder="India, Bengaluru, Remote" value={quick.locations} onChange={event => setQuick({ ...quick, locations: event.target.value })} /></label></div>
      <p className="field-help" id={`${filterId}-help`}>Changes apply only to this check unless you choose Update saved filters. Separate values with commas; clear a field for all roles or locations. Saved filters also apply to scheduled checks and alerts, and remain editable in Edit source.</p>
      {(changedFilters || checkedFilters) && <div className="actions"><button type="button" className="secondary" onClick={resetFilters}>Reset to saved filters</button><button type="button" disabled={!changedFilters} onClick={updateFilters}>Update saved filters</button></div>}
      {checkedFilters && <p className="field-help">Last one-time check · Keywords: {checkedFilters.keywords.join(', ') || 'All roles'} · Locations: {checkedFilters.locations.join(', ') || 'All locations'}</p>}
    </fieldset>}
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="actions">{source.canRefresh && <button disabled={busy || !source.enabled} onClick={check}>{busy ? 'Working…' : 'Check now'}</button>}
      {source.canEnableTracking && <button disabled={busy} onClick={() => setEditing('job-source')}>Enable job tracking</button>}
      <button className="secondary" disabled={busy} onClick={() => setEditing(source.kind)}>{bookmark ? 'Edit bookmark' : 'Edit source'}</button><button className="secondary" disabled={busy} onClick={remove}>{bookmark ? 'Remove bookmark' : 'Remove source'}</button></div>
  </article>;
}
function SourceList() {
  const [params, setParams] = useSearchParams(), [data, setData] = useState<Results | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [adding, setAdding] = useState<SourceKind | null>(null);
  const [notice, setNotice] = useState('');
  const kind: SourceKind = params.get('kind') === 'bookmark' ? 'bookmark' : 'job-source';
  const queryParams = new URLSearchParams(params); if (!queryParams.has('kind')) queryParams.set('kind', kind);
  const query = queryParams.toString(), bookmark = kind === 'bookmark';
  useEffect(() => {
    let active = true;
    void authenticatedRequest<Results>(`/career-sources?${query}`).then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load career sources.'); });
    return () => { active = false; };
  }, [query, attempt]);
  const reload = () => { setError(''); setAttempt(value => value + 1); };
  const saved = (savedKind: SourceKind, message = '') => { setNotice(message); setAdding(null); if (savedKind !== kind) setParams({ kind: savedKind }); else reload(); };
  return <div className="profile-page"><nav className="profile-nav"><Link to="/dashboard">← Dashboard</Link><Link to="/jobs">Platform jobs</Link><Link to="/notifications">Notifications</Link></nav>
    <h1>Career sources</h1><p className="description">Track jobs from supported sources or bookmark company career pages for manual visits. Your list and filters are private; imported public listings also appear in the job catalog.</p>
    <nav className="profile-nav career-source-tabs" aria-label="Career source sections"><Link to="?kind=job-source" aria-current={!bookmark ? 'page' : undefined}>Job sources</Link><Link to="?kind=bookmark" aria-current={bookmark ? 'page' : undefined}>Career bookmarks</Link></nav>
    <p className="muted">{bookmark ? 'Bookmarks stay here until you choose to enable job tracking. They do not import jobs or send alerts.' : 'Greenhouse boards and Google Careers support refreshes; Google has limited coverage. Keywords and locations must both match when provided.'}</p>
    {adding ? <SourceForm kind={adding} onCancel={() => setAdding(null)} onSaved={saved} /> : <div className="actions"><button onClick={() => setAdding('job-source')}>Add job source</button><button className="secondary" onClick={() => setAdding('bookmark')}>Bookmark career page</button></div>}
    <form className="panel profile-section source-search" onSubmit={event => { event.preventDefault(); const next = new URLSearchParams({ kind }); for (const [key, value] of new FormData(event.currentTarget)) if (value) next.set(key, String(value)); if (next.toString() === query) reload(); else setParams(next); }}>
      <div className="profile-grid"><label>Search companies<input name="q" maxLength={200} defaultValue={params.get('q') ?? ''} placeholder="Company or career page…" /></label>
        {!bookmark && <label>Tracking status<select name="filter" defaultValue={params.get('filter') ?? ''}><option value="">All job sources</option><option value="paused">Paused</option></select></label>}</div><button>{bookmark ? 'Filter bookmarks' : 'Filter sources'}</button>
    </form>
    {notice && <p role="status">{notice}</p>}
    {error && <><p role="alert" className="form-error">{error}</p><button onClick={reload}>Retry</button></>}
    {!data && !error && <p role="status">Loading career sources…</p>}
    {data && <><p>{data.total} {bookmark ? data.total === 1 ? 'career bookmark' : 'career bookmarks' : data.total === 1 ? 'job source' : 'job sources'}</p>{!data.sources.length && <p>{bookmark ? 'No career bookmarks in this view. Bookmark a company page or change your search.' : 'No job sources in this view. Add a supported source or change your filters.'}</p>}
      {data.sources.map(source => <SourceCard key={`${source.id}:${source.revision}`} source={source} reload={reload} saved={saved} />)}
      <nav className="actions" aria-label="Career source pages"><button disabled={data.page <= 1} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(data.page - 1)); setParams(next); }}>Previous</button><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}</span><button disabled={data.page * data.limit >= data.total} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(data.page + 1)); setParams(next); }}>Next</button></nav>
    </>}
  </div>;
}
export function CareerSourcesPage() { const [params] = useSearchParams(); return <SourceList key={params.toString()} />; }

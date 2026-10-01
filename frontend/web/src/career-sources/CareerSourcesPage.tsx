import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { notificationsChanged } from '../notifications/NotificationLink';
import { SourceForm } from './SourceForm';
import { type CareerSource } from './types';

type Results = { sources: CareerSource[]; total: number; page: number; limit: number };
function SourceCard({ source, reload }: { source: CareerSource; reload: () => void }) {
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function check() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await authenticatedRequest<{ failed: boolean; cached: boolean }>(`/career-sources/${source.id}/refresh`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(45_000) });
      setMessage(result.failed ? 'The source could not be refreshed. Existing listings were kept. Try again later.' : result.cached ? 'Checked matching jobs using the latest cached import. Provider imports are limited to once an hour.' : 'Career board refreshed.');
      reload(); notificationsChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check this source.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Remove ${source.company} from your career sources?`)) return;
    setBusy(true); setError('');
    try { await authenticatedRequest(`/career-sources/${source.id}`, { method: 'DELETE' }); reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove this source.'); }
    finally { setBusy(false); }
  }
  if (editing) return <SourceForm source={source} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />;
  return <article className="panel profile-section career-source-card">
    <h2>{source.company}</h2><p><a href={source.careerUrl} target="_blank" rel="noopener noreferrer">Open career page</a> · {source.provider ? 'Greenhouse · job refresh supported' : 'Saved link · refresh not supported yet'}{!source.enabled && ' · Paused'}</p>
    <p className="muted">Keywords: {source.keywords.join(', ') || 'All roles'} · Locations: {source.locations.join(', ') || 'All locations'}</p>
    {source.provider && <>
      <p>{source.lastCheckedAt ? `Last check: ${new Date(source.lastCheckedAt).toLocaleString()} · ${source.status === 'failed' ? 'Failed' : `${source.matchingCount} matches, ${source.newCount} newly found`}` : 'No checks yet.'}</p>
      {source.importedAt && <p className="muted">Listings imported: {new Date(source.importedAt).toLocaleString()}</p>}
      <p className="muted">{source.scanHours ? `Every ${source.scanHours} hours${source.nextScanAt ? ` · Next due: ${new Date(source.nextScanAt).toLocaleString()}` : ''}` : 'Manual checks only'}</p>
      <Link to={`/career-sources/${source.id}/jobs`}>View matching jobs</Link>
    </>}
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="actions">{source.provider && <button disabled={busy || !source.enabled} onClick={check}>{busy ? 'Working…' : 'Check now'}</button>}
      <button className="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit source</button><button className="secondary" disabled={busy} onClick={remove}>Remove source</button></div>
  </article>;
}
function SourceList() {
  const [params, setParams] = useSearchParams(), [data, setData] = useState<Results | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [adding, setAdding] = useState(false);
  const query = params.toString();
  useEffect(() => {
    let active = true;
    void authenticatedRequest<Results>(`/career-sources?${query}`).then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load career sources.'); });
    return () => { active = false; };
  }, [query, attempt]);
  const reload = () => { setError(''); setAttempt(value => value + 1); };
  return <div className="profile-page"><nav className="profile-nav"><Link to="/dashboard">← Dashboard</Link><Link to="/jobs">Platform jobs</Link><Link to="/notifications">Notifications</Link></nav>
    <h1>Career sources</h1><p className="description">Build your dream-company list and watch for matching roles. Your company list and filters are private; imported public listings also appear in the job catalog.</p>
    <p className="muted">Greenhouse boards support refreshes. Other URLs are saved as links. Keywords and locations are both required to match when you provide both.</p>
    {adding ? <SourceForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} /> : <button onClick={() => setAdding(true)}>Add career source</button>}
    <form className="panel profile-section source-search" onSubmit={event => { event.preventDefault(); const next = new URLSearchParams(); for (const [key, value] of new FormData(event.currentTarget)) if (value) next.set(key, String(value)); if (next.toString() === query) reload(); else setParams(next); }}>
      <div className="profile-grid"><label>Search companies<input name="q" maxLength={200} defaultValue={params.get('q') ?? ''} placeholder="Company or career page…" /></label>
        <label>Source type<select name="filter" defaultValue={params.get('filter') ?? ''}><option value="">All sources</option><option value="supported">Refresh supported</option><option value="reference">Saved links</option><option value="paused">Paused</option></select></label></div><button>Filter sources</button>
    </form>
    {error && <><p role="alert" className="form-error">{error}</p><button onClick={reload}>Retry</button></>}
    {!data && !error && <p role="status">Loading career sources…</p>}
    {data && <><p>{data.total} career {data.total === 1 ? 'source' : 'sources'}</p>{!data.sources.length && <p>No career sources in this view. Add a company or change your filters.</p>}
      {data.sources.map(source => <SourceCard key={`${source.id}:${source.revision}`} source={source} reload={reload} />)}
      <nav className="actions" aria-label="Career source pages"><button disabled={data.page <= 1} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(data.page - 1)); setParams(next); }}>Previous</button><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}</span><button disabled={data.page * data.limit >= data.total} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(data.page + 1)); setParams(next); }}>Next</button></nav>
    </>}
  </div>;
}
export function CareerSourcesPage() { const [params] = useSearchParams(); return <SourceList key={params.toString()} />; }

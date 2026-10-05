import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { Icon, PageHeading } from '../ui/WorkspaceUi';
import { useWorkspaceNavigationGuard } from '../ui/navigation';
import { type SavedJob, statusLabels } from './types';

type List = { savedJobs: SavedJob[]; total: number; page: number; limit: number };
function SavedCard({ initial, onRemove, onDirty, canLeave }: { initial: SavedJob; canLeave: () => boolean; onRemove: (id: string) => void; onDirty: (id: string, dirty: boolean) => void }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState({ notes: initial.notes, status: initial.status, priority: initial.priority });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [viewedAt] = useState(Date.now);
  const dirty = draft.notes !== saved.notes || draft.status !== saved.status || draft.priority !== saved.priority;
  useEffect(() => { onDirty(initial.jobId, dirty); return () => onDirty(initial.jobId, false); }, [initial.jobId, dirty, onDirty]);
  function replace(value: SavedJob) { setSaved(value); setDraft({ notes: value.notes, status: value.status, priority: value.priority }); }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update saved job.'); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void action(async () => {
    const result = await authenticatedRequest<{ savedJob: SavedJob }>(`/saved-jobs/${saved.jobId}`, { method: 'PATCH', body: JSON.stringify({ ...draft, revision: saved.revision }) });
    replace(result.savedJob); setMessage('Changes saved.');
  }); }
  return <article className="panel profile-section saved-job-card">
    <div className="workspace-card-heading"><span className="workspace-card-icon"><Icon name="bookmark" /></span><div className="workspace-card-copy"><h2>{saved.available ? <Link to={`/jobs/${saved.jobId}`} onClick={event => { if (!canLeave()) event.preventDefault(); }}>{saved.job.title}</Link> : saved.job.title}</h2><p>{saved.job.company} · {saved.job.location || 'Location not specified'}</p></div><span className="workspace-badge">{statusLabels[saved.status]}</span></div>
    {!saved.available && <p className="muted">The original job is no longer in the catalog. Your notes are still available.</p>}
    {saved.job.expiresAt && Date.parse(saved.job.expiresAt) <= viewedAt && <p className="muted">This listing has expired.</p>}
    <p className="muted workspace-card-meta">Source: <a href={saved.job.sourceUrl} target="_blank" rel="noopener noreferrer">{saved.job.source === 'remotive' ? 'Remotive' : saved.job.source}</a> · Saved {new Date(saved.savedAt).toLocaleDateString()}</p>
    <form onSubmit={submit}><fieldset disabled={busy}><div className="profile-grid">
      <label>Interest status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as SavedJob['status'] })}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Priority<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as SavedJob['priority'] })}>{['LOW', 'MEDIUM', 'HIGH'].map(value => <option key={value} value={value}>{value[0] + value.slice(1).toLowerCase()}</option>)}</select></label>
      <label className="full-width">Private notes<textarea rows={3} maxLength={5000} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <p role="status">{dirty ? 'You have unsaved changes.' : message}</p>
    <div className="actions"><button disabled={!dirty}>Save changes</button>
      <button type="button" className="secondary" onClick={() => {
        if (dirty && !window.confirm('Discard your unsaved changes and reload this saved job?')) return;
        void action(async () => { const result = await authenticatedRequest<{ savedJob: SavedJob | null }>(`/saved-jobs/${saved.jobId}`); if (result.savedJob) replace(result.savedJob); else onRemove(saved.jobId); });
      }}>Reload saved job</button>
      <button type="button" className="secondary" onClick={() => {
        if (!window.confirm('Remove this saved job and its notes?')) return;
        void action(async () => { await authenticatedRequest(`/saved-jobs/${saved.jobId}`, { method: 'DELETE' }); onRemove(saved.jobId); });
      }}>Unsave job</button>
    </div></fieldset></form>
  </article>;
}
function SavedList() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<List | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const dirty = useRef(new Set<string>());
  const onDirty = useCallback((id: string, changed: boolean) => { if (changed) dirty.current.add(id); else dirty.current.delete(id); }, []);
  const query = params.toString();
  useEffect(() => {
    let active = true;
    void authenticatedRequest<List>(`/saved-jobs?${query}`).then(result => { if (active) setData(result); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load saved jobs.'); });
    return () => { active = false; };
  }, [query, attempt]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current.size) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  function canLeave() { return !dirty.current.size || window.confirm('Discard your unsaved saved-job changes?'); }
  useWorkspaceNavigationGuard(canLeave);
  function navigate(next: URLSearchParams) {
    if (!canLeave()) return;
    if (next.toString() === query) { setData(null); setError(''); setAttempt(value => value + 1); }
    else setParams(next);
  }
  return <div className="profile-page workspace-page"><nav className="profile-nav"><Link to="/dashboard" onClick={event => { if (!canLeave()) event.preventDefault(); }}>← Dashboard</Link><Link to="/jobs" onClick={event => { if (!canLeave()) event.preventDefault(); }}>Find more jobs</Link></nav>
    <PageHeading eyebrow="Your next opportunities" title="Saved jobs" description="Keep your shortlist, priorities, and private notes together. Interest status is separate from an application’s progress." />
    <form className="panel profile-section workspace-filter-bar" onSubmit={event => { event.preventDefault(); const next = new URLSearchParams(); for (const [key, value] of new FormData(event.currentTarget)) if (value) next.set(key, String(value)); navigate(next); }}>
      <div className="profile-grid"><label>Filter by status<select name="status" defaultValue={params.get('status') ?? ''}><option value="">All statuses</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Filter by priority<select name="priority" defaultValue={params.get('priority') ?? ''}><option value="">All priorities</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label></div>
      <button>Apply filters</button>
    </form>
    {error && <><p role="alert" className="form-error">{error}</p><button onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></>}
    {!data && !error && <p role="status">Loading saved jobs…</p>}
    {data && <><p className="workspace-results-summary">{data.total} saved {data.total === 1 ? 'job' : 'jobs'}</p>
      {!data.savedJobs.length && <p className="workspace-empty-state">No saved jobs match this view. Save a job from search or change your filters.</p>}
      <div className="workspace-list">{data.savedJobs.map(item => <SavedCard key={item.jobId} initial={item} onDirty={onDirty} canLeave={canLeave} onRemove={id => setData(current => current ? { ...current, total: Math.max(0, current.total - 1), savedJobs: current.savedJobs.filter(item => item.jobId !== id) } : current)} />)}</div>
      <nav className="actions workspace-pagination" aria-label="Saved job pages">{[-1, 1].map(direction => <button key={direction} disabled={direction === -1 ? data.page <= 1 : data.page * data.limit >= data.total} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(data.page + direction)); navigate(next); }}>{direction === -1 ? 'Previous' : 'Next'}</button>)}<span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}</span></nav>
    </>}
  </div>;
}
export function SavedJobsPage() { const [params] = useSearchParams(); return <SavedList key={params.toString()} />; }

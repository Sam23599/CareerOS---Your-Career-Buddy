import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest, useSession } from '../auth/session';
import { type SavedJob } from './types';

function SavedAction({ jobId }: { jobId: string }) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void authenticatedRequest<{ savedJob: SavedJob | null }>(`/saved-jobs/${jobId}`)
      .then(result => { if (active) setSaved(Boolean(result.savedJob)); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not check saved status.'); });
    return () => { active = false; };
  }, [jobId, attempt]);
  async function toggle() {
    if (saved && !window.confirm('Remove this saved job and its notes?')) return;
    setBusy(true); setError('');
    try { await authenticatedRequest(`/saved-jobs/${jobId}`, { method: saved ? 'DELETE' : 'PUT' }); setSaved(!saved); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update saved job.'); }
    finally { setBusy(false); }
  }
  return <div className="save-job-action">
    <button className="secondary" disabled={busy || saved === null} onClick={() => void toggle()}>{busy ? 'Updating…' : saved === null ? 'Checking saved status…' : saved ? 'Unsave job' : 'Save job'}</button>
    {saved && <Link to="/saved-jobs">Manage saved jobs</Link>}
    {error && <><p role="alert" className="form-error">{error}</p><button className="secondary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry saved status</button></>}
  </div>;
}
export function SaveJobButton({ jobId }: { jobId: string }) {
  const session = useSession();
  if (session.state === 'loading') return <p className="muted">Checking your session…</p>;
  if (session.state !== 'authenticated') return <p><Link to="/login">Sign in to save jobs</Link></p>;
  return <SavedAction key={`${session.user!.id}-${jobId}`} jobId={jobId} />;
}

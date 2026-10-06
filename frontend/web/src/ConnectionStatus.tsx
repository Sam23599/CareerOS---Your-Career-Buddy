import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest, useSession } from './auth/session';
import { PageHeading } from './ui/WorkspaceUi';
type Status = { api: boolean; mongodb: boolean; intelligence: boolean; parser: boolean; postgresql: boolean; aiConfigured: boolean };
export function ConnectionStatus() {
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const session = useSession();
  useEffect(() => {
    if (session.state !== 'authenticated') return;
    const controller = new AbortController();
    void authenticatedRequest<Status>('/system/status', { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setStatus(result); setError(''); } }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Cannot check services.'); });
    return () => controller.abort();
  }, [attempt, session.state]);
  return <div className="workspace-page service-status-page"><PageHeading eyebrow="Workspace health" title="Service status" description="Live local checks. Optional intelligence outages do not disable the core workspace." /><section className="panel profile-section">
    {session.state !== 'authenticated' ? <p><Link to="/login">Sign in</Link> to check private service dependencies.</p> : <>
      {error && <p role="alert" className="form-error">{error}</p>}
      {!status && !error && <p role="status">Checking services…</p>}
      <dl><div><dt>React frontend</dt><dd className="up">Page loaded</dd></div>{(['api', 'mongodb', 'intelligence', 'parser', 'postgresql'] as const).map((key, index) => <div key={key}><dt>{['CareerOS API', 'Platform MongoDB', 'Python intelligence', 'PDF parser', 'Intelligence PostgreSQL'][index]}</dt><dd className={status?.[key] ? 'up' : 'down'}>{status ? (!status.intelligence && ['parser', 'postgresql'].includes(key) ? 'Cannot verify' : status[key] ? 'Connected' : 'Unavailable') : error ? 'Cannot verify' : 'Checking…'}</dd></div>)}<div><dt>OpenAI configuration</dt><dd>{status ? !status.intelligence ? 'Cannot verify' : status.aiConfigured ? 'Configured' : 'Not configured' : 'Checking…'}</dd></div></dl>
      <p className="muted">Provider connectivity and quota are not tested here. No paid AI request is made.</p><button onClick={() => { setStatus(null); setAttempt(value => value + 1); }}>Check again</button>
    </>}
  </section></div>;
}

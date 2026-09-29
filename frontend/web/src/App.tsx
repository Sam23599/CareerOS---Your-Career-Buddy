import { useEffect, useState } from 'react';

type Connection = 'checking' | 'up' | 'down';
type Status = { api: Connection; database: Connection };
const checking: Status = { api: 'checking', database: 'checking' };

async function probe(path: string, expectedStatus: string, signal: AbortSignal) {
  try {
    const response = await fetch(path, { signal });
    const body: unknown = await response.json();
    return response.ok && typeof body === 'object' && body !== null
      && 'status' in body && body.status === expectedStatus;
  } catch {
    return false;
  }
}

export function App() {
  const [status, setStatus] = useState<Status>(checking);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let active = true;
    void Promise.all([
      probe('/api/v1/health', 'ok', controller.signal),
      probe('/api/v1/ready', 'ready', controller.signal),
    ]).then(([api, database]) => {
      if (active) setStatus({ api: api ? 'up' : 'down', database: database ? 'up' : 'down' });
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  const busy = status.api === 'checking';
  const connected = status.api === 'up' && status.database === 'up';
  const label = (value: Connection) => value === 'checking' ? 'Checking…' : value === 'up' ? 'Connected' : 'Unavailable';

  return (
    <main>
      <header><span className="logo" aria-hidden="true">C</span><strong>CareerOS</strong><span className="badge">Local development</span></header>
      <section className="intro">
        <p className="eyebrow">Your career buddy</p>
        <h1>A starting point for<br />your next chapter.</h1>
        <p className="description">Discover opportunities, prepare with purpose, and keep your career journey in one place.</p>
      </section>
      <section className="panel" aria-labelledby="status-heading">
        <h2 id="status-heading">Connection status</h2>
        <p className="muted">The first building block of CareerOS.</p>
        <dl aria-live="polite">
          <div><dt>React frontend</dt><dd className="up">Running</dd></div>
          <div><dt>Express API</dt><dd className={status.api}>{label(status.api)}</dd></div>
          <div><dt>MongoDB</dt><dd className={status.database}>{status.api === 'down' ? 'Cannot verify' : label(status.database)}</dd></div>
        </dl>
        <p role="status">{busy ? 'Checking local services…' : connected ? 'All connected. Your local foundation is ready.' : 'A connection needs attention. Check the service logs and try again.'}</p>
        <button disabled={busy} onClick={() => { setStatus(checking); setAttempt(value => value + 1); }}>Check again</button>
      </section>
      <footer>Next up: your account and career profile.</footer>
    </main>
  );
}

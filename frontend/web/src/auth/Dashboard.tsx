import { useEffect, useState } from 'react';
import { getCurrentUser, signOut, useSession, type User } from './session';

export function Dashboard() {
  const session = useSession();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void getCurrentUser().then(value => { if (active) setUser(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load your account.'); });
    return () => { active = false; };
  }, [attempt, session.user?.id]);

  async function logout() {
    setBusy(true);
    setError('');
    try { await signOut(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign out. Please retry.'); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel auth-panel" aria-labelledby="dashboard-heading">
      <p className="eyebrow">Your workspace</p>
      <h1 id="dashboard-heading">Welcome{user ? `, ${user.name}` : ''}.</h1>
      {user ? <p className="description">You’re signed in as <strong>{user.email}</strong>.</p> : !error && <p role="status">Loading your account…</p>}
      <p>Your account is ready. Career profiles are the next step.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions">
        {error && <button className="secondary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry account</button>}
        <button onClick={logout} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </section>
  );
}

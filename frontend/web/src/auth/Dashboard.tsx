import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { getCurrentUser, signOut, useSession, type User } from './session';
import { PasswordPrompt } from './PasswordSettings';
import { Icon, type IconName } from '../ui/WorkspaceUi';

const tools: { to: string; title: string; description: string; icon: IconName }[] = [
  { to: '/resumes', title: 'Manage resumes', description: 'Keep your documents, extracted text and structured drafts together.', icon: 'resume' },
  { to: '/jobs', title: 'Find jobs', description: 'Explore live listings and understand what each opportunity asks for.', icon: 'jobs' },
  { to: '/saved-jobs', title: 'Saved jobs', description: 'Give your shortlist a home, with priorities and private notes.', icon: 'bookmark' },
  { to: '/career-sources', title: 'Career sources', description: 'Follow company job feeds and bookmark career pages you care about.', icon: 'sources' },
  { to: '/notifications', title: 'Notifications', description: 'Catch up on new opportunities from your connected sources.', icon: 'bell' },
];

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
    <section className="workspace-dashboard" aria-labelledby="dashboard-heading">
      <div className="workspace-page-heading"><div>
      <p className="eyebrow">Your workspace</p>
      {session.user?.passwordPromptPending && <PasswordPrompt />}
      <h1 id="dashboard-heading">Welcome{user ? `, ${user.name}` : ''}.</h1>
      {user ? <p className="description">You’re signed in as <strong>{user.email}</strong>.</p> : !error && <p role="status">Loading your account…</p>}
      </div><span className="workspace-badge"><Icon name="shield" />Your personal workspace</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dashboard-intro-grid">
        <section className="dashboard-feature"><div className="dashboard-feature-copy"><p className="eyebrow">A little clarity goes a long way</p><h2>Your next chapter.<br />All in one place.</h2><p>Add your skills, experience, and career preferences to your profile.</p><Link className="dashboard-feature-link" to="/profile">View career profile<Icon name="arrow-right" /></Link></div><div className="dashboard-feature-art" aria-hidden="true"><svg viewBox="0 0 220 210" fill="none"><circle cx="110" cy="105" r="86" stroke="currentColor" strokeDasharray="3 8" /><circle cx="110" cy="105" r="63" stroke="currentColor" /><path d="M43 150 85 110l31 20 60-82" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><path d="m155 47 24-3-1 24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="85" cy="110" r="5" fill="currentColor" /><circle cx="116" cy="130" r="5" fill="currentColor" /></svg><span className="dashboard-art-label"><Icon name="check" />Build your own path</span></div></section>
        <section className="panel dashboard-guide"><span className="workspace-card-icon"><Icon name="sparkles" /></span><h2>Move with intention</h2><p className="muted">Your workspace follows the way you prepare.</p><ol><li><span>01</span><div><strong>Tell your story</strong><p>Bring your experience into focus.</p></div></li><li><span>02</span><div><strong>Explore what’s next</strong><p>Find roles and follow companies.</p></div></li><li><span>03</span><div><strong>Keep a thoughtful shortlist</strong><p>Organize the possibilities.</p></div></li></ol></section>
      </div>
      <div className="dashboard-section-heading"><h2>Make yourself at home</h2><p className="muted">Everything you need for the next step.</p></div>
      <div className="dashboard-tools">{tools.map(tool => <Link className="dashboard-tool" to={tool.to} key={tool.to} aria-label={tool.title}><span className="workspace-card-icon"><Icon name={tool.icon} /></span><div><h3>{tool.title}</h3><p>{tool.description}</p></div><Icon name="arrow-right" className="dashboard-tool-arrow" /></Link>)}</div>
      <div className="dashboard-account-actions actions">
        {error && <button className="secondary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry account</button>}
        <button className="secondary" onClick={logout} disabled={busy}><Icon name="log-out" />{busy ? 'Signing out…' : 'Sign out'}</button>
      </div>
    </section>
  );
}

import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { OAuthButtons } from './OAuthButtons';
import { forgetAccount, rememberedAccount, signIn, signOut, startProviderSignIn, useSession } from './session';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const session = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [params] = useSearchParams();
  const [error, setError] = useState(params.get('oauth') === 'account_exists'
    ? 'This email already has an account. Please use your original sign-in method.'
    : params.has('oauth') ? 'Provider sign-in could not be completed. Please try again.' : '');
  const registering = mode === 'register';
  const remembered = rememberedAccount();
  const account = session.user ?? remembered;
  if (session.state === 'authenticated' && registering) return <Navigate to="/dashboard" replace />;

  async function switchAccount() {
    setBusy(true);
    setError('');
    try {
      if (account?.oauthProvider) await startProviderSignIn(account.oauthProvider, true);
      else { await signOut(); setShowForm(true); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  async function continueAccount() {
    if (session.state === 'authenticated') { navigate('/dashboard'); return; }
    if (!account?.oauthProvider || account.hasPassword) { setShowForm(true); return; }
    setBusy(true); setError('');
    try { await startProviderSignIn(account.oauthProvider); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  async function otherSignInOptions() {
    setBusy(true); setError('');
    try { if (session.state === 'authenticated') await signOut(); setShowForm(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { setBusy(false); }
  }

  if (!registering && account && !showForm) {
    const user = account;
    const initials = user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    return <section className="panel auth-panel" aria-labelledby="auth-heading">
      <p className="eyebrow">Your career buddy</p><h1 id="auth-heading">Welcome back.</h1>
      <button className="remembered-account" type="button" disabled={busy} onClick={continueAccount}>
        <span className="profile-avatar" aria-hidden="true">{initials}</span>
        <span>Continue as <strong>{user.name}</strong><span className="muted account-email">{user.email}</span></span>
      </button>
      <p className="muted">{session.state === 'authenticated' ? 'Your CareerOS session is still active in this browser.' : 'Sign in again to continue with this account.'}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="secondary" disabled={busy} onClick={switchAccount}>
        {busy ? 'Please wait…' : user.oauthProvider ? `Sign in with another ${user.oauthProvider === 'github' ? 'GitHub' : 'Google'} account` : 'Sign in with another account'}
      </button>
      <p><button type="button" className="text-button" disabled={busy} onClick={otherSignInOptions}>Use email or other sign-in options</button></p>
      {session.state !== 'authenticated' && <p><button type="button" className="text-button" disabled={busy} onClick={() => { forgetAccount(); setShowForm(true); }}>Forget this account</button></p>}
    </section>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      await signIn(mode, {
        identifier: String(data.get('identifier')), password: String(data.get('password')),
        ...(registering ? { name: String(data.get('name')) } : {}),
      });
      navigate('/dashboard', { replace: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel auth-panel" aria-labelledby="auth-heading">
      <p className="eyebrow">Your career buddy</p>
      <h1 id="auth-heading">{registering ? 'Start your next chapter.' : 'Welcome back.'}</h1>
      <p className="description">{registering ? 'Create your CareerOS account to get started.' : 'Sign in to continue your career journey.'}</p>
      <OAuthButtons />
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          {registering && <label>Your name<input name="name" autoComplete="name" required maxLength={100} /></label>}
          <label>{registering ? 'Email' : 'Email or username'}<input name="identifier" type={registering ? 'email' : 'text'} autoComplete={registering ? 'email' : 'username'} required maxLength={254} defaultValue={registering ? '' : remembered?.email ?? ''} /></label>
          <label>Password<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 12 : 1} maxLength={128} aria-describedby={registering ? 'password-help' : undefined} /></label>
          {registering && <p id="password-help" className="muted">Use 12–128 characters. A memorable passphrase works well.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit">{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}</button>
        </fieldset>
      </form>
      <p className="muted">{registering ? 'Already have an account? ' : 'New to CareerOS? '}<Link to={registering ? '/login' : '/register'}>{registering ? 'Sign in' : 'Create an account'}</Link></p>
    </section>
  );
}

import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { OAuthButtons } from './OAuthButtons';
import { signIn, useSession } from './session';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const [error, setError] = useState(params.get('oauth') === 'account_exists'
    ? 'This email already has an account. Please use your original sign-in method.'
    : params.has('oauth') ? 'Provider sign-in could not be completed. Please try again.' : '');
  const registering = mode === 'register';
  if (session.state === 'authenticated') return <Navigate to="/dashboard" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      await signIn(mode, {
        email: String(data.get('email')), password: String(data.get('password')),
        ...(registering ? { name: String(data.get('name')) } : {}),
      });
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
          <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
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

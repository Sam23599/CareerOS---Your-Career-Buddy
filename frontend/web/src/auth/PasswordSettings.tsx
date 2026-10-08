import { useEffect, useRef, useState, type FormEvent } from 'react';
import { addPassword, dismissPasswordPrompt, RequestError, startProviderSignIn, useSession } from './session';
import { useDialogDismiss } from '../ui/dialogDismiss';

function PasswordForm({ onSaved }: { onSaved?: () => void }) {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reauth, setReauth] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get('password') !== data.get('confirmation')) { setError('The passwords do not match.'); return; }
    setBusy(true); setError('');
    try { await addPassword(String(data.get('password'))); onSaved?.(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add your password.');
      setReauth(cause instanceof RequestError && cause.code === 'REAUTH_REQUIRED');
    } finally { setBusy(false); }
  }
  async function confirmIdentity() {
    if (!user?.oauthProvider) return;
    setBusy(true);
    try { await startProviderSignIn(user.oauthProvider); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.'); setBusy(false); }
  }
  return <form onSubmit={submit}>
    <p className="muted">Optional: add a CareerOS password to sign in directly with {user?.email}. Your provider sign-in will still work.</p>
    <fieldset disabled={busy}>
      <label>New CareerOS password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required aria-describedby="new-password-help" /></label>
      <p className="muted" id="new-password-help">Use 12–128 characters. Choose a password for CareerOS.</p>
      <label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      {error && <p role="alert" className="form-error">{error}</p>}
      {reauth ? <button type="button" onClick={confirmIdentity}>Confirm with {user?.oauthProvider === 'github' ? 'GitHub' : 'Google'}</button>
        : <button type="submit">{busy ? 'Saving…' : 'Set password'}</button>}
    </fieldset>
  </form>;
}

export function PasswordSettings() {
  const { user } = useSession();
  const [info, setInfo] = useState(false);
  const [editing, setEditing] = useState(false);
  if (!user) return null;
  return <section className="panel profile-section" aria-labelledby="password-heading">
    <div className="password-heading"><h2 id="password-heading">Password</h2>
      <button className="secondary info-button" type="button" aria-label="About your CareerOS password" aria-expanded={info} aria-controls="password-info" onClick={() => setInfo(value => !value)}>ⓘ</button>
    </div>
    {info && <p id="password-info" className="muted">A CareerOS password lets you use email and password on the login page. It is optional for provider accounts. You can keep using GitHub or Google.</p>}
    <p>{user.hasPassword ? 'Password is set. You can sign in with your email and password.' : 'No CareerOS password set. You can keep using provider sign-in.'}</p>
    {!user.hasPassword && (editing ? <PasswordForm onSaved={() => setEditing(false)} /> : <button type="button" onClick={() => setEditing(true)}>Add optional password</button>)}
  </section>;
}

export function PasswordPrompt() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  async function dismiss() {
    if (busy) return;
    setBusy(true); setError('');
    try { await dismissPasswordPrompt(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your choice.'); setBusy(false); }
  }
  const dismissal = useDialogDismiss(() => { void dismiss(); });
  return <dialog ref={dialog} className="password-prompt" aria-labelledby="password-prompt-title" {...dismissal}>
    <h2 id="password-prompt-title">Make your next login easier</h2>
    {editing ? <PasswordForm /> : <p>You can add an optional CareerOS password now or later from your profile. Then you can sign in directly with your email.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="actions">
      {!editing && <button type="button" disabled={busy} onClick={() => setEditing(true)}>Set a password</button>}
      <button type="button" className="secondary" disabled={busy} onClick={dismiss} autoFocus>{busy ? 'Saving…' : 'Skip for now'}</button>
    </div>
  </dialog>;
}

import { useState, type FormEvent } from 'react';
import { setUsername, useSession } from './session';

export function UsernameSettings() {
  const { user } = useSession();
  const [value, setValue] = useState(user?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setSaved(false);
    try { await setUsername(value); setValue(value.trim().toLowerCase()); setSaved(true); setEditing(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your username.'); }
    finally { setBusy(false); }
  }
  return <section className="panel profile-section" aria-labelledby="username-heading">
    <h2 id="username-heading">Sign-in username</h2>
    <p className="muted">Optional: choose a CareerOS username to use instead of your email when signing in with a password.</p>
    <p>{user?.username ? `Your username: ${user.username}` : 'No CareerOS username set.'}</p>
    {saved && <p role="status">Username saved.</p>}
    {!editing ? <button type="button" onClick={() => { setValue(user?.username ?? ''); setSaved(false); setEditing(true); }}>{user?.username ? 'Edit username' : 'Add username'}</button>
      : <form onSubmit={submit}><fieldset disabled={busy}>
      <label>CareerOS username<input name="username" autoComplete="username" value={value} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" aria-describedby="username-help" onChange={event => { setValue(event.target.value); setSaved(false); }} /></label>
      <p id="username-help" className="muted">Use 3–30 letters, numbers or underscores. Usernames ignore letter case. Leave empty to remove it.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button type="submit">{busy ? 'Saving…' : 'Save username'}</button>
    </fieldset></form>}
  </section>;
}

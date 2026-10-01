import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { notificationsChanged } from './NotificationLink';

type Preferences = { newJobs: boolean; sourceErrors: boolean };
type Notification = { id: string; title: string; message: string; href: string; createdAt: string; read: boolean };
type Results = { notifications: Notification[]; total: number; unreadCount: number; page: number; limit: number };
function NotificationPreferences() {
  const [preferences, setPreferences] = useState<Preferences | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void authenticatedRequest<{ preferences: Preferences }>('/notifications/preferences').then(result => { if (active) setPreferences(result.preferences); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load preferences.'); });
    return () => { active = false; };
  }, [attempt]);
  return <form className="panel profile-section" onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); setMessage(''); void authenticatedRequest<{ preferences: Preferences }>('/notifications/preferences', { method: 'PATCH', body: JSON.stringify(preferences) }).then(result => { setPreferences(result.preferences); setMessage('Notification preferences saved.'); }).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not save preferences.')).finally(() => setBusy(false)); }}>
    <h2>Notification preferences</h2>{preferences ? <fieldset disabled={busy}>
      <label className="check-label"><input type="checkbox" checked={preferences.newJobs} onChange={event => { setMessage(''); setPreferences({ ...preferences, newJobs: event.target.checked }); }} />New matching jobs</label>
      <label className="check-label"><input type="checkbox" checked={preferences.sourceErrors} onChange={event => { setMessage(''); setPreferences({ ...preferences, sourceErrors: event.target.checked }); }} />Career source failures</label><button>{busy ? 'Saving…' : 'Save notification preferences'}</button>
    </fieldset> : !error && <p role="status">Loading preferences…</p>}
    <p className="muted">Preferences apply to future in-app alerts. Turning an alert off keeps existing notifications.</p>
    {error && <><p role="alert" className="form-error">{error}</p><button className="secondary" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Reload preferences</button></>}{message && <p role="status">{message}</p>}
  </form>;
}
function NotificationList() {
  const [params, setParams] = useSearchParams(), [data, setData] = useState<Results | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  const query = params.toString();
  useEffect(() => {
    let active = true;
    void authenticatedRequest<Results>(`/notifications?${query}`).then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load notifications.'); });
    return () => { active = false; };
  }, [query, attempt]);
  async function update(id?: string, read?: boolean) {
    setBusy(true); setError('');
    try { await authenticatedRequest(`/notifications/${id ?? 'read-all'}`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(id ? { read } : {}) }); setAttempt(value => value + 1); notificationsChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update notifications.'); }
    finally { setBusy(false); }
  }
  return <>
    <div className="actions"><button className="secondary" onClick={() => setParams(params.get('unread') === 'true' ? {} : { unread: 'true' })}>{params.get('unread') === 'true' ? 'Show all notifications' : 'Show unread only'}</button><button disabled={busy || !data?.unreadCount} onClick={() => update()}>Mark all as read</button></div>
    {error && <><p role="alert" className="form-error">{error}</p><button onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry notifications</button></>}
    {!data && !error && <p role="status">Loading notifications…</p>}
    {data && <><p>{data.unreadCount} unread · {data.total} notifications in this view</p>{!data.notifications.length && <p>No notifications yet. Add a supported career source and check it for matching jobs.</p>}
      {data.notifications.map(item => <article className={`panel profile-section notification-card${item.read ? '' : ' unread'}`} key={item.id}><h2>{item.title}</h2><p>{item.message}</p><p className="muted">{item.read ? 'Read' : 'Unread'} · {new Date(item.createdAt).toLocaleString()}</p><div className="actions"><Link to={item.href}>View details</Link><button className="secondary" disabled={busy} onClick={() => update(item.id, !item.read)}>{item.read ? 'Mark as unread' : 'Mark as read'}</button></div></article>)}
      <nav className="actions" aria-label="Notification pages"><button disabled={data.page <= 1} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(data.page - 1)); setParams(next); }}>Previous</button><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.limit))}</span><button disabled={data.page * data.limit >= data.total} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(data.page + 1)); setParams(next); }}>Next</button></nav>
    </>}
  </>;
}
export function NotificationsPage() { const [params] = useSearchParams(); return <div className="profile-page"><nav className="profile-nav"><Link to="/dashboard">← Dashboard</Link><Link to="/career-sources">Career sources</Link></nav><h1>Notifications</h1><p className="description">Matching-job alerts and career source updates, together in your workspace.</p><NotificationPreferences /><NotificationList key={params.toString()} /></div>; }

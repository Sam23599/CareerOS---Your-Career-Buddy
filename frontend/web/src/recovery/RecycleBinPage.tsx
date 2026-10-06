import { useEffect, useState } from 'react';
import { authenticatedRequest, useSession } from '../auth/session';
import { PageHeading } from '../ui/WorkspaceUi';
type Item = { kind: string; id: string; title: string; trash: { deletedAt: string; expiresAt: string }; archived: boolean };
type Bin = { items: Item[]; binDays: number };
export function RecycleBinPage() {
  const [data, setData] = useState<Bin | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [busy, setBusy] = useState(false), [owner, setOwner] = useState(''), [supportOwner, setSupportOwner] = useState('');
  const session = useSession(), base = supportOwner ? `/recycle-bin/support/${encodeURIComponent(supportOwner)}` : '/recycle-bin';
  useEffect(() => {
    let active = true;
    void authenticatedRequest<Bin>(base).then(result => { if (active) { setData(result); setError(''); } }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load the bin.'); });
    return () => { active = false; };
  }, [base, attempt]);
  async function restore(item: Item) {
    setBusy(true); setError('');
    try { await authenticatedRequest(`${base}/${item.kind}/${item.id}/restore`, { method: 'POST', body: '{}' }); setAttempt(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore item.'); }
    finally { setBusy(false); }
  }
  return <div className="workspace-page profile-page"><PageHeading eyebrow="A second chance" title="Recycle bin" description="Restore recently removed items. After cleanup, retained data is recoverable only through support." />
    {error && <p role="alert" className="form-error">{error}</p>}
    {!data && !error && <p role="status">Loading removed items…</p>}
    {data && <><section className="panel profile-section"><label>Keep new deletions in the bin<select disabled={busy || !!supportOwner} value={data.binDays} onChange={event => {
      const binDays = Number(event.target.value); setBusy(true);
      void authenticatedRequest<{ binDays: number }>('/recycle-bin/preferences', { method: 'PATCH', body: JSON.stringify({ binDays }) }).then(result => setData(current => current ? { ...current, binDays: result.binDays } : current)).catch(cause => setError(cause.message)).finally(() => setBusy(false));
    }}>{[7, 14, 30, 60, 90, ...(![7, 14, 30, 60, 90].includes(data.binDays) ? [data.binDays] : [])].map(days => <option key={days} value={days}>{days} days</option>)}</select></label><p className="muted">Changing this affects future deletions. Cleanup hides entries; it does not erase retained files or analyses.</p></section>
    {!data.items.length && <p className="workspace-empty-state">Your bin is empty.</p>}
    {data.items.map(item => <article className="panel profile-section" key={`${item.kind}:${item.id}`}><div className="workspace-card-heading compact-card-heading"><div className="workspace-card-copy"><h2>{item.title}</h2><p className="muted">{item.kind.replaceAll('-', ' ')} · {item.archived ? 'Retained archive' : `In bin until ${new Date(item.trash.expiresAt).toLocaleDateString()}`}</p></div><button disabled={busy} onClick={() => void restore(item)}>Restore</button></div></article>)}</>}
    {session.user?.roles.includes('ADMIN') && <details className="panel profile-section"><summary>Support recovery</summary><p>Support access is audited. Enter the account ID from a support request.</p><form onSubmit={event => { event.preventDefault(); setSupportOwner(owner.trim()); setData(null); setAttempt(value => value + 1); }}><label>Account ID<input required value={owner} onChange={event => setOwner(event.target.value)} pattern="[a-fA-F0-9-]{36}" /></label><div className="actions"><button>View retained items</button><button type="button" className="secondary" onClick={() => { setSupportOwner(''); setData(null); setAttempt(value => value + 1); }}>Back to my bin</button></div></form></details>}
  </div>;
}

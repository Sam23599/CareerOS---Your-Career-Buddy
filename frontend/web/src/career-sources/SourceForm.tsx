import { useEffect, useId, useState, type FormEvent } from 'react';
import { authenticatedRequest } from '../auth/session';
import { type CareerSource, type SourceKind, type SourceSupport } from './types';
export function SourceForm({ source, kind, onSaved, onCancel }: { source?: CareerSource; kind: SourceKind; onSaved: (kind: SourceKind) => void; onCancel: () => void }) {
  const activating = source?.kind === 'bookmark' && kind === 'job-source';
  const [draft, setDraft] = useState({ company: source?.company ?? '', careerUrl: source?.careerUrl ?? '', keywords: source?.keywords.join(', ') ?? '', locations: source?.locations.join(', ') ?? '', scanHours: source?.scanHours ?? 4, enabled: activating ? true : source?.enabled ?? true });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [detection, setDetection] = useState<{ url: string; support?: SourceSupport; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const id = useId();
  const url = draft.careerUrl.trim();
  useEffect(() => {
    if (!url || kind === 'bookmark') return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void authenticatedRequest<SourceSupport>(`/career-sources/detect?url=${encodeURIComponent(url)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
        .then(support => { if (!controller.signal.aborted) setDetection({ url, support }); })
        .catch(cause => { if (!controller.signal.aborted) setDetection({ url, error: cause instanceof Error ? cause.message : 'Could not check source support.' }); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url, kind, attempt]);
  const current = detection?.url === url ? detection : undefined;
  const automatic = current?.support?.canRefresh;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (kind === 'job-source' && !current?.support) return; setBusy(true); setError('');
    const saveKind = kind === 'bookmark' || !automatic ? 'bookmark' : 'job-source';
    const tags = (value: string) => value.split(',').map(tag => tag.trim()).filter(Boolean);
    try {
      await authenticatedRequest(`/career-sources${source ? `/${source.id}` : ''}`, { method: source ? 'PATCH' : 'POST', body: JSON.stringify({ kind: saveKind, company: draft.company, careerUrl: draft.careerUrl, ...(saveKind === 'job-source' ? { keywords: tags(draft.keywords), locations: tags(draft.locations), scanHours: draft.scanHours, enabled: draft.enabled } : {}), ...(source ? { revision: source.revision } : {}) }) });
      onSaved(saveKind);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this source.'); }
    finally { setBusy(false); }
  }
  const title = activating ? `Enable job tracking for ${source.company}` : kind === 'bookmark' ? source ? 'Edit career bookmark' : 'Bookmark career page' : source ? 'Edit job source' : 'Add job source';
  const saveLabel = kind === 'bookmark' ? source ? 'Save bookmark changes' : 'Save bookmark' : current?.support && !automatic ? 'Save as bookmark' : activating ? 'Enable job tracking' : source ? 'Save source changes' : 'Save job source';
  return <form className="panel profile-section" onSubmit={submit} aria-label={title}>
    <h2>{title}</h2><fieldset disabled={busy}><div className="profile-grid">
      <label>Company name<input required maxLength={200} value={draft.company} onChange={event => setDraft({ ...draft, company: event.target.value })} /></label>
      <label>Career page URL<input type="url" required maxLength={2048} placeholder={kind === 'bookmark' ? 'https://company.com/careers' : 'https://job-boards.greenhouse.io/company'} value={draft.careerUrl} onChange={event => setDraft({ ...draft, careerUrl: event.target.value })} /></label>
      {kind === 'job-source' && automatic && <><div><label>Keywords<input aria-describedby={`${id}-keywords`} maxLength={3000} placeholder="Engineer, Python, intern" value={draft.keywords} onChange={event => setDraft({ ...draft, keywords: event.target.value })} /></label><p className="field-help" id={`${id}-keywords`}>Comma-separated. Matches any keyword in the title, description, or skills. Leave blank for all roles.</p></div>
      <div><label>Locations<input aria-describedby={`${id}-locations`} maxLength={3000} placeholder="India, Bengaluru, Remote" value={draft.locations} onChange={event => setDraft({ ...draft, locations: event.target.value })} /></label><p className="field-help" id={`${id}-locations`}>Comma-separated. Matches any location on the listing. Remote is a location keyword here.</p></div>
      <label>Check frequency<select disabled={!automatic} value={automatic ? draft.scanHours : 0} onChange={event => setDraft({ ...draft, scanHours: Number(event.target.value) })}><option value={0}>Manual only</option>{[4, 12, 24].map(hours => <option key={hours} value={hours}>Every {hours} hours</option>)}</select></label>
      <label className="check-label"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />Enabled</label></>}
    </div>
    <p className="muted" role="status">{kind === 'bookmark' ? 'Save this page for quick access. Bookmarks do not import jobs or run checks.' : current?.support?.message ?? (url ? current?.error ?? 'Checking source support…' : 'Enter a career page URL to check support.')}</p>
    {kind === 'job-source' && automatic && <p className="field-help">Scheduled checks run while CareerOS is running.</p>}
    {kind === 'job-source' && current?.error && <button type="button" className="secondary" onClick={() => { setDetection(undefined); setAttempt(value => value + 1); }}>Retry support check</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="actions"><button disabled={kind === 'job-source' && !current?.support}>{busy ? 'Saving…' : saveLabel}</button><button type="button" className="secondary" onClick={onCancel}>Cancel</button></div></fieldset>
  </form>;
}

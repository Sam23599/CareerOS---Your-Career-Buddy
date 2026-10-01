import { useId, useState, type FormEvent } from 'react';
import { authenticatedRequest } from '../auth/session';
import { type CareerSource } from './types';

function supported(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.port && !url.search && ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(url.hostname) && /^\/[a-z0-9_-]{1,100}\/?$/i.test(url.pathname); } catch { return false; }
}
export function SourceForm({ source, onSaved, onCancel }: { source?: CareerSource; onSaved: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState({ company: source?.company ?? '', careerUrl: source?.careerUrl ?? '', keywords: source?.keywords.join(', ') ?? '', locations: source?.locations.join(', ') ?? '', scanHours: source?.scanHours ?? 4, enabled: source?.enabled ?? true });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const id = useId();
  const automatic = supported(draft.careerUrl);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const tags = (value: string) => value.split(',').map(tag => tag.trim()).filter(Boolean);
    try {
      await authenticatedRequest(`/career-sources${source ? `/${source.id}` : ''}`, { method: source ? 'PATCH' : 'POST', body: JSON.stringify({ ...draft, keywords: tags(draft.keywords), locations: tags(draft.locations), scanHours: automatic ? draft.scanHours : 0, ...(source ? { revision: source.revision } : {}) }) });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this source.'); }
    finally { setBusy(false); }
  }
  return <form className="panel profile-section" onSubmit={submit} aria-label={source ? `Edit ${source.company}` : 'Add career source'}>
    <h2>{source ? 'Edit career source' : 'Add a dream company'}</h2><fieldset disabled={busy}><div className="profile-grid">
      <label>Company name<input required maxLength={200} value={draft.company} onChange={event => setDraft({ ...draft, company: event.target.value })} /></label>
      <label>Career page URL<input type="url" required maxLength={2048} placeholder="https://job-boards.greenhouse.io/company" value={draft.careerUrl} onChange={event => setDraft({ ...draft, careerUrl: event.target.value })} /></label>
      <div><label>Keywords<input aria-describedby={`${id}-keywords`} maxLength={3000} placeholder="Engineer, Python, intern" value={draft.keywords} onChange={event => setDraft({ ...draft, keywords: event.target.value })} /></label><p className="field-help" id={`${id}-keywords`}>Comma-separated. Matches any keyword in the title, description, or skills. Leave blank for all roles.</p></div>
      <div><label>Locations<input aria-describedby={`${id}-locations`} maxLength={3000} placeholder="India, Bengaluru, Remote" value={draft.locations} onChange={event => setDraft({ ...draft, locations: event.target.value })} /></label><p className="field-help" id={`${id}-locations`}>Comma-separated. Matches any location on the listing. Remote is a location keyword here.</p></div>
      <label>Check frequency<select disabled={!automatic} value={automatic ? draft.scanHours : 0} onChange={event => setDraft({ ...draft, scanHours: Number(event.target.value) })}><option value={0}>Manual only</option>{[4, 12, 24].map(hours => <option key={hours} value={hours}>Every {hours} hours</option>)}</select></label>
      <label className="check-label"><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />Enabled</label>
    </div>
    <p className="muted">{automatic ? 'Greenhouse board detected. Scheduled checks run while CareerOS is running.' : 'Other career pages are saved as links. Automatic job reading will need a supported adapter.'}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="actions"><button>{busy ? 'Saving…' : source ? 'Save source changes' : 'Save career source'}</button><button type="button" className="secondary" onClick={onCancel}>Cancel</button></div></fieldset>
  </form>;
}

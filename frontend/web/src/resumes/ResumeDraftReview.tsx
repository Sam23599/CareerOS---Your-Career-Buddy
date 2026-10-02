import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest, RequestError } from '../auth/session';
import { Entries, TagsInput } from '../profiles/Fields';
import { type CareerProfile } from '../profiles/types';
import { DraftReview, fieldLabels, readableValue, supportedFields, type DraftHistory, type DraftRecord, type Fact, type ReviewField, type ReviewValues } from './draftReview';

type Capabilities = { available: boolean; models: { id: string; reasoningOptions: string[] }[]; defaultModel: string; defaultReasoning: string | null };
function label(key: string) { return key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase()); }
function DraftContent({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <>{value.map((item, index) => <div className="draft-item" key={index}><DraftContent value={item} /></div>)}</>;
  if (value && typeof value === 'object') {
    if ('value' in value && 'evidence' in value) {
      const fact = value as Fact;
      return fact.value === null ? <span className="muted">Not stated</span> : <>
        <p className="draft-fact">{fact.value}</p><details><summary>Source evidence</summary>
          {fact.evidence.map((item, index) => <blockquote key={index}><strong>Page {item.page}</strong><p>{item.quote}</p></blockquote>)}
        </details></>;
    }
    return <>{Object.entries(value).map(([key, item]) => <div key={key}><h4>{label(key)}</h4><DraftContent value={item} /></div>)}</>;
  }
  return null;
}

export function ResumeDraftReview({ resume, onClose }: { resume: { id: string; name: string }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [model, setModel] = useState('gpt-6-luna');
  const [reasoning, setReasoning] = useState<string | null>('medium');
  const [record, setRecord] = useState<DraftRecord | null>(null);
  const [history, setHistory] = useState<DraftHistory>({ versions: [], nextBeforeVersion: null });
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [values, setValues] = useState<ReviewValues | null>(null);
  const [selected, setSelected] = useState<ReviewField[]>([]);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dirty = selected.length > 0;
  function close() {
    if (dirty && !window.confirm('Close without applying your reviewed profile changes?')) return;
    onClose();
  }
  useEffect(() => {
    const element = dialog.current!; element.showModal();
    return () => { element.close(); active.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    void Promise.all([
      authenticatedRequest<Capabilities>('/intelligence/capabilities', options),
      authenticatedRequest<{ profile: CareerProfile }>('/profiles/me', options),
      authenticatedRequest<DraftRecord>(`/intelligence/resumes/${resume.id}/draft`, options).catch(cause => {
        if (cause instanceof RequestError && cause.code === 'ANALYSIS_NOT_FOUND') return null;
        throw cause;
      }),
      authenticatedRequest<DraftHistory>(`/intelligence/resumes/${resume.id}/drafts`, options),
    ]).then(([settings, saved, draft, versions]) => {
      if (controller.signal.aborted) return;
      setCapabilities(settings); setModel(settings.defaultModel); setReasoning(settings.defaultReasoning);
      setProfile(saved.profile); setRecord(draft); setValues(draft ? DraftReview.suggest(draft.draft, saved.profile) : null);
      setHistory(versions);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load resume analysis.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [resume.id, attempt]);
  async function analyze() {
    if (!profile) return;
    if (dirty && !window.confirm('Start analysis and discard your current review edits?')) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await authenticatedRequest<DraftRecord>(`/intelligence/resumes/${resume.id}/analyze`, {
        method: 'POST', body: JSON.stringify({ model, reasoning }), signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setRecord(result); setValues(DraftReview.suggest(result.draft, profile)); setSelected([]); setPreview(false); setConflict(false);
        const { id, version, model, reasoning, createdAt } = result;
        setHistory(current => ({ ...current, versions: [{ id, version, model, reasoning, createdAt }, ...current.versions.filter(item => item.id !== id)] }));
      }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not analyze this resume.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function openVersion(analysisId: string) {
    if (!profile || analysisId === record?.id) return;
    if (dirty && !window.confirm('Switch versions and discard your current review edits?')) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await authenticatedRequest<DraftRecord>(`/intelligence/resumes/${resume.id}/draft?analysisId=${encodeURIComponent(analysisId)}`, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setRecord(saved); setValues(DraftReview.suggest(saved.draft, profile)); setSelected([]); setPreview(false); setConflict(false);
      }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not open this version.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function loadOlderVersions() {
    if (history.nextBeforeVersion === null) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError('');
    try {
      const older = await authenticatedRequest<DraftHistory>(`/intelligence/resumes/${resume.id}/drafts?beforeVersion=${history.nextBeforeVersion}`, { signal: controller.signal });
      if (!controller.signal.aborted) setHistory(current => ({ ...older, versions: [...current.versions, ...older.versions.filter(item => !current.versions.some(existing => existing.id === item.id))] }));
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load older versions.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function change(update: Partial<ReviewValues>) { setValues(current => current ? { ...current, ...update } : current); setPreview(false); setMessage(''); }
  async function apply() {
    if (!record || !profile || !values) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(''); setMessage('');
    try {
      const patch = Object.fromEntries(selected.map(key => [key, values[key]]));
      const result = await authenticatedRequest<{ profile: CareerProfile }>(`/intelligence/resumes/${resume.id}/draft/apply`, {
        method: 'POST', body: JSON.stringify({ analysisId: record.id, patch: { version: profile.version, ...patch } }), signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setProfile(result.profile); setSelected([]); setPreview(false); setMessage('Selected fields applied to your profile.');
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setConflict(cause instanceof RequestError && cause.code === 'PROFILE_CONFLICT');
        setError(cause instanceof Error ? cause.message : 'Could not apply the selected fields. Your edits are still here.');
      }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function reloadProfile() {
    setBusy(true); setError('');
    try {
      const result = await authenticatedRequest<{ profile: CareerProfile }>('/profiles/me');
      setProfile(result.profile); setConflict(false); setPreview(false);
      setMessage('Latest profile loaded. Your review edits remain. Compare all selected fields again before applying.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reload profile.'); }
    finally { setBusy(false); }
  }
  const options = capabilities?.models.find(item => item.id === model)?.reasoningOptions ?? [];
  return <dialog className="resume-preview draft-review" ref={dialog} aria-labelledby="draft-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="preview-heading"><h2 id="draft-title">Resume draft — {resume.name}</h2><button type="button" onClick={close} autoFocus>Close draft review</button></div>
    <p>Each analysis sends this resume’s extracted text to OpenAI and saves a new version on success. Generation uses your configured API key and incurs provider charges. Opening saved versions does not call AI. Your profile changes only after review and confirmation.</p>
    {loading && <p role="status">Loading draft…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p role="status">{message} <Link to="/profile">View profile</Link></p>}
    {!loading && !profile && <button onClick={() => { setLoading(true); setError(''); setAttempt(value => value + 1); }}>Retry loading draft</button>}
    {capabilities && <fieldset disabled={busy}><legend>Analysis settings</legend><div className="profile-grid">
      <label>AI model<select value={model} onChange={event => {
        const next = event.target.value; setModel(next);
        const supported = capabilities.models.find(item => item.id === next)?.reasoningOptions ?? [];
        setReasoning(supported.includes('medium') ? 'medium' : null);
      }}>{capabilities.models.map(item => <option key={item.id}>{item.id}</option>)}</select></label>
      {options.length > 0 && <label>Reasoning effort<select value={reasoning ?? 'medium'} onChange={event => setReasoning(event.target.value)}>
        {options.map(option => <option key={option}>{option}</option>)}
      </select></label>}
    </div><p className="muted">GPT-6 Luna is the default low-cost choice. Higher reasoning may take longer. GPT-4.1 has no reasoning setting. Limits: 60 KB input, 16,384 output tokens, 90 seconds.</p>
      {!capabilities.available && <p className="extraction-warning">Analysis is unavailable. Check the server’s OpenAI key and analysis storage setup.</p>}
      <button disabled={!capabilities.available || !profile} onClick={() => void analyze()}>{record ? 'Analyze with selected settings' : 'Analyze resume'}</button>
    </fieldset>}
    {busy && <p role="status">{preview ? 'Applying selected fields…' : 'Working… Analysis may take up to 90 seconds.'}</p>}
    {record && values && profile && <>
      <fieldset disabled={busy}><legend>Saved versions</legend>
        <label>Saved draft version<select value={record.id} onChange={event => void openVersion(event.target.value)}>
          {[...(history.versions.some(item => item.id === record.id) ? [] : [record]), ...history.versions].map(item => <option key={item.id} value={item.id}>
            Version {item.version} · {item.model}{item.reasoning ? ` · ${item.reasoning}` : ''} · {new Date(item.createdAt).toLocaleString()}
          </option>)}
        </select></label>
        {history.nextBeforeVersion !== null && <button type="button" className="secondary" onClick={() => void loadOlderVersions()}>Load older versions</button>}
      </fieldset>
      <p className="muted">Saved draft · Version {record.version} · {record.model}{record.reasoning ? ` · ${record.reasoning} reasoning` : ''} · {new Date(record.createdAt).toLocaleString()}</p>
      {record.extraction.warnings.length > 0 && <section aria-label="Extraction warnings"><h3>Extraction warnings</h3>
        {record.extraction.warnings.map(item => <p className="extraction-warning" key={item.code}>{item.message}</p>)}
      </section>}
      <details><summary>All extracted details and source evidence</summary>
        {Object.entries(record.draft).map(([key, value]) => <section key={key}><h3>{label(key)}</h3><DraftContent value={value} /></section>)}
      </details>
      <h3>Review profile fields</h3>
      <p>Choose the fields to apply. Existing list entries are included; new entries are appended without exact duplicates. Review every row. Year-only or missing dates need a month before importing. Projects, languages, email and other details remain in this saved draft.</p>
      <p className="muted">Review edits are kept in this dialog until applied. The saved source draft and PDF remain available when you reopen.</p>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); setError(''); setPreview(true); }}>
        <fieldset disabled={busy}>
          {supportedFields.map(key => <section className="draft-field" key={key}>
            <label className="check-label"><input type="checkbox" checked={selected.includes(key)} onChange={event => {
              setSelected(current => event.target.checked ? [...current, key] : current.filter(item => item !== key)); setPreview(false);
            }} />Apply {fieldLabels[key]}</label>
            {selected.includes(key) && <>
              {key === 'summary' ? <label>Professional summary<textarea rows={5} maxLength={5000} value={values.summary} onChange={event => change({ summary: event.target.value })} /></label>
                : ['fullName', 'headline', 'location', 'phone'].includes(key) ? <label>{fieldLabels[key]}<input required={key === 'fullName'} maxLength={key === 'fullName' ? 100 : key === 'phone' ? 40 : 200} value={values[key] as string} onChange={event => change({ [key]: event.target.value })} /></label>
                  : key === 'skills' ? <TagsInput key={`skills-${record.id}`} label="Skills to save" values={values.skills} onChange={skills => change({ skills })} />
                    : key === 'experience' ? <Entries label="Experience" max={30} items={values.experience} onChange={experience => change({ experience })} create={() => ({ company: '', role: '', location: '', startDate: '', endDate: '', current: false, description: '' })}
                      fields={[{ key: 'company', label: 'Company', required: true, maxLength: 200 }, { key: 'role', label: 'Role', required: true, maxLength: 200 }, { key: 'location', label: 'Location', maxLength: 200 }, { key: 'startDate', label: 'Start date', type: 'month', required: true }, { key: 'endDate', label: 'End date', type: 'month' }, { key: 'current', label: 'I currently work here', type: 'checkbox' }, { key: 'description', label: 'Responsibilities and achievements', type: 'textarea', maxLength: 3000 }]} />
                      : key === 'education' ? <Entries label="Education" max={20} items={values.education} onChange={education => change({ education })} create={() => ({ institution: '', qualification: '', field: '', startDate: '', endDate: '' })}
                        fields={[{ key: 'institution', label: 'Institution', required: true, maxLength: 200 }, { key: 'qualification', label: 'Qualification', required: true, maxLength: 200 }, { key: 'field', label: 'Field of study', maxLength: 200 }, { key: 'startDate', label: 'Start date', type: 'month', required: true }, { key: 'endDate', label: 'End date', type: 'month' }]} />
                        : key === 'certifications' ? <Entries label="Certification" max={30} items={values.certifications} onChange={certifications => change({ certifications })} create={() => ({ name: '', issuer: '', issuedDate: '', url: '' })}
                          fields={[{ key: 'name', label: 'Certification name', required: true, maxLength: 200 }, { key: 'issuer', label: 'Issuer', maxLength: 200 }, { key: 'issuedDate', label: 'Issue date', type: 'month' }, { key: 'url', label: 'Credential URL', type: 'url', maxLength: 2048 }]} />
                          : key === 'links' ? <Entries label="Professional link" max={20} items={values.links} onChange={links => change({ links })} create={() => ({ label: '', url: '' })}
                            fields={[{ key: 'label', label: 'Link label', required: true, maxLength: 100 }, { key: 'url', label: 'Profile URL', type: 'url', required: true, maxLength: 2048 }]} /> : null}
            </>}
          </section>)}
          <button disabled={!selected.length || conflict}>Preview selected changes</button>
          {conflict && <button type="button" className="secondary" onClick={() => void reloadProfile()}>Reload latest profile</button>}
        </fieldset>
      </form>
      {preview && <section aria-label="Profile change preview"><h3>Confirm profile changes</h3>
        {selected.map(key => <section key={key}><h4>{fieldLabels[key]}</h4><div className="profile-grid">
          <div><strong>Current</strong><pre>{readableValue(profile[key])}</pre></div><div><strong>After applying</strong><pre>{readableValue(values[key])}</pre></div>
        </div></section>)}
        <button disabled={busy || conflict} onClick={() => void apply()}>Confirm and apply to profile</button>
      </section>}
    </>}
  </dialog>;
}

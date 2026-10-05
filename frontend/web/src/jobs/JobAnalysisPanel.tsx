import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest, RequestError, useSession } from '../auth/session';
import { type Job } from './JobsPage';
import { type JobAnalysisRecord, type JobAnalysisSummary, type JobEvidence, type JobFact, type JobWarning, type Requirement } from '../../../../backend/platform/src/intelligence/jobs';

type SavedAnalysis = { analysis: JobAnalysisRecord; sourceStatus: { stale: boolean; expired: boolean } };
type History = { versions: (JobAnalysisSummary & { stale: boolean })[]; nextBeforeVersion: number | null };
type Capabilities = { available: boolean; models: { id: string; reasoningOptions: string[] }[]; defaultModel: string; defaultReasoning: string | null };
const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase());

function Evidence({ items }: { items: JobEvidence[] }) {
  return <>{items.map((item, index) => <blockquote key={index}><strong>{label(item.section)}</strong><p className="profile-prose">{item.quote}</p></blockquote>)}</>;
}
function Fact({ item }: { item: JobFact }) {
  return <div className="draft-item">
    <p className="draft-fact">{item.value ?? 'Not stated'} {'priority' in item && <span className="muted">· {(item as Requirement).priority}</span>}</p>
    {item.evidence.length > 0 && <details><summary>Source evidence</summary><Evidence items={item.evidence} /></details>}
    {'priority' in item && (item as Requirement).priorityEvidence.length > 0 && <details><summary>Why this priority?</summary><Evidence items={(item as Requirement).priorityEvidence} /></details>}
  </div>;
}

function Analysis({ job, onSaved }: { job: Job; onSaved?: () => void }) {
  const active = useRef<AbortController | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [saved, setSaved] = useState<SavedAnalysis | null>(null);
  const [history, setHistory] = useState<History>({ versions: [], nextBeforeVersion: null });
  const [model, setModel] = useState('gpt-6-luna');
  const [reasoning, setReasoning] = useState<string | null>('medium');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [viewedAt] = useState(Date.now);
  const base = `/intelligence/jobs/${job.id}`;
  const expired = Boolean(job.expiresAt && Date.parse(job.expiresAt) <= viewedAt);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    const options = { signal: controller.signal };
    void Promise.all([
      authenticatedRequest<Capabilities>('/intelligence/jobs/capabilities', options),
      authenticatedRequest<SavedAnalysis>(`${base}/analysis`, options).catch(cause => {
        if (cause instanceof RequestError && cause.code === 'JOB_ANALYSIS_NOT_FOUND') return null;
        throw cause;
      }),
      authenticatedRequest<History>(`${base}/analyses`, options),
    ]).then(([settings, record, versions]) => {
      if (controller.signal.aborted) return;
      setCapabilities(settings); setModel(settings.defaultModel); setReasoning(settings.defaultReasoning);
      setSaved(record); setHistory(versions);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load job analysis.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); active.current?.abort(); };
  }, [base, attempt]);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError('');
    try { await action(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Job analysis could not be completed.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function analyze() {
    void run(async signal => {
      const result = await authenticatedRequest<SavedAnalysis>(`${base}/analyze`, { method: 'POST', body: JSON.stringify({ model, reasoning }), signal });
      if (signal.aborted) return;
      setSaved(result);
      onSaved?.();
      const { id, version, createdAt, source } = result.analysis;
      setHistory(current => ({ ...current, versions: [{ id, version, model: result.analysis.model, reasoning: result.analysis.reasoning, createdAt, sourceHash: source.sha256, stale: false }, ...current.versions.filter(item => item.id !== id)] }));
    });
  }
  function openVersion(id: string) {
    void run(async signal => {
      const result = await authenticatedRequest<SavedAnalysis>(`${base}/analysis?analysisId=${encodeURIComponent(id)}`, { signal });
      if (!signal.aborted) setSaved(result);
    });
  }
  function loadOlder() {
    void run(async signal => {
      const result = await authenticatedRequest<History>(`${base}/analyses?beforeVersion=${history.nextBeforeVersion}`, { signal });
      if (!signal.aborted) setHistory(current => ({ ...result, versions: [...current.versions, ...result.versions.filter(item => !current.versions.some(known => known.id === item.id))] }));
    });
  }
  const options = capabilities?.models.find(item => item.id === model)?.reasoningOptions ?? [];
  const record = saved?.analysis;
  const comparisons = record ? [
    { field: 'Location', listing: job.location, extracted: (record.analysis.location as JobFact).value },
    { field: 'Work mode', listing: job.remoteType === 'UNKNOWN' ? '' : job.remoteType.toLowerCase(), extracted: (record.analysis.workMode as JobFact).value },
    { field: 'Employment type', listing: job.employmentType === 'UNKNOWN' ? '' : job.employmentType.toLowerCase().replaceAll('_', ' '), extracted: (record.analysis.employmentType as JobFact).value },
    { field: 'Compensation', listing: job.metadata.salary ?? '', extracted: (record.analysis.compensation as JobFact).value },
  ] : [];
  const wordingDiffers = comparisons.some(item => item.listing && item.extracted && item.listing.trim().toLowerCase() !== item.extracted.trim().toLowerCase());
  return <section id="job-analysis" className="panel profile-section job-analysis" aria-label="Job analysis"><h2>Job analysis</h2>
    <p>Analyze job sends this listing’s text to OpenAI and incurs provider charges. Each successful click saves a new version. Saved versions open without another AI call.</p>
    {loading && <p role="status">Loading saved analysis…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!loading && !capabilities && <button onClick={() => { setLoading(true); setError(''); setAttempt(value => value + 1); }}>Retry loading analysis</button>}
    {capabilities && <fieldset disabled={busy}><legend>Job analysis settings</legend><div className="profile-grid">
      <label>AI model<select value={model} onChange={event => {
        setModel(event.target.value);
        setReasoning(capabilities.models.find(item => item.id === event.target.value)?.reasoningOptions.includes('medium') ? 'medium' : null);
      }}>{capabilities.models.map(item => <option key={item.id}>{item.id}</option>)}</select></label>
      {options.length > 0 && <label>Reasoning effort<select value={reasoning ?? 'medium'} onChange={event => setReasoning(event.target.value)}>{options.map(item => <option key={item}>{item}</option>)}</select></label>}
    </div>
      {!capabilities.available && <p className="extraction-warning">New analysis is unavailable. Check the server’s AI configuration. Saved versions remain readable.</p>}
      {!job.description.trim() && <p className="muted">This listing has no description to analyze. Check the original listing.</p>}
      <button disabled={!capabilities.available || expired || saved?.sourceStatus.expired || !job.description.trim()} onClick={analyze}>{record ? 'Analyze job again' : 'Analyze job'}</button>
    </fieldset>}
    {busy && <><p role="status">Working… Analysis may take up to 90 seconds.</p><button className="secondary" onClick={() => { active.current?.abort(); setBusy(false); }}>Cancel processing</button></>}
    {record && <>
      <fieldset disabled={busy}><legend>Saved job analyses</legend><label>Saved analysis version<select value={record.id} onChange={event => openVersion(event.target.value)}>
        {[...(history.versions.some(item => item.id === record.id) ? [] : [{ ...record, stale: saved!.sourceStatus.stale }]), ...history.versions].map(item =>
          <option key={item.id} value={item.id}>Version {item.version} · {item.model}{item.reasoning ? ` · ${item.reasoning}` : ''} · {new Date(item.createdAt).toLocaleString()}{item.stale ? ' · Listing changed' : ''}</option>)}
      </select></label>{history.nextBeforeVersion !== null && <button className="secondary" onClick={loadOlder}>Load older analyses</button>}</fieldset>
      <p className="muted">Saved analysis · Version {record.version} · {record.model} · {new Date(record.createdAt).toLocaleString()}</p>
      {saved!.sourceStatus.stale && <p className="extraction-warning" role="status">This listing changed since this analysis. The results and quotes below describe the saved version. Analyze again for current requirements.</p>}
      {(expired || saved!.sourceStatus.expired) && <p className="extraction-warning">This listing has expired. Saved analysis remains available for reference.</p>}
      {wordingDiffers && <p className="extraction-warning">Some listing details and extracted details use different wording. Review both and confirm on the original listing.</p>}
      <table><caption>Listing details and saved analysis</caption><thead><tr><th>Field</th><th>Listing details</th><th>Extracted details</th></tr></thead>
        <tbody>{comparisons.map(item => <tr key={item.field}><th>{item.field}</th><td>{item.listing || 'Not specified'}</td><td>{item.extracted ?? 'Not stated'}</td></tr>)}</tbody>
      </table>
      {(record.analysis.warnings as JobWarning[]).map((warning, index) => <div className="extraction-warning" key={index}><p>{warning.message}</p><details><summary>Warning evidence</summary><Evidence items={warning.evidence} /></details></div>)}
      <p className="muted">Required/preferred labels use explicit English wording or headings. Unspecified means the priority could not be established. These results do not change the original listing or your profile.</p>
      {Object.entries(record.analysis).filter(([key]) => key !== 'warnings').map(([key, value]) => <section key={key}><h3>{label(key)}</h3>
        {Array.isArray(value) ? value.length ? (value as JobFact[]).map((item, index) => <Fact key={index} item={item} />) : <p className="muted">Not stated</p> : <Fact item={value as JobFact} />}
      </section>)}
    </>}
  </section>;
}

export function JobAnalysisPanel({ job, onSaved }: { job: Job; onSaved?: () => void }) {
  const session = useSession();
  if (session.state === 'loading') return null;
  if (session.state !== 'authenticated') return <p><Link to="/login">Sign in to analyze this job</Link></p>;
  return <Analysis key={`${session.user!.id}:${job.id}`} job={job} onSaved={onSaved} />;
}

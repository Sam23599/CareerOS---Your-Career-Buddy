import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest, useSession } from '../auth/session';
import { type DraftHistory } from '../../../../backend/platform/src/intelligence/drafts';
import { type JobAnalysisSummary } from '../../../../backend/platform/src/intelligence/jobs';
import { type MatchItem, type MatchResponse } from '../../../../backend/platform/src/intelligence/matching';

type Resume = { id: string; name: string; version: number; active: boolean; deleting?: boolean };
type JobHistory = { versions: (JobAnalysisSummary & { stale: boolean })[]; nextBeforeVersion: number | null };
const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete this comparison. Please retry.';

function MatchRow({ item }: { item: MatchItem }) {
  const status = { matched: 'Matched', not_found: 'Not found in selected inputs', needs_review: 'Needs your review' }[item.status];
  return <li className="match-item">
    <div className="match-item-heading"><strong>{item.requirement.value ?? 'Not stated'}</strong><span className="workspace-badge">{status}</span></div>
    <p className="muted">{label(item.category)} · {item.requirement.priority} · {item.weight ? `${item.weight} score ${item.weight === 1 ? 'point' : 'points'}` : 'Outside the score'}</p>
    {item.candidate && <p>Found in {item.candidate.source === 'profile' ? 'your profile skills (self-reported)' : `your resume’s ${label(item.candidate.field.split('.')[0]).toLowerCase()}`}: <strong>{item.candidate.value}</strong></p>}
    <details><summary>View comparison evidence</summary>
      <p className="eyebrow">Job requirement</p>
      {item.requirement.evidence.map((evidence, index) => <blockquote key={index}><strong>{label(evidence.section)}</strong><p className="profile-prose">{evidence.quote}</p></blockquote>)}
      {item.requirement.priorityEvidence.length > 0 && <><p className="eyebrow">Why this priority?</p>{item.requirement.priorityEvidence.map((evidence, index) => <blockquote key={index}><p className="profile-prose">{evidence.quote}</p></blockquote>)}</>}
      {item.candidate?.source === 'resume' && <><p className="eyebrow">Resume evidence</p>{item.candidate.evidence.map((evidence, index) => <blockquote key={index}><strong>Page {evidence.page}</strong><p className="profile-prose">{evidence.quote}</p></blockquote>)}</>}
    </details>
  </li>;
}

function Comparison({ jobId }: { jobId: string }) {
  const active = useRef<AbortController | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumeId, setResumeId] = useState('');
  const [drafts, setDrafts] = useState<DraftHistory>({ versions: [], nextBeforeVersion: null });
  const [draftId, setDraftId] = useState('');
  const [jobs, setJobs] = useState<JobHistory>({ versions: [], nextBeforeVersion: null });
  const [jobAnalysisId, setJobAnalysisId] = useState('');
  const [includeProfileSkills, setIncludeProfileSkills] = useState(false);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftLoading, setDraftLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const base = `/intelligence/jobs/${jobId}`;

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      authenticatedRequest<{ resumes: Resume[] }>('/resumes', { signal: controller.signal }),
      authenticatedRequest<JobHistory>(`${base}/analyses`, { signal: controller.signal }),
    ]).then(([library, history]) => {
      if (controller.signal.aborted) return;
      const available = library.resumes.filter(item => !item.deleting);
      const chosen = available.find(item => item.active) ?? available[0];
      setResumes(available); setResumeId(chosen?.id ?? ''); setDraftLoading(Boolean(chosen));
      setJobs(history); setJobAnalysisId(history.versions.find(item => !item.stale)?.id ?? '');
    }).catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); active.current?.abort(); };
  }, [base, attempt]);

  useEffect(() => {
    if (!resumeId) return;
    const controller = new AbortController();
    void authenticatedRequest<DraftHistory>(`/intelligence/resumes/${resumeId}/drafts`, { signal: controller.signal })
      .then(history => { if (!controller.signal.aborted) { setDrafts(history); setDraftId(history.versions[0]?.id ?? ''); } })
      .catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setDraftLoading(false); });
    return () => controller.abort();
  }, [resumeId, attempt]);

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError('');
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(errorMessage(cause)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function compare(event: FormEvent) {
    event.preventDefault(); setResult(null);
    void run(async signal => {
      const response = await authenticatedRequest<MatchResponse>(`${base}/match`, { method: 'POST',
        body: JSON.stringify({ resumeId, draftId, jobAnalysisId, includeProfileSkills }), signal });
      if (!signal.aborted) setResult(response);
    });
  }
  function older(kind: 'resume' | 'job') {
    void run(async signal => {
      if (kind === 'resume') {
        const history = await authenticatedRequest<DraftHistory>(`/intelligence/resumes/${resumeId}/drafts?beforeVersion=${drafts.nextBeforeVersion}`, { signal });
        if (!signal.aborted) setDrafts(current => ({ ...history, versions: [...current.versions, ...history.versions.filter(item => !current.versions.some(known => known.id === item.id))] }));
      } else {
        const history = await authenticatedRequest<JobHistory>(`${base}/analyses?beforeVersion=${jobs.nextBeforeVersion}`, { signal });
        if (!signal.aborted) { setJobs(current => ({ ...history, versions: [...current.versions, ...history.versions.filter(item => !current.versions.some(known => known.id === item.id))] }));
          if (!jobAnalysisId) setJobAnalysisId(history.versions.find(item => !item.stale)?.id ?? ''); }
      }
    });
  }
  const match = result?.match;
  const groups = match ? [
    { title: 'Matched skills', items: match.items.filter(item => item.status === 'matched') },
    { title: 'Skills not found', items: match.items.filter(item => item.status === 'not_found') },
    { title: 'Requirements to review', items: match.items.filter(item => item.status === 'needs_review') },
  ] : [];
  return <section className="panel profile-section job-matching" aria-label="CV-to-job matching">
    <div className="section-heading"><div><p className="eyebrow">Understand your fit</p><h2>Compare your CV to this job</h2></div></div>
    <p>Use saved resume and job analyses to compare skills and review other requirements. Comparing makes no new AI call.</p>
    {loading && <p role="status">Loading comparison inputs…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="secondary" disabled={loading || busy || draftLoading} onClick={() => {
      setResult(null); setError(''); setLoading(true); setDrafts({ versions: [], nextBeforeVersion: null }); setDraftId(''); setJobAnalysisId(''); setAttempt(value => value + 1);
    }}>Refresh comparison inputs</button>
    {!loading && <>
      {!resumes.length && <p><Link to="/resumes">Upload and analyze a resume</Link> to prepare your comparison.</p>}
      {!jobAnalysisId && <p className="extraction-warning"><a href="#job-analysis">Analyze the current job description</a> before comparing. Older analyses of changed listings cannot be used.</p>}
      <form onSubmit={compare}><fieldset disabled={busy}><legend>Comparison inputs</legend><div className="profile-grid">
        <label>Resume version<select value={resumeId} onChange={event => {
          setResumeId(event.target.value); setDrafts({ versions: [], nextBeforeVersion: null }); setDraftId(''); setDraftLoading(true); setResult(null); setError('');
        }} disabled={!resumes.length}><option value="" disabled>Select a resume</option>{resumes.map(item => <option key={item.id} value={item.id}>{item.name} · PDF version {item.version}{item.active ? ' · Active' : ''}</option>)}</select></label>
        <label>CV analysis version<select value={draftId} disabled={draftLoading || !drafts.versions.length} onChange={event => { setDraftId(event.target.value); setResult(null); }}>
          <option value="" disabled>{draftLoading ? 'Loading analyses…' : 'No saved analysis'}</option>{drafts.versions.map(item => <option key={item.id} value={item.id}>Version {item.version} · {item.model} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
        <label>Job analysis for comparison<select value={jobAnalysisId} onChange={event => { setJobAnalysisId(event.target.value); setResult(null); }}>
          <option value="" disabled>No current saved analysis</option>{jobs.versions.map(item => <option key={item.id} value={item.id} disabled={item.stale}>Version {item.version} · {item.model}{item.stale ? ' · Listing changed' : ''}</option>)}</select></label>
      </div>
        {draftLoading && <p role="status">Loading saved CV analyses…</p>}
        {resumeId && !draftLoading && !drafts.versions.length && <p><Link to="/resumes">Analyze this resume</Link> first, then refresh these inputs.</p>}
        <div className="actions">{drafts.nextBeforeVersion !== null && <button type="button" className="secondary" onClick={() => older('resume')}>Load older CV analyses</button>}{jobs.nextBeforeVersion !== null && <button type="button" className="secondary" onClick={() => older('job')}>Load older job analyses</button>}</div>
        <label className="check-label"><input type="checkbox" checked={includeProfileSkills} onChange={event => { setIncludeProfileSkills(event.target.checked); setResult(null); }} />Include my saved profile skills</label>
        <p className="muted">Profile skills are self-reported and labelled separately from quoted CV evidence.</p>
        <button disabled={draftLoading || !draftId || !jobAnalysisId}>Compare CV to job</button>
      </fieldset></form>
    </>}
    {busy && <p role="status">Working on your comparison…</p>}
    {match && <div className="match-result">
      {result.sourceStatus.expired && <p className="extraction-warning">This listing has expired. This comparison is for reference; check the original listing.</p>}
      <div className="match-score"><div><p className="eyebrow">Skill coverage</p><p className="match-score-value" role="status">{match.score === null ? 'Not enough information to score' : `${match.score}%`}</p></div><p>{match.matchedWeight} of {match.totalWeight} weighted points matched</p></div>
      <p>A skills checklist, not a hiring probability or employer ATS score. “Not found” means absent from the selected inputs, not that you lack the skill.</p>
      <p className="muted">PDF version {match.source.resume.resumeVersion} · CV analysis {match.source.draftVersion} · Job analysis {match.source.jobAnalysisVersion}{match.source.profileVersion !== null ? ` · Profile version ${match.source.profileVersion}` : ''}</p>
      <details><summary>How is this score calculated?</summary><p>Matched points ÷ total points × 100, rounded to the nearest whole percent. Required skills count 3 points, unspecified 2, preferred 1. Repeated skills count once at their strongest priority. Exact names and a small documented alias list are compared. Ambiguous phrases and other requirements need your review and do not count toward the score.</p></details>
      {groups.map(group => <details className="match-group" key={group.title} open><summary>{group.title} ({group.items.length})</summary>{group.items.length ? <ul className="match-items">{group.items.map((item, index) => <MatchRow key={index} item={item} />)}</ul> : <p className="muted">No items in this group.</p>}</details>)}
      {match.notStated.length > 0 && <p className="muted">Not stated in the saved job analysis: {match.notStated.map(label).join(', ')}.</p>}
      <p className="muted">This comparison is shown for the selected versions. Compare again after updating your inputs.</p>
    </div>}
  </section>;
}

export function JobMatchPanel({ jobId, revision }: { jobId: string; revision: number }) {
  const session = useSession();
  if (session.state !== 'authenticated') return null;
  return <Comparison key={`${session.user!.id}:${jobId}:${revision}`} jobId={jobId} />;
}

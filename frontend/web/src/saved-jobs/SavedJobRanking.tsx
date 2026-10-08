import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { type DraftHistory } from '../../../../backend/platform/src/intelligence/drafts';
import { type RankingResponse, type DeferredJob } from '../../../../backend/platform/src/intelligence/ranking';
import { analysisVersionLabel } from '../intelligence/analysisLabels';

type Resume = { id: string; name: string; version: number; active: boolean; deleting?: boolean };
const reasons: Record<DeferredJob['reason'], string> = {
  analysis_required: 'Analyze this job first', stale_analysis: 'Listing changed — analyze it again',
  expired: 'Listing expired', unavailable: 'Listing no longer available',
  not_interested: 'Marked not interested', no_scorable_skills: 'No clear skills to score — review manually',
};

function RankingControls({ filters, canLeave }: { filters: { status: string; priority: string; location?: string; postedFrom?: string; postedTo?: string; applicationStatus?: string; companyHistory?: string }; canLeave: () => boolean }) {
  const [resumes, setResumes] = useState<Resume[] | null>(null);
  const [resumeId, setResumeId] = useState('');
  const [history, setHistory] = useState<DraftHistory | null>(null);
  const [draftId, setDraftId] = useState('');
  const [includeProfileSkills, setIncludeProfileSkills] = useState(false);
  const [usePreferences, setUsePreferences] = useState(true);
  const [result, setResult] = useState<RankingResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const active = useRef<AbortController | null>(null);
  const errorFocus = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void authenticatedRequest<{ resumes: Resume[] }>('/resumes', { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      const available = value.resumes.filter(item => !item.deleting);
      setResumes(available); setResumeId(available.find(item => item.active)?.id ?? available[0]?.id ?? '');
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load resumes.'); });
    return () => { controller.abort(); active.current?.abort(); };
  }, [attempt]);
  useEffect(() => {
    if (!resumeId) return;
    const controller = new AbortController();
    void authenticatedRequest<DraftHistory>(`/intelligence/resumes/${resumeId}/drafts`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setHistory(value); setDraftId(value.versions[0]?.id ?? ''); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load CV analyses.'); });
    return () => controller.abort();
  }, [resumeId, attempt]);
  useEffect(() => { if (error) errorFocus.current?.focus(); }, [error]);
  function clear() { setResult(null); setError(''); setShowAll(false); }
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) { setResult(null); setError(cause instanceof Error ? cause.message : 'Could not rank saved jobs.'); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function rank(event: FormEvent) {
    event.preventDefault(); clear();
    void run(async signal => {
      const value = await authenticatedRequest<RankingResponse>('/intelligence/saved-jobs/rank', {
        method: 'POST', signal, body: JSON.stringify({ resumeId, draftId, includeProfileSkills, usePreferences, filters }),
      });
      if (!signal.aborted) setResult(value);
    });
  }
  const jobLink = (job: { jobId: string; title: string }) => <Link to={`/jobs/${job.jobId}`} onClick={event => { if (!canLeave()) event.preventDefault(); }}>{job.title}</Link>;
  return <>
    <p className="muted">Compare your shortlist with a saved CV analysis. No new AI call.</p>
    <details className="compact-details"><summary>How ranking works</summary><p>Skill coverage first; your preferences, priority and saved date break ties. All filtered pages are included, up to 50 jobs. Not-interested jobs are excluded. This is not a hiring probability or an employer ATS score.</p></details>
    {error && <p ref={errorFocus} tabIndex={-1} role="alert" className="form-error">{error}</p>}
    {!resumes && !error && <p role="status">Loading resumes…</p>}
    {resumes?.length === 0 && <p>Upload and analyze a CV first. <Link to="/resumes" onClick={event => { if (!canLeave()) event.preventDefault(); }}>Open resumes</Link></p>}
    {!!resumes?.length && <form onSubmit={rank}><fieldset disabled={busy}>
      <div className="profile-grid">
        <label>Resume for ranking<select value={resumeId} onChange={event => { clear(); setHistory(null); setDraftId(''); setResumeId(event.target.value); }}>
          {resumes.map(item => <option key={item.id} value={item.id}>{item.name} · PDF version {item.version}{item.active ? ' · Active' : ''}</option>)}
        </select></label>
        <label>CV analysis for ranking<select value={draftId} disabled={!history?.versions.length} onChange={event => { clear(); setDraftId(event.target.value); }}>
          {!history?.versions.length && <option value="">{history ? 'No saved analysis' : 'Loading analyses…'}</option>}
          {history?.versions.map(item => <option key={item.id} value={item.id}>{analysisVersionLabel(resumes.find(resume => resume.id === resumeId)?.name ?? 'Resume', item)}</option>)}
        </select></label>
      </div>
      {history?.versions.length === 0 && <p>Analyze this resume before ranking. <Link to="/resumes" onClick={event => { if (!canLeave()) event.preventDefault(); }}>Open resumes</Link></p>}
      <div className="ranking-options">
        <label className="checkbox-label"><input type="checkbox" checked={usePreferences} onChange={event => { clear(); setUsePreferences(event.target.checked); }} />Use profile preferences</label>
        <label className="checkbox-label"><input type="checkbox" checked={includeProfileSkills} onChange={event => { clear(); setIncludeProfileSkills(event.target.checked); }} />Include profile skills</label>
      </div>
      <div className="actions"><button disabled={!draftId}>Rank saved jobs</button>
        {history?.nextBeforeVersion !== null && history?.nextBeforeVersion !== undefined && <button type="button" className="secondary" onClick={() => void run(async signal => {
          const older = await authenticatedRequest<DraftHistory>(`/intelligence/resumes/${resumeId}/drafts?beforeVersion=${history.nextBeforeVersion}`, { signal });
          if (!signal.aborted) setHistory(current => ({ ...older, versions: [...(current?.versions ?? []), ...older.versions.filter(item => !current?.versions.some(known => known.id === item.id))] }));
        })}>Load older CV analyses</button>}
      </div>
    </fieldset></form>}
    <div className="actions">
      <button type="button" className="secondary" disabled={busy} onClick={() => { clear(); setResumes(null); setHistory(null); setDraftId(''); setAttempt(value => value + 1); }}>Refresh CV analyses</button>
      {busy && <button type="button" className="secondary" onClick={() => { active.current?.abort(); setBusy(false); }}>Cancel ranking request</button>}
    </div>
    {busy && <p role="status">Reading saved analyses…</p>}
    {result && <section className="ranking-report" aria-label="Saved-job ranking results">
      <p role="status">{result.ranked.length} ranked · {result.unranked.length} need attention or are excluded</p>
      <p className="muted">CV analysis v{result.source.draftVersion}{result.source.profileVersion !== null ? ` · Profile v${result.source.profileVersion}` : ''} · {new Date(result.createdAt).toLocaleString()}. Results are a snapshot; rank again after changing inputs.</p>
      <details className="compact-details"><summary>Score limits</summary><p className="muted">This measures stated skills, not hiring likelihood. Salary, experience, eligibility and other requirements still need review. Preference matches use literal phrases.</p></details>
      {!result.ranked.length && <p>No jobs can be ranked yet. Review the actions below.</p>}
      <ol className="ranking-list">{(showAll ? result.ranked : result.ranked.slice(0, 5)).map(job => <li key={job.jobId}>
        <details><summary><span className="ranking-number">{job.rank}</span><span className="ranking-title">{job.title}<small>{job.company} · {job.location || 'Location not specified'}</small></span><strong>{job.score}%<small>skill coverage</small></strong></summary>
          <div className="ranking-detail">
            <p>{job.matchedWeight} of {job.totalWeight} weighted skill points · Job analysis v{job.jobAnalysisVersion} · {job.priority.toLowerCase()} saved priority.</p>
            <p>Matched: {job.matchedSkills.join(', ') || 'None found in the selected inputs'}.</p>
            {!!job.missingSkills.length && <p>Not found: {job.missingSkills.map(skill => `${skill.value} (${skill.priority})`).join(', ')}. This does not prove you lack these skills.</p>}
            {!!job.profileOnlySkills.length && <p>Profile only: {job.profileOnlySkills.join(', ')}. Check whether your CV supports these skills.</p>}
            {!!job.reviewCount && <p>{job.reviewCount} requirements need manual review and do not affect this score.</p>}
            {job.preferences.length ? <ul>{job.preferences.map(preference => <li key={preference.kind}>{preference.kind.replace('_', ' ')}: {preference.status === 'matched' ? 'Preference matched' : preference.status === 'unknown' ? 'Not specified in listing' : 'No literal preference match'} · Wanted {preference.wanted.join(' / ')} · Listing {preference.actual || 'Unknown'}</li>)}</ul> : <p>No preference tie-breakers applied.</p>}
            <p>{jobLink(job)} — open the job to review quoted requirements and preparation gaps.</p>
          </div>
        </details>
      </li>)}</ol>
      {result.ranked.length > 5 && <button className="secondary" onClick={() => setShowAll(value => !value)}>{showAll ? 'Show top 5' : `Show all ${result.ranked.length} ranked jobs`}</button>}
      {!!result.unranked.length && <details className="ranking-deferred"><summary>Jobs outside the ranking ({result.unranked.length})</summary><ul>{result.unranked.map(job => <li key={job.jobId}>{job.reason === 'unavailable' ? job.title : jobLink(job)}<small>{job.company} · {reasons[job.reason]}</small></li>)}</ul></details>}
    </section>}
  </>;
}

export function SavedJobRanking({ filters, revision, canLeave }: { filters: { status: string; priority: string; location?: string; postedFrom?: string; postedTo?: string; applicationStatus?: string; companyHistory?: string }; revision: number; canLeave: () => boolean }) {
  const [open, setOpen] = useState(false);
  return <details className="panel profile-section saved-ranking" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Rank your shortlist <span className="muted">Choose a CV and see what fits</span></summary>
    {open && <RankingControls key={revision} filters={filters} canLeave={canLeave} />}
  </details>;
}

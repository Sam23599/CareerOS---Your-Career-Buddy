import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { PageHeading } from '../ui/WorkspaceUi';
import { AiSettings, useAiSettings } from '../intelligence/AiSettings';
import { type DraftHistory, type DraftRecord } from '../../../../backend/platform/src/intelligence/drafts';
import { type CadyResult } from '../../../../backend/platform/src/intelligence/cady';
import { type JobAnalysisSummary } from '../../../../backend/platform/src/intelligence/jobs';
import { type SavedJob } from '../saved-jobs/types';

type Resume = { id: string; name: string; version: number; active: boolean; deleting?: boolean };
type Job = { id: string; title: string; company: string };
type JobHistory = { versions: (JobAnalysisSummary & { stale: boolean })[] };
type Turn = { question: string; result: CadyResult };

export function CadyPage() {
  const [query] = useSearchParams(), relatedJob = query.get('jobId'), relatedResume = query.get('resumeId'), relatedDraft = query.get('draftId');
  return <CadyWorkspace key={JSON.stringify([relatedJob, relatedResume, relatedDraft])} relatedJob={relatedJob} relatedResume={relatedResume} relatedDraft={relatedDraft} />;
}

function CadyWorkspace({ relatedJob, relatedResume, relatedDraft }: { relatedJob: string | null; relatedResume: string | null; relatedDraft: string | null }) {
  const settings = useAiSettings(), active = useRef<AbortController | null>(null), end = useRef<HTMLDivElement>(null);
  const [resumes, setResumes] = useState<Resume[]>([]), [resumeId, setResumeId] = useState(''), [drafts, setDrafts] = useState<DraftHistory>({ versions: [], nextBeforeVersion: null }), [draftId, setDraftId] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]), [selected, setSelected] = useState<string[]>([]), [histories, setHistories] = useState<Record<string, JobHistory>>({}), [analyses, setAnalyses] = useState<Record<string, string>>({});
  const [includeProfileSkills, setIncludeProfileSkills] = useState(false), [question, setQuestion] = useState(''), [turns, setTurns] = useState<Turn[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true), [savedPage, setSavedPage] = useState(1), [moreJobs, setMoreJobs] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([authenticatedRequest<{ resumes: Resume[] }>('/resumes', { signal: controller.signal }),
      authenticatedRequest<{ savedJobs: SavedJob[]; total: number }>('/saved-jobs?limit=20', { signal: controller.signal }),
      relatedJob && /^[a-f0-9]{64}$/.test(relatedJob) ? authenticatedRequest<{ job: Job }>(`/jobs/${relatedJob}`, { signal: controller.signal }) : Promise.resolve(null),
    ]).then(([library, shortlist, related]) => {
      if (controller.signal.aborted) return;
      const available = library.resumes.filter(item => !item.deleting), chosen = available.find(item => item.id === relatedResume) ?? available.find(item => item.active) ?? available[0];
      setResumes(available); setResumeId(chosen?.id ?? '');
      const options = shortlist.savedJobs.filter(item => item.available && item.status !== 'NOT_INTERESTED').map(item => ({ id: item.jobId, title: item.job.title, company: item.job.company }));
      if (related && !options.some(item => item.id === related.job.id)) options.unshift(related.job);
      setJobs(options); setMoreJobs(shortlist.total > 20); if (related) setSelected([related.job.id]);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); active.current?.abort(); };
  }, [relatedJob, relatedResume]);
  useEffect(() => {
    if (!resumeId) return;
    const controller = new AbortController();
    void (async () => {
      let value = await authenticatedRequest<DraftHistory>(`/intelligence/resumes/${resumeId}/drafts`, { signal: controller.signal });
      const requested = resumeId === relatedResume ? relatedDraft : null;
      if (requested && !value.versions.some(item => item.id === requested)) {
        const record = await authenticatedRequest<DraftRecord>(`/intelligence/resumes/${resumeId}/draft?analysisId=${encodeURIComponent(requested)}`, { signal: controller.signal });
        const { id, version, model, reasoning, createdAt } = record;
        value = { ...value, versions: [...value.versions, { id, version, model, reasoning, createdAt }].sort((a, b) => b.version - a.version) };
      }
      if (!controller.signal.aborted) { setDrafts(value); setDraftId(requested ?? value.versions[0]?.id ?? ''); }
    })().catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [resumeId, relatedResume, relatedDraft]);
  useEffect(() => {
    const missing = selected.filter(id => !histories[id]);
    if (!missing.length) return;
    const controller = new AbortController();
    void Promise.all(missing.map(async id => ({ id, value: await authenticatedRequest<JobHistory>(`/intelligence/jobs/${id}/analyses`, { signal: controller.signal }) }))).then(values => {
      if (!controller.signal.aborted) {
        setHistories(current => ({ ...current, ...Object.fromEntries(values.map(item => [item.id, item.value])) }));
        setAnalyses(current => ({ ...current, ...Object.fromEntries(values.map(item => [item.id, item.value.versions.find(version => !version.stale)?.id ?? ''])) }));
      }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [selected, histories]);
  function reset() { setTurns([]); setError(''); }
  async function ask() {
    if (busy) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    const text = question.trim();
    try {
      const history = turns.flatMap(turn => [{ role: 'user' as const, text: turn.question }, { role: 'assistant' as const, text: turn.result.answer.paragraphs.map(item => item.text).join('\n').slice(0, 2000) }]).slice(-6);
      const result = await authenticatedRequest<CadyResult>('/intelligence/cady/ask', { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ resumeId, draftId, jobs: selected.map(jobId => ({ jobId, jobAnalysisId: analyses[jobId] })), includeProfileSkills, question: text, history, ...settings.options }) });
      if (!controller.signal.aborted) { setTurns(current => [...current.slice(-9), { question: text, result }]); setQuestion(''); requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' })); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Cady could not answer.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const ready = Boolean(draftId && selected.every(id => analyses[id]) && settings.capabilities?.available && !loading);
  return <div className="workspace-page cady-page"><PageHeading eyebrow="Your career buddy" title="Cady" description="Ask about your selected CV and jobs. Cady gives advice with source references; you stay in control." />
    <section className="panel profile-section"><details open={!turns.length}><summary>Choose context · {selected.length} of 3 jobs selected</summary>
      <p className="muted">Only this CV, selected job analyses and optional profile skills are shared. This conversation is kept in this page until navigation or refresh; up to 6 recent messages are sent per question.</p>
      {loading && <p role="status">Loading your context…</p>}
      {!loading && !resumes.length && <p><Link to="/resumes">Upload and analyze a CV</Link> first.</p>}
      <fieldset disabled={busy}><legend>Career context</legend><div className="profile-grid">
        <label>Resume version<select value={resumeId} onChange={event => { setResumeId(event.target.value); setDrafts({ versions: [], nextBeforeVersion: null }); setDraftId(''); reset(); }}><option value="" disabled>Choose a CV</option>{resumes.map(item => <option key={item.id} value={item.id}>{item.name} · Version {item.version}</option>)}</select></label>
        <label>CV analysis<select value={draftId} onChange={event => { setDraftId(event.target.value); reset(); }}><option value="" disabled>No analysis selected</option>{drafts.versions.map(item => <option key={item.id} value={item.id}>Version {item.version} · {item.model}</option>)}</select></label>
      </div>
        {resumeId && !draftId && <p><Link to="/resumes">Analyze this CV</Link>, then refresh this page to use it.</p>}
        {drafts.nextBeforeVersion !== null && <button className="secondary" onClick={() => { void authenticatedRequest<DraftHistory>(`/intelligence/resumes/${resumeId}/drafts?beforeVersion=${drafts.nextBeforeVersion}`).then(value => setDrafts(current => ({ ...value, versions: [...current.versions, ...value.versions.filter(item => !current.versions.some(saved => saved.id === item.id))].sort((a, b) => b.version - a.version) }))).catch(cause => setError(cause.message)); }}>Load older CV analyses</button>}
        <details className="review-group" open={Boolean(relatedJob)}><summary>Selected & saved jobs (optional)</summary>
          {!jobs.length && <p><Link to="/jobs">Explore and save jobs</Link> to discuss them here.</p>}
          {jobs.map(job => <div className="cady-job" key={job.id}><label className="check-label"><input type="checkbox" checked={selected.includes(job.id)} disabled={!selected.includes(job.id) && selected.length >= 3} onChange={event => { setSelected(values => event.target.checked ? [...values, job.id] : values.filter(id => id !== job.id)); reset(); }} />{job.title} · {job.company}</label>
            {selected.includes(job.id) && <>{histories[job.id] ? <label>Job analysis for {job.title}<select value={analyses[job.id] ?? ''} onChange={event => { setAnalyses(values => ({ ...values, [job.id]: event.target.value })); reset(); }}><option value="" disabled>No current analysis</option>{histories[job.id].versions.map(item => <option key={item.id} value={item.id} disabled={item.stale}>Version {item.version}{item.stale ? ' · Listing changed' : ''}</option>)}</select></label> : <p role="status">Loading job analyses…</p>}
              {!analyses[job.id] && <p><Link to={`/jobs/${job.id}#job-analysis`}>Analyze this job</Link> before using it with Cady.</p>}</>}
          </div>)}
          {moreJobs && <button className="secondary" onClick={() => { void authenticatedRequest<{ savedJobs: SavedJob[]; total: number }>(`/saved-jobs?limit=20&page=${savedPage + 1}`).then(value => { setJobs(current => [...current, ...value.savedJobs.filter(item => item.available && item.status !== 'NOT_INTERESTED' && !current.some(job => job.id === item.jobId)).map(item => ({ id: item.jobId, ...item.job }))]); setSavedPage(page => page + 1); setMoreJobs((savedPage + 1) * 20 < value.total); }).catch(cause => setError(cause.message)); }}>Load more saved jobs</button>}
        </details>
        <label className="check-label"><input type="checkbox" checked={includeProfileSkills} onChange={event => { setIncludeProfileSkills(event.target.checked); reset(); }} />Include profile skills (self-reported)</label>
        <AiSettings settings={{ ...settings, setOptions: options => { settings.setOptions(options); reset(); } }} disabled={busy} />
      </fieldset>
    </details></section>
    <section className="panel profile-section cady-conversation" aria-label="Conversation with Cady">
      {!turns.length && <><h2>What would help you move forward?</h2><div className="actions">{['Why am I not matching this role?', 'How can I show my skills more clearly?', 'Which selected job should I prepare for first?'].map(prompt => <button className="secondary" key={prompt} onClick={() => setQuestion(prompt)}>{prompt}</button>)}</div></>}
      {turns.map((turn, index) => <article className="cady-turn" key={index}><h3>Your question</h3><p className="profile-prose">{turn.question}</p><h3>Cady</h3>{turn.result.answer.paragraphs.map((paragraph, i) => <div key={i}><p className="profile-prose">{paragraph.text}</p>{paragraph.references.length > 0 && <details><summary>Sources ({paragraph.references.length})</summary>{paragraph.references.map(id => { const reference = turn.result.references.find(item => item.id === id)!; return <blockquote key={id}><strong>{reference.label}</strong><p>{reference.text}</p></blockquote>; })}</details>}</div>)}
        {index === turns.length - 1 && <div className="actions">{turn.result.answer.followUps.map(prompt => <button className="secondary" key={prompt} disabled={busy} onClick={() => setQuestion(prompt)}>{prompt}</button>)}</div>}
      </article>)}
      <div ref={end} />
      <form onSubmit={event => { event.preventDefault(); void ask(); }}><label>Your question<textarea maxLength={2000} required rows={3} value={question} disabled={busy} onChange={event => setQuestion(event.target.value)} placeholder="Ask about the selected career context…" /></label><div className="actions"><button disabled={!ready || busy || !question.trim()}>{busy ? 'Cady is thinking…' : 'Ask Cady'}</button>{busy && <button type="button" className="secondary" onClick={() => { active.current?.abort(); setBusy(false); }}>Stop waiting</button>}{turns.length > 0 && <button type="button" className="secondary" disabled={busy} onClick={reset}>New conversation</button>}</div></form>
      {busy && <p role="status">Preparing an answer from your selected context…</p>}{error && <p className="form-error" role="alert">{error}</p>}
      <p className="muted">Cady’s AI advice can be mistaken. Check source references. It cannot edit your data or take actions. Stopping a request may still incur provider charges.</p>
    </section>
  </div>;
}

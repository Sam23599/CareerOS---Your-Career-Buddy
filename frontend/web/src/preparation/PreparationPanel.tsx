import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { AiSettings, useAiSettings } from '../intelligence/AiSettings';
import { type MatchResult } from '../../../../backend/platform/src/intelligence/matching';
import { type AnalysisTask } from '../../../../backend/platform/src/intelligence/tasks';
import { type GapChoice, type PreparationHistory, type PreparationResponse } from '../../../../backend/platform/src/intelligence/preparation';
import { PreparationReview } from './PreparationReview';
import { useWorkspaceNavigationGuard } from '../ui/navigation';

function PreparationDialog({ match, value, jobId, task, onClose, onAccepted, onSaved }: { match: MatchResult | null; value: PreparationResponse | null; jobId: string; task: AnalysisTask | null;
  onClose: () => void; onAccepted: (id: string) => void; onSaved: (value: PreparationResponse) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), dirty = useRef(false), requestKey = useRef<string | null>(null);
  const settings = useAiSettings();
  const priority = { required: 0, unspecified: 1, preferred: 2 };
  const relevant = match?.items.map((item, matchIndex) => ({ item, matchIndex })).filter(({ item }) => item.requirement.value && (item.status !== 'matched' || item.candidate?.source === 'profile'))
    .sort((a, b) => priority[a.item.requirement.priority] - priority[b.item.requirement.priority]).slice(0, 20) ?? [];
  const [choices, setChoices] = useState<GapChoice[]>(relevant.map(item => ({ matchIndex: item.matchIndex, classification: 'unsure' }))), [hours, setHours] = useState(5), [weeks, setWeeks] = useState(4), [goal, setGoal] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = task?.state === 'queued' || task?.state === 'running';
  function close() { if (!dirty.current || window.confirm('Discard unsaved plan edits?')) onClose(); }
  useWorkspaceNavigationGuard(() => !dirty.current || window.confirm('Discard unsaved plan edits?'));
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  const intent = JSON.stringify({ choices, hours, weeks, goal, options: settings.options, source: match?.source });
  const lastIntent = useRef(intent);
  async function generate() {
    if (!match) return;
    if (intent !== lastIntent.current) { requestKey.current = null; lastIntent.current = intent; }
    requestKey.current ??= crypto.randomUUID(); setBusy(true); setError('');
    try {
      const result = await authenticatedRequest<{ taskId: string }>(`/intelligence/jobs/${jobId}/preparation-plans`, { method: 'POST', body: JSON.stringify({ resumeId: match.source.resume.resumeId, draftId: match.source.draftId,
        jobAnalysisId: match.source.jobAnalysisId, includeProfileSkills: match.source.profileVersion !== null, profileVersion: match.source.profileVersion,
        goals: { choices, hoursPerWeek: hours, weeks, goal }, ...settings.options, requestKey: requestKey.current }) });
      onAccepted(result.taskId); requestKey.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not queue preparation.'); }
    finally { setBusy(false); }
  }
  return <dialog className="resume-preview preparation-dialog" ref={dialog} aria-labelledby="preparation-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="preview-heading"><div><p className="eyebrow">Your next steps</p><h2 id="preparation-title">Personalized preparation</h2></div><button className="secondary" onClick={close} autoFocus>Close</button></div>
    {value ? <PreparationReview key={value.record.id} jobId={jobId} value={value} onSaved={onSaved} onDirty={value => { dirty.current = value; }} /> : <>
      <p>Confirm what you know before choosing what to learn. AI will build ordered weekly sessions from these saved requirements.</p>
      <p className="muted">CV analysis {match?.source.draftVersion} · Job analysis {match?.source.jobAnalysisVersion}. Missing evidence does not prove a missing skill.</p>
      {!relevant.length && <p>No evidence gaps were identified for these inputs. Review requirements in the comparison or ask Cady a specific question.</p>}
      {relevant.length > 0 && <form onSubmit={event => { event.preventDefault(); void generate(); }}><fieldset disabled={busy || pending}><legend>Confirm gaps & available time</legend>
        <details className="review-group" open><summary>Requirement review ({relevant.length})</summary>{relevant.map(({ item, matchIndex }) => <div className="preparation-gap" key={matchIndex}>
          <label>{item.requirement.value}<select aria-label={`Your view of ${item.requirement.value}`} value={choices.find(choice => choice.matchIndex === matchIndex)?.classification ?? 'exclude'} onChange={event => {
            const classification = event.target.value;
            setChoices(values => classification === 'exclude' ? values.filter(choice => choice.matchIndex !== matchIndex) : [...values.filter(choice => choice.matchIndex !== matchIndex), { matchIndex, classification: classification as GapChoice['classification'] }]); setConfirmed(false);
          }}>
            <option value="unsure">Unsure — help me verify</option><option value="already_know">I already know this</option><option value="need_evidence">I need to show CV evidence</option><option value="want_to_learn">I want to learn this</option><option value="exclude">Leave out of this plan</option></select></label>
          <details><summary>Job evidence · {item.requirement.priority}</summary>{item.requirement.evidence.map((quote, index) => <blockquote key={index}>{quote.quote}</blockquote>)}</details>
        </div>)}</details>
        {match && match.items.length > 20 && <p className="muted">The first 20 relevant gaps are considered in this plan.</p>}
        <div className="profile-grid"><label>Hours per week<input type="number" min={1} max={40} required value={hours} onChange={event => setHours(Number(event.target.value))} /></label><label>Target weeks<input type="number" min={1} max={8} required value={weeks} onChange={event => setWeeks(Number(event.target.value))} /></label></div>
        <details className="review-group"><summary>Personal goal (optional)</summary><label>Goal (optional)<textarea value={goal} rows={2} maxLength={1000} onChange={event => setGoal(event.target.value)} placeholder="For example, prepare for a technical interview." /></label></details>
        <AiSettings settings={settings} />
        {choices.length > hours * weeks && <p className="extraction-warning">Allow at least one hour per selected requirement, or leave some out of this plan.</p>}
        <label className="check-label"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I have reviewed these gap classifications and the processing notice.</label>
        <button disabled={!confirmed || !settings.capabilities?.available || !choices.length || choices.length > hours * weeks}>{busy ? 'Queuing…' : 'Generate preparation plan'}</button>
      </fieldset></form>}
    </>}
    {pending && <p role="status">Preparation is {task.state}. You can close this dialog; the accepted task continues. Running AI work may incur its charge.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </dialog>;
}

export function PreparationPanel({ jobId, match }: { jobId: string; match: MatchResult | null }) {
  const [open, setOpen] = useState(false), [value, setValue] = useState<PreparationResponse | null>(null), [history, setHistory] = useState<PreparationHistory>({ versions: [], nextBeforeVersion: null }), [task, setTask] = useState<AnalysisTask | null>(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const base = `/intelligence/jobs/${jobId}`, accepted = useRef<string | null>(null), handled = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let reading = false;
    const load = async () => {
      if (reading) return; reading = true;
      try {
        const [versions, tasks] = await Promise.all([authenticatedRequest<PreparationHistory>(`${base}/preparation-plans`, { signal: controller.signal }), authenticatedRequest<{ tasks: AnalysisTask[] }>(`${base}/tasks`, { signal: controller.signal })]);
        if (controller.signal.aborted) return;
        if (!Array.isArray(versions.versions) || !Array.isArray(tasks.tasks)) throw new Error('Preparation history could not be read. Please refresh.');
        setHistory(current => ({ ...versions, versions: [...versions.versions, ...current.versions.filter(item => !versions.versions.some(known => known.id === item.id))],
          nextBeforeVersion: current.versions.length > 20 ? current.nextBeforeVersion : versions.nextBeforeVersion }));
        const current = tasks.tasks.find(item => item.kind === 'preparation' && (accepted.current ? item.id === accepted.current : ['queued', 'running'].includes(item.state))) ?? null;
        if (current && !accepted.current) accepted.current = current.id;
        setTask(current);
        if (current?.state === 'succeeded' && current.analysisId && handled.current !== current.id) {
          const result = await authenticatedRequest<PreparationResponse>(`${base}/preparation-plans/${current.analysisId}`, { signal: controller.signal });
          if (!controller.signal.aborted) { setValue(result); handled.current = current.id; }
        }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load preparation plans.'); }
      finally { reading = false; }
    };
    void load(); const timer = setInterval(() => { void load(); }, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [base, refresh]);
  function saved(result: PreparationResponse) { setValue(result); setRefresh(count => count + 1); }
  async function view(id: string) { setError(''); try { const result = await authenticatedRequest<PreparationResponse>(`${base}/preparation-plans/${id}`); setValue(result); setOpen(true); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open this plan.'); } }
  const pending = task && ['queued', 'running'].includes(task.state);
  return <section id="preparation" className="panel profile-section" aria-label="Personalized AI preparation"><div className="section-heading"><div><p className="eyebrow">Turn gaps into action</p><h2>Personalized preparation</h2></div></div>
    <p>Build a 1–8 week roadmap with flexible sessions, deliverables and checkpoints. Saved plans remain available here.</p>
    <div className="actions"><button disabled={!match || Boolean(pending)} onClick={() => { setValue(null); setOpen(true); }}>Create AI preparation plan</button>{value && <button className="secondary" onClick={() => setOpen(true)}>Review plan version {value.record.version}</button>}
      <Link className="button-link secondary" to={`/cady?jobId=${jobId}${match ? `&resumeId=${match.source.resume.resumeId}&draftId=${match.source.draftId}` : ''}`}>Discuss with Cady</Link></div>
    {!match && <p className="muted">Choose “Review fit & gaps” above to select inputs first.</p>}
    {pending && <p role="status">Preparation {task.state}. You may leave and return; find it in <Link to="/tasks">Task history</Link>.</p>}
    {task?.state === 'failed' && <p className="form-error" role="alert">Preparation could not finish ({task.errorCode}). Check saved plans before retrying; no automatic paid retry.</p>}
    {pending && task.state === 'queued' && <button className="secondary" onClick={() => { void authenticatedRequest(`/intelligence/tasks/${task.id}/cancel`, { method: 'POST', body: '{}' }).then(() => setRefresh(count => count + 1)).catch(cause => setError(cause.message)); }}>Cancel queued preparation</button>}
    <details className="review-group"><summary>Saved preparation plans ({history.versions.length})</summary>{!history.versions.length && <p>No plans saved yet.</p>}{history.versions.map(item => <div className="plan-history-row" key={item.id}><span>Version {item.version} · {new Date(item.createdAt).toLocaleString()}{item.stale ? ' · Listing changed' : ''}</span><button className="secondary" onClick={() => { void view(item.id); }}>View plan {item.version}</button></div>)}
      {history.nextBeforeVersion !== null && <button className="secondary" onClick={() => { void authenticatedRequest<PreparationHistory>(`${base}/preparation-plans?beforeVersion=${history.nextBeforeVersion}`).then(result => setHistory(current => ({ ...result, versions: [...current.versions, ...result.versions.filter(item => !current.versions.some(known => known.id === item.id))] }))).catch(cause => setError(cause.message)); }}>Load older plans</button>}
    </details>
    {error && <p className="form-error" role="alert">{error}</p>}
    {open && <PreparationDialog key={value?.record.id ?? 'create'} jobId={jobId} match={match} value={value} task={task} onClose={() => setOpen(false)} onAccepted={id => {
      accepted.current = id; setTask({ id, kind: 'preparation', jobId, sourceHash: match?.source.jobHash ?? '', state: 'queued', analysisId: null, errorCode: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); setRefresh(count => count + 1);
    }} onSaved={saved} />}
  </section>;
}

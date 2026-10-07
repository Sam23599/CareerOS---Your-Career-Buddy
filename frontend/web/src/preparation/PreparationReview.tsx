import { useState } from 'react';
import { authenticatedRequest } from '../auth/session';
import { type PreparationResponse, type ReviewedAction } from '../../../../backend/platform/src/intelligence/preparation';

export function PreparationReview({ value, jobId, onSaved, onDirty }: { value: PreparationResponse; jobId: string; onSaved: (value: PreparationResponse) => void; onDirty: (value: boolean) => void }) {
  const { record, match, sourceStatus } = value;
  const initial = record.plan.actions.map(action => record.review.actions.find(item => item.id === action.id) ?? { id: action.id, title: action.title, detail: action.detail, status: 'planned' as const });
  const [actions, setActions] = useState<ReviewedAction[]>(initial), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const weeks = [...new Set(record.plan.actions.map(item => item.week))].sort((a, b) => a - b);
  const next = record.plan.actions.find(action => actions.find(item => item.id === action.id)?.status === 'planned');
  const [week, setWeek] = useState(next?.week ?? weeks[0]);
  function change(id: string, patch: Partial<ReviewedAction>) { setActions(values => values.map(item => item.id === id ? { ...item, ...patch } : item)); onDirty(true); setMessage(''); }
  const header = record.plan.weeks?.find(item => item.week === week), current = record.plan.actions.filter(item => item.week === week), done = actions.filter(item => item.status === 'done').length;
  return <section aria-label="Preparation plan review">
    <div className="roadmap-heading"><div><h3>Plan version {record.version}</h3><p className="profile-prose">{record.plan.overview}</p></div><span className="roadmap-progress">{done}/{actions.length} done</span></div>
    <p className="muted">{record.goals.hoursPerWeek} hours/week · {record.goals.weeks} weeks · {record.model}{record.reasoning ? ` / ${record.reasoning}` : ''} · Review revision {record.review.revision}</p>
    {(sourceStatus.stale || sourceStatus.profileChanged || sourceStatus.expired) && <p className="extraction-warning">{sourceStatus.stale ? 'The listing changed. ' : ''}{sourceStatus.profileChanged ? 'Your profile changed. ' : ''}{sourceStatus.expired ? 'This job has expired. ' : ''}Review this as a historical plan; generate with current sources for new advice.</p>}
    {!record.plan.weeks && <p className="muted">This earlier plan keeps its original actions. New plans include objectives, session outcomes and a checkpoint for every week.</p>}
    <p className="muted">Move sessions around your schedule. “Done” is your own progress note; saving never edits your CV or profile.</p>
    {next ? <div className="roadmap-next"><span className="eyebrow">Next session · Week {next.week}</span><strong>{actions.find(item => item.id === next.id)?.title}</strong><p>{next.outcome ?? actions.find(item => item.id === next.id)?.detail}</p><button type="button" className="secondary" onClick={() => setWeek(next.week)}>Go to next session</button></div> : <p role="status">All sessions are done or skipped. Review your deliverables before your interview.</p>}
    <nav className="roadmap-weeks" aria-label="Roadmap weeks">{weeks.map(item => <button type="button" key={item} className="secondary" aria-pressed={week === item} onClick={() => setWeek(item)}>Week {item}<small>{record.plan.actions.filter(action => action.week === item).reduce((sum, action) => sum + action.hours, 0)}h</small></button>)}</nav>
    <div className="roadmap-week-heading"><h4>Week {week}{header ? ` · ${header.objective}` : ''}</h4>{header && <p><strong>Checkpoint:</strong> {header.milestone}</p>}</div>
    <form onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); void authenticatedRequest<PreparationResponse>(`/intelligence/jobs/${jobId}/preparation-plans/${record.id}/review`, {
      method: 'PATCH', body: JSON.stringify({ revision: record.review.revision, actions }),
    }).then(result => { onSaved(result); onDirty(false); setMessage('Reviewed plan saved.'); }).catch(cause => setError(cause.message)).finally(() => setBusy(false)); }}>
      <fieldset disabled={busy || sourceStatus.stale || sourceStatus.profileChanged}><legend className="sr-only">Review & track your actions</legend>
        <ol className="roadmap-sessions">{current.map(action => {
          const edited = actions.find(item => item.id === action.id)!;
          return <li className="roadmap-session" key={action.id}><div className="section-heading"><h4>{edited.title}</h4><span className="muted">{action.hours}h · {action.kind.replace('_', ' ')}</span></div><p className="profile-prose">{edited.detail}</p>
            {action.outcome && <p className="roadmap-outcome"><strong>Finish with:</strong> {action.outcome}</p>}
            <div className="roadmap-session-controls"><label>Progress<select value={edited.status} onChange={event => change(action.id, { status: event.target.value as ReviewedAction['status'] })}><option value="planned">Planned</option><option value="skipped">Skip this action</option><option value="done">Done (self-reported)</option></select></label>
              <details><summary>Customize session</summary><label>Action title<input maxLength={150} required value={edited.title} onChange={event => change(action.id, { title: event.target.value })} /></label><label>Action details<textarea maxLength={1200} required value={edited.detail} rows={3} onChange={event => change(action.id, { detail: event.target.value })} /></label></details>
            </div><details><summary>Original AI suggestion & job evidence</summary><p className="profile-prose">{action.detail}</p><p>{match.items[action.matchIndex]?.requirement.value}</p>{match.items[action.matchIndex]?.requirement.evidence.map((quote, index) => <blockquote key={index}>{quote.quote}</blockquote>)}</details>
          </li>;
        })}</ol>
        <button>{busy ? 'Saving…' : 'Save reviewed plan'}</button>
      </fieldset>
    </form>
    {record.plan.cautions.length > 0 && <details><summary>Plan cautions</summary><ul>{record.plan.cautions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    {error && <p className="form-error" role="alert">{error}</p>}<p role="status">{message}</p>
    <details><summary>Saved sources & usage</summary><p>CV analysis {record.source.draftVersion} · Job analysis {record.source.jobAnalysisVersion}{record.source.profileVersion !== null ? ` · Profile ${record.source.profileVersion}` : ''}. Generated {new Date(record.createdAt).toLocaleString()}.</p><p>{record.usage.inputTokens} input / {record.usage.outputTokens} output tokens. No new AI call when opening or saving this plan.</p></details>
  </section>;
}

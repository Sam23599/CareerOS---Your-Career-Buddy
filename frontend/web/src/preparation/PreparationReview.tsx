import { useState } from 'react';
import { authenticatedRequest } from '../auth/session';
import { type PreparationResponse, type ReviewedAction } from '../../../../backend/platform/src/intelligence/preparation';

export function PreparationReview({ value, jobId, onSaved, onDirty }: { value: PreparationResponse; jobId: string; onSaved: (value: PreparationResponse) => void; onDirty: (value: boolean) => void }) {
  const { record, match, sourceStatus } = value;
  const initial = record.plan.actions.map(action => record.review.actions.find(item => item.id === action.id) ?? { id: action.id, title: action.title, detail: action.detail, status: 'planned' as const });
  const [actions, setActions] = useState<ReviewedAction[]>(initial), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  function change(id: string, patch: Partial<ReviewedAction>) { setActions(values => values.map(item => item.id === id ? { ...item, ...patch } : item)); onDirty(true); setMessage(''); }
  const weeks = [...new Set(record.plan.actions.map(item => item.week))].sort((a, b) => a - b);
  return <section aria-label="Preparation plan review">
    <h3>Plan version {record.version}</h3><p className="profile-prose">{record.plan.overview}</p>
    <p className="muted">{record.goals.hoursPerWeek} hours/week · {record.goals.weeks} weeks · {record.model}{record.reasoning ? ` / ${record.reasoning}` : ''} · Review revision {record.review.revision}</p>
    {(sourceStatus.stale || sourceStatus.profileChanged || sourceStatus.expired) && <p className="extraction-warning">{sourceStatus.stale ? 'The listing changed. ' : ''}{sourceStatus.profileChanged ? 'Your profile changed. ' : ''}{sourceStatus.expired ? 'This job has expired. ' : ''}Review this as a historical plan; generate with current sources for new advice.</p>}
    <p className="muted">Advice is not a claim about your skills or past experience. “Done” is your own progress note. Saving never edits your CV or profile.</p>
    <form onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); void authenticatedRequest<PreparationResponse>(`/intelligence/jobs/${jobId}/preparation-plans/${record.id}/review`, {
      method: 'PATCH', body: JSON.stringify({ revision: record.review.revision, actions }),
    }).then(result => { onSaved(result); onDirty(false); setMessage('Reviewed plan saved.'); }).catch(cause => setError(cause.message)).finally(() => setBusy(false)); }}>
      <fieldset disabled={busy || sourceStatus.stale || sourceStatus.profileChanged}><legend>Review & track your actions</legend>
        {weeks.map(week => <details className="review-group" key={week} open={week === weeks[0]}><summary>Week {week} · {record.plan.actions.filter(item => item.week === week).reduce((sum, item) => sum + item.hours, 0)} hours</summary>
          {record.plan.actions.filter(item => item.week === week).map(action => {
            const edited = actions.find(item => item.id === action.id)!;
            return <details className="plan-action" key={action.id}><summary>{edited.title} · {action.hours}h</summary>
              <p className="muted">{action.kind.replace('_', ' ')} · {match.items[action.matchIndex]?.requirement.value}</p>
              <label>Action title<input maxLength={150} required value={edited.title} onChange={event => change(action.id, { title: event.target.value })} /></label>
              <label>Action details<textarea maxLength={1200} required value={edited.detail} rows={3} onChange={event => change(action.id, { detail: event.target.value })} /></label>
              <label>Progress<select value={edited.status} onChange={event => change(action.id, { status: event.target.value as ReviewedAction['status'] })}><option value="planned">Planned</option><option value="skipped">Skip this action</option><option value="done">Done (self-reported)</option></select></label>
              <details><summary>Original AI suggestion & job evidence</summary><p className="profile-prose">{action.detail}</p>{match.items[action.matchIndex]?.requirement.evidence.map((quote, index) => <blockquote key={index}>{quote.quote}</blockquote>)}</details>
            </details>;
          })}
        </details>)}
        <button>{busy ? 'Saving…' : 'Save reviewed plan'}</button>
      </fieldset>
    </form>
    {record.plan.cautions.length > 0 && <details><summary>Plan cautions</summary><ul>{record.plan.cautions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
    {error && <p className="form-error" role="alert">{error}</p>}<p role="status">{message}</p>
    <details><summary>Saved sources & usage</summary><p>CV analysis {record.source.draftVersion} · Job analysis {record.source.jobAnalysisVersion}{record.source.profileVersion !== null ? ` · Profile ${record.source.profileVersion}` : ''}. Generated {new Date(record.createdAt).toLocaleString()}.</p><p>{record.usage.inputTokens} input / {record.usage.outputTokens} output tokens. No new AI call when opening or saving this plan.</p></details>
  </section>;
}

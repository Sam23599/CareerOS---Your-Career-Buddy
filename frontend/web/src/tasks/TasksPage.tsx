import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { PageHeading } from '../ui/WorkspaceUi';
import { type AnalysisTask } from '../../../../backend/platform/src/intelligence/tasks';
export function TasksPage() {
  const [tasks, setTasks] = useState<AnalysisTask[] | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, reading = false;
    const controller = new AbortController();
    const load = () => {
      if (reading) return;
      reading = true;
      void authenticatedRequest<{ tasks: AnalysisTask[] }>('/intelligence/tasks', { signal: controller.signal }).then(result => { if (active) { setTasks(result.tasks); setError(''); } }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load tasks.'); }).finally(() => { reading = false; });
    };
    load(); const timer = setInterval(load, 5000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [attempt]);
  return <div className="workspace-page profile-page"><PageHeading eyebrow="Your work, in progress" title="Task history" description="Job analyses continue after navigation. History shows your latest 100 tasks." />
    {error && <p className="form-error" role="alert">{error}</p>}<p role="status">{message}</p>
    {!tasks && !error && <p role="status">Loading tasks…</p>}{tasks?.length === 0 && <p className="workspace-empty-state">No background tasks yet. Start an analysis from a job.</p>}
    {tasks?.map(task => <article className="panel profile-section" key={task.id}><div className="workspace-card-heading compact-card-heading"><div className="workspace-card-copy"><h2><Link to={`/jobs/${task.jobId}#job-analysis`}>Job analysis</Link></h2><p className="muted">{new Date(task.createdAt).toLocaleString()}</p></div><span className="workspace-badge">{task.state}</span></div>
      {task.errorCode && <p className="form-error">{task.errorCode === 'LLM_TIMEOUT' ? 'Analysis timed out or was interrupted. Check saved versions before retrying.' : 'Analysis could not finish. Open the job to review or retry.'} <code>{task.errorCode}</code></p>}
      <div className="actions"><button className="secondary" onClick={() => {
        const details = JSON.stringify({ taskId: task.id, jobId: task.jobId, action: 'analyze_job', state: task.state, createdAt: task.createdAt, updatedAt: task.updatedAt, errorCode: task.errorCode }, null, 2);
        void navigator.clipboard.writeText(details).then(() => setMessage('Diagnostic details copied. Share them with support.')).catch(() => setError('Clipboard unavailable. Use Download diagnostics.'));
      }}>Copy diagnostics</button><button className="secondary" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ taskId: task.id, action: 'analyze_job', state: task.state, createdAt: task.createdAt, errorCode: task.errorCode }, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `careeros-task-${task.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download diagnostics</button>{task.state === 'queued' && <button className="secondary" onClick={() => {
        void authenticatedRequest(`/intelligence/tasks/${task.id}/cancel`, { method: 'POST', body: '{}' }).then(() => setAttempt(value => value + 1)).catch(cause => setError(cause.message));
      }}>Cancel queued task</button>}</div>
      {task.state === 'running' && <p className="muted">Provider processing has started. Leaving this page does not cancel it.</p>}
    </article>)}<button className="secondary" onClick={() => setAttempt(value => value + 1)}>Refresh history</button>
  </div>;
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { authenticatedRequest } from '../auth/session';
import { type DraftHistory } from '../../../../backend/platform/src/intelligence/drafts';
import { type ReviewResponse } from '../../../../backend/platform/src/intelligence/reviews';
import { ResumeCheckReport } from './ResumeCheckReport';
import { useDialogDismiss } from '../ui/dialogDismiss';
import { analysisVersionLabel } from '../intelligence/analysisLabels';

export function ResumeChecks({ resume, onClose, onAnalyze }: { resume: { id: string; name: string }; onClose: () => void; onAnalyze: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController | null>(null);
  const [history, setHistory] = useState<DraftHistory>({ versions: [], nextBeforeVersion: null });
  const [draftId, setDraftId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReviewResponse | null>(null);
  const [attempt, setAttempt] = useState(0);
  const dismissal = useDialogDismiss(onClose);
  const base = `/intelligence/resumes/${resume.id}`;
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current!; element.showModal();
    return () => { element.close(); active.current?.abort(); returnFocus?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void authenticatedRequest<DraftHistory>(`${base}/drafts`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setHistory(value); setDraftId(value.versions[0]?.id ?? ''); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load saved analyses.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, attempt]);
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) { setResult(null); setError(cause instanceof Error ? cause.message : 'Could not review this resume.'); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function review(event: FormEvent) {
    event.preventDefault(); setResult(null);
    void run(async signal => {
      const response = await authenticatedRequest<ReviewResponse>(`${base}/review`, { method: 'POST', body: JSON.stringify({ draftId, job: null }), signal });
      if (!signal.aborted) setResult(response);
    });
  }
  return <dialog className="resume-preview resume-check-dialog" ref={dialog} aria-labelledby="resume-check-title" {...dismissal}>
    <div className="preview-heading"><h2 id="resume-check-title">Check {resume.name}</h2><button type="button" className="secondary" onClick={onClose} autoFocus>Close resume checks</button></div>
    <p className="muted">Review a saved analysis for missing context and PDF reading warnings. No new AI call or changes to your resume.</p>
    {loading && <p role="status">Loading saved CV analyses…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {!loading && !history.versions.length && !error && <p>Analyze this resume first to prepare these checks. <button type="button" className="secondary" onClick={onAnalyze}>Open resume draft</button></p>}
    {!loading && history.versions.length > 0 && <form onSubmit={review}><div className="review-controls"><label>CV analysis for checks<select value={draftId} disabled={busy} onChange={event => { setDraftId(event.target.value); setResult(null); setError(''); }}>{history.versions.map(item => <option value={item.id} key={item.id}>{analysisVersionLabel(resume.name, item)}</option>)}</select></label><button disabled={busy || !draftId}>Run resume checks</button></div></form>}
    <div className="actions">
      {history.nextBeforeVersion !== null && <button className="secondary" disabled={loading || busy} onClick={() => void run(async signal => {
        const value = await authenticatedRequest<DraftHistory>(`${base}/drafts?beforeVersion=${history.nextBeforeVersion}`, { signal });
        if (!signal.aborted) setHistory(current => ({ ...value, versions: [...current.versions, ...value.versions.filter(item => !current.versions.some(known => known.id === item.id))] }));
      })}>Load older CV analyses</button>}
      <button className="secondary" disabled={loading || busy} onClick={() => { setResult(null); setError(''); setLoading(true); setAttempt(value => value + 1); }}>Refresh saved analyses</button>
    </div>
    {busy && <p role="status">Reviewing saved inputs…</p>}
    {result && <ResumeCheckReport report={result.report} />}
  </dialog>;
}

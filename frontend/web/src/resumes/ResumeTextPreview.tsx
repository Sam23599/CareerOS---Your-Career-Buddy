import { useEffect, useRef, useState } from 'react';
import { authenticatedRequest } from '../auth/session';
import { useDialogDismiss } from '../ui/dialogDismiss';

type TextResult = {
  status: 'extracted' | 'no_text'; pageCount: number;
  pages: { number: number; text: string }[]; warnings: { code: string; message: string }[];
};

export function ResumeTextPreview({ resume, onClose }: { resume: { id: string; name: string }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<TextResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const dismissal = useDialogDismiss(onClose);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // Let StrictMode's immediate cleanup cancel the first mount before a POST starts.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      const value = await authenticatedRequest<TextResult>(`/intelligence/resumes/${resume.id}/extract`, {
        method: 'POST', body: '{}', signal: controller.signal,
      });
      if (!controller.signal.aborted) setResult(value);
    })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not extract resume text.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [resume.id, attempt]);
  return <dialog className="resume-preview" ref={dialog} aria-labelledby="resume-text-title" {...dismissal}>
    <div className="preview-heading"><h2 id="resume-text-title">Text from {resume.name}</h2><button type="button" onClick={onClose} autoFocus>Close text preview</button></div>
    <p className="muted">Review the wording and reading order against your PDF. Complex layouts may read differently; scanned pages may need OCR. Your profile is unchanged.</p>
    {loading && <p role="status">Extracting text…</p>}
    {error && <div><p className="form-error" role="alert">{error}</p><button className="secondary" onClick={() => {
      setError(''); setResult(null); setLoading(true); setAttempt(value => value + 1);
    }}>Retry extraction</button></div>}
    {result && <div className="resume-text-pages">
      {result.warnings.length > 0 && <section aria-label="Extraction warnings">
        <h3>Extraction warnings</h3>
        {result.warnings.map(warning => <p className="extraction-warning" role="status" key={warning.code}>{warning.message}</p>)}
      </section>}
      {result.status === 'extracted' && <p>{result.pageCount} {result.pageCount === 1 ? 'page' : 'pages'} processed</p>}
      {result.pages.map(page => <section key={page.number}><h3>Page {page.number}</h3>
        {page.text.trim() ? <pre>{page.text}</pre> : <p className="muted">No readable text on this page.</p>}
      </section>)}
    </div>}
  </dialog>;
}

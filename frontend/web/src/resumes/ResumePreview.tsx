import { useEffect, useRef, useState } from 'react';
import { authenticatedRequest } from '../auth/session';
import { useDialogDismiss } from '../ui/dialogDismiss';

export function ResumePreview({ resume, onClose }: { resume: { id: string; name: string }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const dismissal = useDialogDismiss(onClose);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void authenticatedRequest<Blob>(`/resumes/${resume.id}/download`, {}, true)
      .then(blob => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load the preview.'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [resume.id]);
  return <dialog className="resume-preview" ref={dialog} aria-labelledby="resume-preview-title" {...dismissal}>
    <div className="preview-heading"><h2 id="resume-preview-title">{resume.name}</h2><button type="button" onClick={onClose} autoFocus>Close preview</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : !url ? <p role="status">Loading preview…</p> : <>
      <p className="muted">If your browser cannot display the PDF, <a href={url} download={resume.name}>download it here</a>.</p>
      <iframe title={`Preview of ${resume.name}`} src={url} />
    </>}
  </dialog>;
}

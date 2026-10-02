import { ResumePreview } from './ResumePreview';
import { ResumeTextPreview } from './ResumeTextPreview';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest } from '../auth/session';

type Resume = { id: string; name: string; size: number; version: number; uploadedAt: string; active: boolean; deleting?: boolean };
type Library = { resumes: Resume[] };
export function ResumesPage() {
  const [preview, setPreview] = useState<Resume | null>(null);
  const [textPreview, setTextPreview] = useState<Resume | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [inputKey, setInputKey] = useState(0);
  useEffect(() => {
    let active = true;
    void authenticatedRequest<Library>('/resumes').then(result => { if (active) setResumes(result.resumes); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load resumes.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The operation failed. Please retry.'); }
    finally { setBusy(false); }
  }
  function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) || file.size === 0 || file.size > 5 * 1024 * 1024) { setError('Choose a nonempty PDF file up to 5 MB.'); return; }
    void action(async () => {
      const result = await authenticatedRequest<Library>(`/resumes?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
      setResumes(result.resumes); setFile(null); setInputKey(value => value + 1); setMessage('Resume uploaded.');
    });
  }
  return <div className="profile-page">
    <Link to="/profile">← Profile</Link><h1>Your resumes</h1>
    <p className="description">Keep different versions for different opportunities. Only you can access these files.</p>
    <section className="panel profile-section"><h2>Upload a resume</h2><p className="muted">PDF only, up to 5 MB. Each upload creates a new version. An upload becomes active when no resume is selected.</p>
      <form onSubmit={upload}><label>Resume file<input key={inputKey} type="file" accept=".pdf,application/pdf" disabled={busy || loading} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
        <button disabled={busy || loading || !file}>Upload resume</button></form>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <p role="status">{loading ? 'Loading resumes…' : busy ? 'Working…' : message}</p>
    <button className="secondary" disabled={busy || loading} onClick={() => { setError(''); setLoading(true); setAttempt(value => value + 1); }}>Refresh resumes</button>
    {!loading && !resumes.length && !error && <p>No resumes uploaded yet.</p>}
    {resumes.map(resume => <article className="panel profile-section resume-card" key={resume.id}>
      <h2>{resume.name}</h2><p>Version {resume.version}{resume.active ? ' · Active resume' : ''}</p>
      {resume.deleting && <p className="form-error">Deletion is incomplete. Click Delete to retry cleanup.</p>}
      <p className="muted">{Math.ceil(resume.size / 1024)} KB · Uploaded {new Date(resume.uploadedAt).toLocaleDateString()}</p>
      <div className="actions">
        <button className="secondary" disabled={busy || loading || resume.deleting} onClick={() => setPreview(resume)}>View</button>
        <button className="secondary" disabled={busy || loading || resume.deleting} onClick={() => setTextPreview(resume)}>Extract text</button>
        <button disabled={busy || loading || resume.deleting} onClick={() => void action(async () => {
          const blob = await authenticatedRequest<Blob>(`/resumes/${resume.id}/download`, {}, true);
          const url = URL.createObjectURL(blob); const link = document.createElement('a');
          link.href = url; link.download = resume.name; document.body.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        })}>Download</button>
        {!resume.active && !resume.deleting && <button className="secondary" disabled={busy || loading} onClick={() => void action(async () => {
          setResumes((await authenticatedRequest<Library>(`/resumes/${resume.id}/active`, { method: 'PUT' })).resumes); setMessage('Active resume updated.');
        })}>Make active</button>}
        <button className="secondary" disabled={busy || loading} onClick={() => {
          if (!window.confirm(`Delete ${resume.name}?${resume.active ? ' You will have no active resume until you select or upload another.' : ''} This cannot be undone.`)) return;
          void action(async () => { setResumes((await authenticatedRequest<Library>(`/resumes/${resume.id}`, { method: 'DELETE' })).resumes); setMessage('Resume deleted.'); });
        }}>Delete</button>
      </div>
    </article>)}
    {preview && <ResumePreview key={preview.id} resume={preview} onClose={() => setPreview(null)} />}
    {textPreview && <ResumeTextPreview key={textPreview.id} resume={textPreview} onClose={() => setTextPreview(null)} />}
  </div>;
}

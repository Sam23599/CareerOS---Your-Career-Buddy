import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { authenticatedRequest } from '../auth/session';
import { useAiSettings, type AiOptions } from '../intelligence/AiSettings';
import { type DraftHistory, type DraftRecord } from '../../../../backend/platform/src/intelligence/drafts';
import { type CadyConversation, type CadyResult, type ConversationResponse } from '../../../../backend/platform/src/intelligence/cady';
import { type JobAnalysisSummary } from '../../../../backend/platform/src/intelligence/jobs';
import { type SavedJob } from '../saved-jobs/types';

type Resume = { id: string; name: string; version: number; active: boolean; deleting?: boolean };
type Job = { id: string; title: string; company: string };
type JobHistory = { versions: (JobAnalysisSummary & { stale: boolean })[] };
const empty: CadyConversation = { revision: 0, context: null, turns: [], updatedAt: null };
function useCadyState() {
  const [enabled, setEnabled] = useState(false), settings = useAiSettings(enabled);
  const active = useRef<AbortController | null>(null), restored = useRef(false);
  const [resumes, setResumes] = useState<Resume[]>([]), [resumeId, setResumeId] = useState(''), [drafts, setDrafts] = useState<DraftHistory>({ versions: [], nextBeforeVersion: null }), [draftId, setDraftId] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]), [selected, setSelected] = useState<string[]>([]), [histories, setHistories] = useState<Record<string, JobHistory>>({}), [analyses, setAnalyses] = useState<Record<string, string>>({});
  const [includeProfileSkills, setProfile] = useState(false), [question, setQuestion] = useState(''), [conversation, setConversation] = useState(empty);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true), [outdated, setOutdated] = useState(false), [unavailable, setUnavailable] = useState(false), [uncertain, setUncertain] = useState(false);
  const [savedPage, setSavedPage] = useState(1), [moreJobs, setMoreJobs] = useState(false), [contextLoading, setContextLoading] = useState(true);
  function applySaved(value: ConversationResponse) {
    setConversation(value.conversation); setOutdated(value.outdated); setUnavailable(value.unavailable); setUncertain(false);
    const context = value.conversation.context;
    if (context) {
      setResumeId(context.resume.resumeId); setDraftId(context.draftId); setSelected(context.jobs.map(job => job.jobId));
      setAnalyses(Object.fromEntries(context.jobs.map(job => [job.jobId, job.jobAnalysisId]))); setProfile(Boolean(context.profile));
      settings.setOptions({ model: context.model, reasoning: context.reasoning }); restored.current = true;
    }
  }
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void Promise.all([authenticatedRequest<{ resumes: Resume[] }>('/resumes', { signal: controller.signal }),
      authenticatedRequest<{ savedJobs: SavedJob[]; total: number }>('/saved-jobs?limit=20', { signal: controller.signal }),
      authenticatedRequest<ConversationResponse>('/intelligence/cady/conversation', { signal: controller.signal }),
    ]).then(async ([library, shortlist, saved]) => {
      const options = shortlist.savedJobs.filter(item => item.available && item.status !== 'NOT_INTERESTED').map(item => ({ id: item.jobId, title: item.job.title, company: item.job.company }));
      const missing = saved.conversation.context?.jobs.filter(job => !options.some(item => item.id === job.jobId)) ?? [];
      const extra = await Promise.all(missing.map(item => authenticatedRequest<{ job: Job }>(`/jobs/${item.jobId}`, { signal: controller.signal })));
      if (controller.signal.aborted) return;
      const available = library.resumes.filter(item => !item.deleting);
      setResumes(available); setJobs([...extra.map(item => item.job), ...options]); setMoreJobs(shortlist.total > 20);
      applySaved(saved);
      if (!saved.conversation.context) setResumeId((available.find(item => item.active) ?? available[0])?.id ?? '');
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause.message); setUncertain(true); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Initial loading is lazy and runs once per authenticated account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  useEffect(() => {
    if (restored.current && conversation.context && settings.capabilities) settings.setOptions({ model: conversation.context.model, reasoning: conversation.context.reasoning });
    // Preserve the stored model when capabilities arrive after the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.capabilities]);
  useEffect(() => {
    if (!resumeId) return;
    const controller = new AbortController();
    void (async () => {
      let value = await authenticatedRequest<DraftHistory>(`/intelligence/resumes/${resumeId}/drafts`, { signal: controller.signal });
      if (draftId && !value.versions.some(item => item.id === draftId)) {
        const record = await authenticatedRequest<DraftRecord>(`/intelligence/resumes/${resumeId}/draft?analysisId=${encodeURIComponent(draftId)}`, { signal: controller.signal });
        const { id, version, model, reasoning, createdAt } = record;
        value = { ...value, versions: [...value.versions, { id, version, model, reasoning, createdAt }].sort((a, b) => b.version - a.version) };
      }
      if (!controller.signal.aborted) { setDrafts(value); if (!draftId) setDraftId(value.versions[0]?.id ?? ''); }
    })().catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setContextLoading(false); });
    return () => controller.abort();
  }, [resumeId, draftId]);
  useEffect(() => {
    const missing = selected.filter(id => !histories[id]);
    if (!missing.length) return;
    const controller = new AbortController();
    void Promise.all(missing.map(async id => ({ id, value: await authenticatedRequest<JobHistory>(`/intelligence/jobs/${id}/analyses`, { signal: controller.signal }) }))).then(values => {
      if (controller.signal.aborted) return;
      setHistories(current => ({ ...current, ...Object.fromEntries(values.map(item => [item.id, item.value])) }));
      setAnalyses(current => ({ ...Object.fromEntries(values.map(item => [item.id, item.value.versions.find(version => !version.stale)?.id ?? ''])), ...current }));
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [selected, histories]);
  useEffect(() => () => active.current?.abort(), []);
  async function reload() {
    setBusy(true); setError('');
    try { applySaved(await authenticatedRequest<ConversationResponse>('/intelligence/cady/conversation')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reload conversation.'); }
    finally { setBusy(false); }
  }
  async function change(update: () => void) {
    if (busy || loading || uncertain) return;
    setBusy(true); setError('');
    try {
      if (conversation.context || unavailable || outdated) setConversation(await authenticatedRequest<CadyConversation>('/intelligence/cady/conversation/reset', { method: 'POST', body: JSON.stringify({ revision: conversation.revision }) }));
      setOutdated(false); setUnavailable(false); restored.current = false; update();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change context.'); setUncertain(true); }
    finally { setBusy(false); }
  }
  async function ask() {
    if (busy || uncertain) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(''); const text = question.trim();
    try {
      const result = await authenticatedRequest<CadyResult>('/intelligence/cady/ask', { method: 'POST', signal: controller.signal, body: JSON.stringify({
        resumeId, draftId, jobs: selected.map(jobId => ({ jobId, jobAnalysisId: analyses[jobId] })), includeProfileSkills, question: text,
        history: [], revision: conversation.revision, ...settings.options }) });
      if (!controller.signal.aborted) { setConversation(current => ({ ...current, revision: result.conversationRevision!, turns: [...current.turns.slice(-9), { question: text, result }], context: { resume: result.resume, draftId,
        jobs: result.sources.map(item => ({ jobId: item.jobId, jobHash: item.jobHash, jobAnalysisId: item.jobAnalysisId })), profile: includeProfileSkills ? { version: result.profileVersion!, skills: [] } : null, ...settings.options }, updatedAt: new Date().toISOString() })); setQuestion(''); }
    } catch (cause) { setError(controller.signal.aborted ? 'Waiting stopped. Reload the saved conversation before asking again.' : cause instanceof Error ? cause.message : 'Cady could not answer.'); setUncertain(true); }
    finally { setBusy(false); }
  }
  async function linked(jobId: string | null, resume: string | null, draft: string | null) {
    if (jobId && !/^[a-f0-9]{64}$/.test(jobId)) return;
    await change(() => {
      if (resume && resumes.some(item => item.id === resume)) { if (resume !== resumeId || (draft ?? '') !== draftId) setContextLoading(true); setResumeId(resume); setDrafts({ versions: [], nextBeforeVersion: null }); setDraftId(draft ?? ''); }
      if (jobId) { setSelected([jobId]); if (!jobs.some(item => item.id === jobId)) void authenticatedRequest<{ job: Job }>(`/jobs/${jobId}`).then(value => setJobs(values => [value.job, ...values])).catch(cause => setError(cause.message)); }
    });
  }
  function setOptions(options: AiOptions) { void change(() => settings.setOptions(options)); }
  return { ensure: () => setEnabled(true), settings: { ...settings, setOptions }, resumes, resumeId, drafts, draftId, jobs, selected, histories, analyses, includeProfileSkills, question, setQuestion, conversation, busy, error, loading, outdated, unavailable, uncertain, reload, ask, linked,
    ready: Boolean(draftId && selected.every(id => analyses[id]) && settings.capabilities?.available && !loading && !contextLoading && !outdated && !unavailable && !uncertain),
    reset: () => change(() => {}), stop: () => active.current?.abort(),
    chooseResume: (id: string) => change(() => { setContextLoading(true); setResumeId(id); setDraftId(''); setDrafts({ versions: [], nextBeforeVersion: null }); }),
    chooseDraft: (id: string) => change(() => { setContextLoading(true); setDraftId(id); }), chooseProfile: (value: boolean) => change(() => setProfile(value)),
    chooseJob: (id: string, checked: boolean) => change(() => setSelected(values => checked ? [...values, id] : values.filter(item => item !== id))),
    chooseAnalysis: (id: string, value: string) => change(() => setAnalyses(values => ({ ...values, [id]: value }))), moreJobs,
    olderDrafts: async () => { try { const value = await authenticatedRequest<DraftHistory>(`/intelligence/resumes/${resumeId}/drafts?beforeVersion=${drafts.nextBeforeVersion}`); setDrafts(current => ({ ...value, versions: [...current.versions, ...value.versions.filter(item => !current.versions.some(saved => saved.id === item.id))] })); } catch (cause) { setError((cause as Error).message); } },
    moreSavedJobs: async () => { try { const value = await authenticatedRequest<{ savedJobs: SavedJob[]; total: number }>(`/saved-jobs?limit=20&page=${savedPage + 1}`); setJobs(current => [...current, ...value.savedJobs.filter(item => item.available && item.status !== 'NOT_INTERESTED' && !current.some(job => job.id === item.jobId)).map(item => ({ id: item.jobId, ...item.job }))]); setSavedPage(savedPage + 1); setMoreJobs((savedPage + 1) * 20 < value.total); } catch (cause) { setError((cause as Error).message); } },
  };
}
const Context = createContext<ReturnType<typeof useCadyState> | null>(null);
export function CadyProvider({ children }: { children: ReactNode }) { const value = useCadyState(); return <Context.Provider value={value}>{children}</Context.Provider>; }
export function useCady() { const value = useContext(Context); if (!value) throw new Error('Cady provider missing'); return value; }

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { AiSettings } from '../intelligence/AiSettings';
import { Icon, PageHeading } from '../ui/WorkspaceUi';
import { useCady } from './CadyProvider';

function CadyContext() {
  const cady = useCady(), disabled = cady.busy || cady.loading || cady.uncertain;
  return <details className="cady-context" open={!cady.conversation.turns.length}><summary>Choose context · {cady.selected.length} of 3 jobs selected</summary>
    <p className="muted">Choose one CV and up to three jobs. Changing context starts a fresh conversation.</p>
    {cady.loading && <p role="status">Loading your context…</p>}
    {!cady.loading && !cady.resumes.length && <p><Link to="/resumes">Upload and analyze a CV</Link> first.</p>}
    <fieldset disabled={disabled}><legend className="sr-only">Career context</legend>
      <label>Resume version<select value={cady.resumeId} onChange={event => { void cady.chooseResume(event.target.value); }}><option value="" disabled>Choose a CV</option>{cady.resumes.map(item => <option key={item.id} value={item.id}>{item.name} · Version {item.version}</option>)}</select></label>
      <label>CV analysis<select value={cady.draftId} onChange={event => { void cady.chooseDraft(event.target.value); }}><option value="" disabled>No analysis selected</option>{cady.drafts.versions.map(item => <option key={item.id} value={item.id}>Version {item.version} · {item.model}</option>)}</select></label>
      {cady.resumeId && !cady.draftId && <p><Link to="/resumes">Analyze this CV</Link>, then reopen Cady.</p>}
      {cady.drafts.nextBeforeVersion !== null && <button type="button" className="secondary" onClick={() => { void cady.olderDrafts(); }}>Load older CV analyses</button>}
      <details className="review-group"><summary>Selected & saved jobs (optional)</summary>
        {!cady.jobs.length && <p><Link to="/jobs">Explore and save jobs</Link> to discuss them here.</p>}
        {cady.jobs.map(job => <div className="cady-job" key={job.id}><label className="check-label"><input type="checkbox" checked={cady.selected.includes(job.id)} disabled={!cady.selected.includes(job.id) && cady.selected.length >= 3} onChange={event => { void cady.chooseJob(job.id, event.target.checked); }} />{job.title} · {job.company}</label>
          {cady.selected.includes(job.id) && <>{cady.histories[job.id] ? <label>Job analysis for {job.title}<select value={cady.analyses[job.id] ?? ''} onChange={event => { void cady.chooseAnalysis(job.id, event.target.value); }}><option value="" disabled>No current analysis</option>
            {cady.analyses[job.id] && !cady.histories[job.id].versions.some(item => item.id === cady.analyses[job.id]) && <option value={cady.analyses[job.id]}>Saved conversation analysis</option>}
            {cady.histories[job.id].versions.map(item => <option key={item.id} value={item.id} disabled={item.stale}>Version {item.version}{item.stale ? ' · Listing changed' : ''}</option>)}</select></label> : <p role="status">Loading job analyses…</p>}
            {!cady.analyses[job.id] && <p><Link to={`/jobs/${job.id}#job-analysis`}>Analyze this job</Link> to use it here.</p>}</>}
        </div>)}
        {cady.moreJobs && <button type="button" className="secondary" onClick={() => { void cady.moreSavedJobs(); }}>Load more saved jobs</button>}
      </details>
      <label className="check-label"><input type="checkbox" checked={cady.includeProfileSkills} onChange={event => { void cady.chooseProfile(event.target.checked); }} />Include profile skills (self-reported)</label>
      <details className="review-group"><summary>AI settings · {cady.settings.options.model || 'Loading'}</summary><AiSettings settings={cady.settings} disabled={disabled} /></details>
    </fieldset>
  </details>;
}

export function CadyConversationView() {
  const cady = useCady(), messages = useRef<HTMLDivElement>(null);
  useEffect(() => { const element = messages.current; element?.scrollTo({ top: element.scrollHeight, behavior: 'instant' }); }, [cady.conversation.turns.length]);
  return <section className="cady-conversation" aria-label="Conversation with Cady">
    <div className="cady-messages" ref={messages}>
      {!cady.conversation.turns.length && <div className="cady-welcome"><span className="cady-mark"><Icon name="sparkles" /></span><h2>What’s your next move?</h2><p>Work through a job requirement, show your skills clearly, or decide what to practice next.</p><div className="cady-prompts">{['Why am I not matching this role?', 'How can I show my skills more clearly?', 'Which selected job should I prepare for first?'].map(prompt => <button type="button" className="secondary" key={prompt} disabled={cady.busy} onClick={() => cady.setQuestion(prompt)}>{prompt}<Icon name="arrow-right" /></button>)}</div></div>}
      {cady.conversation.turns.map((turn, index) => <article className="cady-turn" key={index}><div className="cady-user-message"><span className="eyebrow">You</span><p className="profile-prose">{turn.question}</p></div><div className="cady-assistant-message"><h3><Icon name="sparkles" /> Cady</h3>{turn.result.answer.paragraphs.map((paragraph, i) => <div key={i}><p className="profile-prose">{paragraph.text}</p>{paragraph.references.length > 0 && <details><summary>Sources ({paragraph.references.length})</summary>{paragraph.references.map(id => { const reference = turn.result.references.find(item => item.id === id); return reference ? <blockquote key={id}><strong>{reference.label}</strong><p>{reference.text}</p></blockquote> : null; })}</details>}</div>)}
        {index === cady.conversation.turns.length - 1 && <div className="actions">{turn.result.answer.followUps.map(prompt => <button type="button" className="secondary" key={prompt} disabled={cady.busy} onClick={() => cady.setQuestion(prompt)}>{prompt}</button>)}</div>}
      </div></article>)}
      {cady.busy && <p role="status">Working with your selected context…</p>}
    </div>
    <div className="cady-composer">
      {(cady.outdated || cady.unavailable) && <p className="extraction-warning">{cady.unavailable ? 'A source is unavailable. Clear this conversation and choose accessible context.' : 'A job or profile changed. This is historical advice. Start a new conversation to use current context.'}</p>}
      {cady.error && <p className="form-error" role="alert">{cady.error}</p>}
      {cady.uncertain && <button type="button" className="secondary" disabled={cady.busy} onClick={() => { void cady.reload(); }}>Reload saved conversation</button>}
      <form onSubmit={event => { event.preventDefault(); void cady.ask(); }}><label>Your question<textarea maxLength={2000} required rows={2} value={cady.question} disabled={cady.busy} onChange={event => cady.setQuestion(event.target.value)} placeholder="Ask about your CV or selected jobs…" /></label><div className="actions"><button disabled={!cady.ready || cady.busy || !cady.question.trim()}>{cady.busy ? 'Cady is thinking…' : 'Ask Cady'}</button>{cady.busy && <button type="button" className="secondary" onClick={cady.stop}>Stop waiting</button>}
        {(cady.conversation.turns.length > 0 || cady.unavailable || cady.outdated) && <button type="button" className="secondary" disabled={cady.busy || cady.uncertain} onClick={() => { void cady.reset(); }}>New conversation</button>}</div></form>
      <p className="muted cady-notice">OpenAI receives selected career facts and your question. Generation may incur charges. Check sources; advice can be mistaken. Cady cannot edit your data.</p>
      <details className="cady-retention"><summary>Conversation privacy</summary><p>Your last 10 question-and-answer pairs are saved to your account. The last 6 messages are sent for continuity. New conversation clears them. Stopping a request may still incur charges.</p></details>
    </div>
  </section>;
}

export function CadyPage() {
  const cady = useCady(), [query] = useSearchParams(), applied = useRef('');
  const jobId = query.get('jobId'), resumeId = query.get('resumeId'), draftId = query.get('draftId'), key = JSON.stringify([jobId, resumeId, draftId]);
  useEffect(() => { cady.ensure(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cady.loading && !cady.uncertain && !cady.conversation.context && !cady.busy && applied.current !== key && (jobId || resumeId)) { applied.current = key; void cady.linked(jobId, resumeId, draftId); }
  }, [cady, key, jobId, resumeId, draftId]);
  return <div className="workspace-page cady-page"><PageHeading eyebrow="Your career buddy" title="Cady" description="A place to think through your next career step. Your conversation follows you across CareerOS." />
    {cady.conversation.context && ((jobId && !cady.selected.includes(jobId)) || (resumeId && resumeId !== cady.resumeId) || (draftId && draftId !== cady.draftId)) && <div className="panel cady-link-notice"><p>You have a saved conversation. Use the linked CV/job to start a new one.</p><button className="secondary" disabled={cady.busy || cady.uncertain} onClick={() => { applied.current = key; void cady.linked(jobId, resumeId, draftId); }}>Use linked context</button></div>}
    <div className="cady-layout"><aside className="panel cady-context-panel"><CadyContext /></aside><div className="panel cady-chat-panel"><CadyConversationView /></div></div>
  </div>;
}

export function CadyWidget() {
  const cady = useCady(), { pathname } = useLocation(), [open, setOpen] = useState(false), dialog = useRef<HTMLDialogElement>(null), launcher = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open && pathname !== '/cady') dialog.current?.showModal(); else dialog.current?.close(); }, [open, pathname]);
  function close() { setOpen(false); requestAnimationFrame(() => launcher.current?.focus()); }
  if (pathname === '/cady' || pathname === '/login' || pathname === '/register') return null;
  return <><button ref={launcher} type="button" className="cady-launcher" aria-label="Open Cady quick chat" onClick={() => { cady.ensure(); setOpen(true); }}><Icon name="sparkles" /><span>Ask Cady</span></button>
    <dialog ref={dialog} className="cady-widget" aria-labelledby="cady-widget-title" onClick={event => { if ((event.target as Element).closest('a')) setOpen(false); }} onCancel={event => { event.preventDefault(); close(); }}><div className="cady-widget-heading"><h2 id="cady-widget-title"><Icon name="sparkles" /> Cady</h2><div className="actions"><Link to="/cady" className="button-link secondary" onClick={() => setOpen(false)}>Full page</Link><button type="button" className="secondary" aria-label="Close Cady quick chat" onClick={close} autoFocus><Icon name="close" /></button></div></div><div className="cady-widget-context"><CadyContext /></div><CadyConversationView /></dialog>
  </>;
}

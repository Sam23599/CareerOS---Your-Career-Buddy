import { type PreparationItem, type ReviewReport } from '../../../../backend/platform/src/intelligence/reviews';

const sectionNames: Record<string, string> = { fullName: 'Name', contact: 'Contact', summary: 'Summary', skills: 'Skills', experience: 'Work experience', education: 'Education' };
const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());

function PreparationRow({ item, report }: { item: PreparationItem; report: ReviewReport }) {
  const match = report.match!.items[item.matchIndex];
  return <li><details className="review-finding"><summary>{match.requirement.value ?? 'Requirement to review'}</summary>
    <p>{item.action}</p><p className="muted">{label(match.category)} · {match.requirement.priority}</p>
    {match.requirement.evidence.map((quote, index) => <blockquote key={index}><strong>Job · {label(quote.section)}</strong><p className="profile-prose">{quote.quote}</p></blockquote>)}
    {match.requirement.priorityEvidence.length > 0 && <details><summary>Why this priority?</summary>{match.requirement.priorityEvidence.map((quote, index) => <blockquote key={index}><p className="profile-prose">{quote.quote}</p></blockquote>)}</details>}
    {match.candidate?.source === 'profile' && <p className="muted">Your profile lists {match.candidate.value}; this is self-reported.</p>}
  </details></li>;
}

export function ResumeCheckReport({ report }: { report: ReviewReport }) {
  const recognized = report.sections.filter(section => section.present).length;
  const warnings = report.findings.filter(finding => finding.severity === 'warning').length;
  const groups = report.match ? [
    { title: 'Required skills not found', items: report.preparation.filter(item => item.kind === 'not_found' && report.match!.items[item.matchIndex].requirement.priority === 'required') },
    { title: 'Other skills not found', items: report.preparation.filter(item => item.kind === 'not_found' && report.match!.items[item.matchIndex].requirement.priority === 'unspecified') },
    { title: 'Preferred skills not found', items: report.preparation.filter(item => item.kind === 'not_found' && report.match!.items[item.matchIndex].requirement.priority === 'preferred') },
    { title: 'Profile skills to support in your CV', items: report.preparation.filter(item => item.kind === 'profile_only') },
    { title: 'Requirements needing your judgment', items: report.preparation.filter(item => item.kind === 'review') },
  ].filter(group => group.items.length) : [];
  return <section className="resume-check-report" aria-label="Resume checks and preparation">
    <div className="section-heading"><div><p className="eyebrow">Improve your next application</p><h3>Resume checks</h3></div><span className="workspace-badge">{warnings} {warnings === 1 ? 'warning' : 'warnings'} · {report.findings.length - warnings} suggestions</span></div>
    <p className="muted">{recognized} of 6 sections recognized in this saved analysis. These are CareerOS checks, not an employer ATS assessment.</p>
    <div className="review-sections" aria-label="Recognized resume sections">{report.sections.map(section => <span className={`review-section ${section.present ? 'recognized' : ''}`} key={section.section}>{sectionNames[section.section]}: {section.present ? 'Recognized' : 'Not recognized'}</span>)}</div>
    {report.findings.length ? <details className="review-group"><summary>Resume findings ({report.findings.length})</summary><ul className="review-list">{report.findings.map(finding => <li key={finding.code}><details className="review-finding"><summary><span>{finding.title}</span><span className="workspace-badge">{finding.severity === 'warning' ? 'Warning' : 'Suggestion'}</span></summary>
      <p>{finding.message}</p><p><strong>Next step:</strong> {finding.action}</p>
      {finding.evidence.map((quote, index) => <blockquote key={index}><strong>CV · Page {quote.page}</strong><p className="profile-prose">{quote.quote}</p></blockquote>)}
    </details></li>)}</ul></details> : <p>No findings from these limited checks. Review the PDF yourself before applying.</p>}
    {report.match && <div className="preparation-report"><h3>Skills & preparation</h3><p className="muted">“Not found” means no skill evidence in the selected inputs. Verify what you already know before deciding what to learn.</p>
      {groups.map(group => <details className="review-group" key={group.title}><summary>{group.title} ({group.items.length})</summary><ul className="review-list">{group.items.map(item => <PreparationRow key={item.matchIndex} item={item} report={report} />)}</ul></details>)}
      {!groups.length && <p>No preparation items from the stated requirements. This does not establish overall suitability.</p>}
    </div>}
    {report.match && <details className="review-group"><summary>Job terminology ({report.keywords.filter(item => item.status === 'found').length}/{report.keywords.length} phrases found)</summary>
      <p className="muted">Literal phrases from the saved job analysis, checked against extracted CV text. Mentions do not prove skill or experience. Use missing wording only when it accurately describes your background.</p>
      {report.keywords.length ? <ul className="review-list">{report.keywords.map((item, index) => <li key={index}><details className="review-finding"><summary>{item.term.value} · {item.status === 'found' ? 'Mention found' : 'Not found'}</summary>
        {item.term.evidence.map((quote, i) => <blockquote key={i}><strong>Job · {label(quote.section)}</strong><p className="profile-prose">{quote.quote}</p></blockquote>)}
        {item.evidence.map((quote, i) => <blockquote key={i}><strong>CV · Page {quote.page}</strong><p className="profile-prose">{quote.quote}</p></blockquote>)}
      </details></li>)}</ul> : <p>No keywords were recognized in this job analysis.</p>}
    </details>}
    <details className="review-method"><summary>Sources & limits</summary><p>PDF version {report.source.resume.resumeVersion} · CV analysis {report.source.draftVersion}{report.match ? ` · Job analysis ${report.match.source.jobAnalysisVersion}` : ''}{report.match?.source.profileVersion != null ? ` · Profile version ${report.match.source.profileVersion}` : ''}.</p>
      <p>Checks reuse saved facts and PDF reading warnings. They do not inspect visual layout, simulate an employer’s ATS, infer years of experience, or generate qualifications. Sections may be missing from an analysis even when present in the PDF. Optional sections are suggestions, not mandatory requirements.</p>
      <p>No new AI call, automatic edits or stored report. Rerun after changing the selected inputs.</p>
    </details>
  </section>;
}

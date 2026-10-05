import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest } from '../auth/session';
import { type CareerProfile } from './types';
import { PasswordSettings } from '../auth/PasswordSettings';
import { UsernameSettings } from '../auth/UsernameSettings';
import { Icon, PageHeading } from '../ui/WorkspaceUi';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel profile-section"><h2>{title}</h2>{children}</section>;
}
function Tags({ values }: { values: string[] }) {
  return values.length ? <ul className="profile-tags">{values.map(value => <li key={value}>{value}</li>)}</ul> : <p className="muted">Not added yet.</p>;
}
function month(value: string) {
  return value ? new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
}
const levels = { ENTRY: 'Entry level', MID: 'Mid level', SENIOR: 'Senior', LEAD: 'Lead' };
const modes = { REMOTE: 'Remote', HYBRID: 'Hybrid', ONSITE: 'On-site' };

export function ProfileView() {
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void authenticatedRequest<{ profile: CareerProfile }>('/profiles/me')
      .then(result => { if (active) setProfile(result.profile); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load your profile.'); });
    return () => { active = false; };
  }, [attempt]);
  if (!profile) return <section className="panel auth-panel"><h1>Your profile</h1>{error
    ? <><p role="alert" className="form-error">{error}</p><button onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry</button></>
    : <p role="status">Loading your profile…</p>}</section>;
  const p = profile.preferences;
  const salary = p.salaryMin !== null && p.salaryMax !== null ? `${p.salaryMin.toLocaleString()} – ${p.salaryMax.toLocaleString()}`
    : p.salaryMin !== null ? `From ${p.salaryMin.toLocaleString()}` : p.salaryMax !== null ? `Up to ${p.salaryMax.toLocaleString()}` : '';
  return <div className="profile-page profile-view">
    <PageHeading eyebrow="Your career profile" title={profile.fullName} description="Your experience, your strengths, and where you want to go next." actions={
      <nav className="profile-nav actions" aria-label="Profile navigation"><Link className="secondary button-link" to="/dashboard">Dashboard</Link><Link className="secondary button-link" to="/resumes">Manage resumes</Link><Link className="profile-edit-link button-link" to="/profile/edit">Edit profile<Icon name="arrow-right" /></Link></nav>
    } />
    <section className="panel profile-section profile-hero">
      <div className="profile-avatar" aria-hidden="true">{profile.fullName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</div>
      <div className="profile-hero-details"><p className="eyebrow">Your professional story</p><h2 className="profile-headline">{profile.headline || 'Professional overview'}</h2>
        {profile.location && <p className="muted">{profile.location}</p>}
        {profile.phone && <p>Phone: {profile.phone}</p>}
      </div>
      <span className="profile-private-badge"><Icon name="shield" />Private profile</span>
    </section>
    {profile.version === 0 && <p className="description">Your profile is ready to build. Choose Edit profile to add your experience, skills, and career goals.</p>}
    <div className="profile-overview-grid">
    <div className="profile-main">
    <Section title="About"><p className="profile-prose">{profile.summary || 'Add a summary to tell your professional story.'}</p></Section>
    <Section title="Skills"><Tags values={profile.skills} /></Section>
    <Section title="Experience">{profile.experience.length ? profile.experience.map((entry, index) => <article className="profile-detail" key={index}>
      <h3>{entry.role}</h3><p>{entry.company}{entry.location && ` · ${entry.location}`}</p>
      <p className="muted">{month(entry.startDate)} – {entry.current ? 'Present' : month(entry.endDate)}</p>
      {entry.description && <p className="profile-prose">{entry.description}</p>}
    </article>) : <p className="muted">No experience added yet.</p>}</Section>
    <Section title="Education">{profile.education.length ? profile.education.map((entry, index) => <article className="profile-detail" key={index}>
      <h3>{entry.institution}</h3><p>{entry.qualification}{entry.field && ` · ${entry.field}`}</p>
      <p className="muted">{month(entry.startDate)} – {entry.endDate ? month(entry.endDate) : 'Present'}</p>
    </article>) : <p className="muted">No education added yet.</p>}</Section>
    <Section title="Certifications">{profile.certifications.length ? profile.certifications.map((entry, index) => <article className="profile-detail" key={index}>
      <h3>{entry.name}</h3>{entry.issuer && <p>{entry.issuer}</p>}{entry.issuedDate && <p className="muted">{month(entry.issuedDate)}</p>}
      {entry.url && <a href={entry.url} target="_blank" rel="noopener noreferrer">View credential</a>}
    </article>) : <p className="muted">No certifications added yet.</p>}</Section>
    </div>
    <div className="profile-sidebar">
    <Section title="Career preferences"><dl className="profile-preferences">
      <div><dt>Preferred roles</dt><dd>{p.roles.join(', ') || 'Not specified'}</dd></div>
      <div><dt>Preferred locations</dt><dd>{p.locations.join(', ') || 'Not specified'}</dd></div>
      <div><dt>Work modes</dt><dd>{p.workModes.map(mode => modes[mode]).join(', ') || 'Not specified'}</dd></div>
      <div><dt>Experience level</dt><dd>{p.experienceLevel ? levels[p.experienceLevel] : 'Not specified'}</dd></div>
      <div><dt>Salary expectations</dt><dd>{salary ? `${salary} ${p.currency} / ${p.salaryPeriod === 'YEAR' ? 'year' : 'month'}` : 'Not specified'}</dd></div>
      <div><dt>Career interests</dt><dd>{p.interests.join(', ') || 'Not specified'}</dd></div>
    </dl></Section>
    <Section title="Professional links">{profile.links.length ? <ul className="profile-links">{profile.links.map((link, index) => <li key={index}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></li>)}</ul> : <p className="muted">No professional links added yet.</p>}</Section>
    <UsernameSettings />
    <PasswordSettings />
    </div>
    </div>
  </div>;
}

import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { authenticatedRequest, RequestError } from '../auth/session';
import { Entries, TagsInput } from './Fields';
import { type CareerProfile, type Preferences } from './types';

export function ProfilePage() {
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [saved, setSaved] = useState<CareerProfile | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dirty = JSON.stringify(profile) !== JSON.stringify(saved);

  useEffect(() => {
    let active = true;
    void authenticatedRequest<{ profile: CareerProfile }>('/profiles/me')
      .then(result => { if (active) { setProfile(result.profile); setSaved(result.profile); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load your profile.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function reload() {
    if (dirty && !window.confirm('Discard your unsaved changes and load the latest saved profile?')) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const result = await authenticatedRequest<{ profile: CareerProfile }>('/profiles/me');
      setProfile(result.profile); setSaved(result.profile); setConflict(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load your profile.'); }
    finally { setLoading(false); }
  }
  function change(update: Partial<CareerProfile>) { setProfile(current => current ? { ...current, ...update } : current); setMessage(''); }
  function preference(update: Partial<Preferences>) { if (profile) change({ preferences: { ...profile.preferences, ...update } }); }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    setBusy(true); setError(''); setMessage('');
    const { updatedAt: _updated, ...payload } = profile;
    void _updated;
    try {
      const result = await authenticatedRequest<{ profile: CareerProfile }>('/profiles/me', { method: 'PATCH', body: JSON.stringify(payload) });
      setProfile(result.profile); setSaved(result.profile); setMessage('Profile saved.');
    } catch (cause) {
      setConflict(cause instanceof RequestError && cause.status === 409);
      setError(cause instanceof Error ? cause.message : 'Could not save your profile. Your changes are still here.');
    } finally { setBusy(false); }
  }
  if (!profile) return <section className="panel auth-panel"><h1>Career profile</h1>{error
    ? <><p role="alert" className="form-error">{error}</p><button disabled={loading} onClick={reload}>Retry</button></>
    : <p role="status">Loading your profile…</p>}</section>;

  return <div className="profile-page">
    <Link to="/profile" onClick={event => { if (dirty && !window.confirm('Leave without saving your profile changes?')) event.preventDefault(); }}>← View profile</Link>
    <h1>Edit career profile</h1>
    <p className="description">Bring your experience, skills, and career goals together. Only you can access this profile.</p>
    <form onSubmit={save}>
      <fieldset disabled={busy || loading}>
        <section className="panel profile-section" aria-labelledby="about-heading">
          <h2 id="about-heading">About you</h2>
          <div className="profile-grid">
            <label>Full name<input required maxLength={100} value={profile.fullName} onChange={event => change({ fullName: event.target.value })} /></label>
            <label>Headline<input maxLength={200} placeholder="Backend engineer · Python & Node.js" value={profile.headline} onChange={event => change({ headline: event.target.value })} /></label>
            <label>Location<input maxLength={200} value={profile.location} onChange={event => change({ location: event.target.value })} /></label>
            <label>Phone<input type="tel" maxLength={40} value={profile.phone} onChange={event => change({ phone: event.target.value })} /></label>
            <label className="full-width">Professional summary<textarea rows={4} maxLength={5000} value={profile.summary} onChange={event => change({ summary: event.target.value })} /></label>
          </div>
        </section>
        <section className="panel profile-section" aria-labelledby="skills-heading">
          <h2 id="skills-heading">Skills</h2>
          <TagsInput key={`skills-${profile.version}-${loading}`} label="Your skills" values={profile.skills} onChange={skills => change({ skills })} />
        </section>
        <section className="panel profile-section" aria-labelledby="experience-heading">
          <h2 id="experience-heading">Experience</h2>
          <Entries label="Experience" max={30} items={profile.experience} onChange={experience => change({ experience })}
            create={() => ({ company: '', role: '', location: '', startDate: '', endDate: '', current: false, description: '' })}
            fields={[{ key: 'company', label: 'Company', required: true, maxLength: 200 }, { key: 'role', label: 'Role', required: true, maxLength: 200 }, { key: 'location', label: 'Location', maxLength: 200 }, { key: 'startDate', label: 'Start date', type: 'month', required: true }, { key: 'endDate', label: 'End date', type: 'month' }, { key: 'current', label: 'I currently work here', type: 'checkbox' }, { key: 'description', label: 'Responsibilities and achievements', type: 'textarea', maxLength: 3000 }]} />
        </section>
        <section className="panel profile-section" aria-labelledby="education-heading">
          <h2 id="education-heading">Education</h2>
          <p className="muted">Leave the end date empty for ongoing education.</p>
          <Entries label="Education" max={20} items={profile.education} onChange={education => change({ education })}
            create={() => ({ institution: '', qualification: '', field: '', startDate: '', endDate: '' })}
            fields={[{ key: 'institution', label: 'Institution', required: true, maxLength: 200 }, { key: 'qualification', label: 'Qualification', required: true, maxLength: 200 }, { key: 'field', label: 'Field of study', maxLength: 200 }, { key: 'startDate', label: 'Start date', type: 'month', required: true }, { key: 'endDate', label: 'End date', type: 'month' }]} />
        </section>
        <section className="panel profile-section" aria-labelledby="certifications-heading">
          <h2 id="certifications-heading">Certifications</h2>
          <Entries label="Certification" max={30} items={profile.certifications} onChange={certifications => change({ certifications })}
            create={() => ({ name: '', issuer: '', issuedDate: '', url: '' })}
            fields={[{ key: 'name', label: 'Certification name', required: true, maxLength: 200 }, { key: 'issuer', label: 'Issuer', maxLength: 200 }, { key: 'issuedDate', label: 'Issue date', type: 'month' }, { key: 'url', label: 'Credential URL', type: 'url', maxLength: 2048 }]} />
        </section>
        <section className="panel profile-section" aria-labelledby="preferences-heading">
          <h2 id="preferences-heading">Career preferences</h2>
          <div className="profile-grid" key={`preferences-${profile.version}-${loading}`}>
            <TagsInput label="Preferred roles" values={profile.preferences.roles} onChange={roles => preference({ roles })} />
            <TagsInput label="Preferred locations" values={profile.preferences.locations} onChange={locations => preference({ locations })} />
            <label>Experience level<select value={profile.preferences.experienceLevel} onChange={event => preference({ experienceLevel: event.target.value as Preferences['experienceLevel'] })}>
              <option value="">Not specified</option><option value="ENTRY">Entry level</option><option value="MID">Mid level</option><option value="SENIOR">Senior</option><option value="LEAD">Lead</option>
            </select></label>
            <fieldset className="work-modes"><legend>Preferred work modes</legend>{(['REMOTE', 'HYBRID', 'ONSITE'] as const).map(mode => <label className="check-label" key={mode}>
              <input type="checkbox" checked={profile.preferences.workModes.includes(mode)} onChange={event => preference({ workModes: event.target.checked ? [...profile.preferences.workModes, mode] : profile.preferences.workModes.filter(value => value !== mode) })} />{mode === 'REMOTE' ? 'Remote' : mode === 'HYBRID' ? 'Hybrid' : 'On-site'}
            </label>)}</fieldset>
            <label>Minimum salary<input type="number" min={0} max={1_000_000_000} step="any" value={profile.preferences.salaryMin ?? ''} onChange={event => preference({ salaryMin: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            <label>Maximum salary<input type="number" min={0} max={1_000_000_000} step="any" value={profile.preferences.salaryMax ?? ''} onChange={event => preference({ salaryMax: event.target.value === '' ? null : Number(event.target.value) })} /></label>
            <label>Currency<input placeholder="e.g. INR, USD" maxLength={3} pattern="[A-Za-z]{3}" required={profile.preferences.salaryMin !== null || profile.preferences.salaryMax !== null} value={profile.preferences.currency} onChange={event => preference({ currency: event.target.value })} /></label>
            <label>Salary period<select value={profile.preferences.salaryPeriod} onChange={event => preference({ salaryPeriod: event.target.value as Preferences['salaryPeriod'] })}><option value="YEAR">Per year</option><option value="MONTH">Per month</option></select></label>
            <TagsInput label="Career interests" values={profile.preferences.interests} onChange={interests => preference({ interests })} />
          </div>
        </section>
        <section className="panel profile-section" aria-labelledby="links-heading">
          <h2 id="links-heading">Professional links</h2>
          <p className="muted">Add your LinkedIn, GitHub, Naukri, coding profile, or portfolio URLs.</p>
          <Entries label="Professional link" max={20} items={profile.links} onChange={links => change({ links })}
            create={() => ({ label: '', url: '' })}
            fields={[{ key: 'label', label: 'Link label', required: true, maxLength: 100 }, { key: 'url', label: 'Profile URL', type: 'url', required: true, maxLength: 2048 }]} />
        </section>
        <div className="profile-save">
          {error && <p role="alert" className="form-error">{error}</p>}
          <p role="status">{message || (dirty ? 'You have unsaved changes.' : profile.updatedAt ? 'Your profile is up to date.' : 'Fill in your profile when you’re ready.')}</p>
          <div className="actions"><button type="submit" disabled={!dirty || conflict}>{busy ? 'Saving…' : 'Save profile'}</button><button type="button" className="secondary" onClick={reload}>{loading ? 'Loading…' : 'Reload saved profile'}</button></div>
        </div>
      </fieldset>
    </form>
  </div>;
}

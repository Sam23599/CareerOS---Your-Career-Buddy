import { useEffect, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { OAuthButtons } from '../../src/auth/OAuthButtons';
import { restoreSession } from '../../src/auth/session';
import { TagsInput, Entries } from '../../src/profiles/Fields';
import { ResumePreview } from '../../src/resumes/ResumePreview';
import { SaveJobButton } from '../../src/saved-jobs/SaveJobButton';

export function Tags() {
  const [values, setValues] = useState(['TypeScript']);
  return <><TagsInput label="Skills" values={values} onChange={setValues} /><output aria-label="Saved values">{JSON.stringify(values)}</output></>;
}
export function Experience() {
  const [items, setItems] = useState([{ company: 'Example', current: false, endDate: '2025-12' }]);
  return <Entries label="Experience" items={items} onChange={setItems} max={2}
    create={() => ({ company: '', current: false, endDate: '' })}
    fields={[{ key: 'company', label: 'Company', required: true }, { key: 'current', label: 'Current role', type: 'checkbox' }, { key: 'endDate', label: 'End date', type: 'month' }]} />;
}
export function OAuth() { return <OAuthButtons />; }
export function Preview() {
  const [open, setOpen] = useState(true);
  return open ? <ResumePreview resume={{ id: 'test-resume', name: 'Resume.pdf' }} onClose={() => setOpen(false)} /> : <p>Preview closed</p>;
}
export function SavedJob() {
  useEffect(() => { void restoreSession().catch(() => {}); }, []);
  return <MemoryRouter><SaveJobButton jobId="test-job" /></MemoryRouter>;
}

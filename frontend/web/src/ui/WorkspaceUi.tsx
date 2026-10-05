import { type ReactNode } from 'react';

const paths = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  jobs: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a23 23 0 0 0 18 0M12 11v4" /></>,
  bookmark: <path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4Z" />,
  resume: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8M8 17h5" /></>,
  sources: <><rect x="3" y="8" width="7" height="12" rx="1" /><path d="M10 20h11V4H10v4M6 12h1M6 16h1M14 8h3M14 12h3M14 16h3" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  'arrow-right': <path d="M4 12h16m-6-6 6 6-6 6" />,
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></>,
  link: <><path d="m10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" /></>,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="3" fill="currentColor" /><circle cx="16" cy="17" r="3" fill="currentColor" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
  sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /><path d="M20 2v4m-2-2h4" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  'log-out': <><path d="M9 4H4v16h5M9 12h12m-5-5 5 5-5 5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
};

export type IconName = keyof typeof paths;
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`workspace-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="workspace-page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="description">{description}</p></div>{actions && <div className="workspace-heading-actions">{actions}</div>}</div>;
}

import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useSession } from '../auth/session';
import { NotificationLink } from '../notifications/NotificationLink';
import { Icon, type IconName } from './WorkspaceUi';
import { workspaceNavigationEvent } from './navigation';

const destinations: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/dashboard', label: 'Overview', icon: 'dashboard' },
  { to: '/jobs', label: 'Opportunities', icon: 'jobs' },
  { to: '/saved-jobs', label: 'Shortlist', icon: 'bookmark' },
  { to: '/resumes', label: 'Documents', icon: 'resume' },
  { to: '/cady', label: 'Cady', icon: 'sparkles' },
  { to: '/career-sources', label: 'Company feeds', icon: 'sources' },
  { to: '/notifications', label: 'Activity', icon: 'bell' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/recycle-bin', label: 'Recycle bin', icon: 'bookmark' },
  { to: '/tasks', label: 'Task history', icon: 'bell' },
  { to: '/profile', label: 'Career profile', icon: 'profile' },
];

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const { pathname, search } = useLocation();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const open = openPath === pathname;
  const authentication = pathname === '/login' || pathname === '/register';
  const current = destinations.find(item => pathname === item.to || pathname.startsWith(`${item.to}/`));
  const initials = session.user?.name.split(/\s+/).slice(0, 2).map(value => value[0]).join('').toUpperCase();
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = new URL(event.currentTarget.href);
    if ((target.pathname !== pathname || target.search !== search) && !window.dispatchEvent(new Event(workspaceNavigationEvent, { cancelable: true }))) {
      event.preventDefault(); return;
    }
    setOpenPath(null);
    if (open) requestAnimationFrame(() => document.getElementById('workspace-content')?.focus());
  }
  const brand = <Link className="brand workspace-brand" to="/" onClick={navigate}><span className="logo" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M24 9a10 10 0 1 0 0 14M15 16l6-6m-2 0h2v2" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span><strong>CareerOS</strong><small>Your career buddy</small></span></Link>;
  return <div className={`workspace-shell${authentication ? ' workspace-auth-shell' : ''}`}>
    <a className="workspace-skip-link" href="#workspace-content">Skip to content</a>
    {!authentication && <aside className="workspace-sidebar">
      {brand}
      <p className="workspace-nav-label">Your workspace</p>
      <nav aria-label="Workspace" className="workspace-navigation">{destinations.map(item => <NavLink key={item.to} to={item.to} onClick={navigate}><Icon name={item.icon} /><span>{item.label}</span><Icon name="chevron-right" className="workspace-nav-arrow" /></NavLink>)}</nav>
      <div className="workspace-sidebar-note"><span className="workspace-note-icon"><Icon name="sparkles" /></span><p>A little progress.<br /><strong>A better next chapter.</strong></p><span>Keep your goals, documents and opportunities together.</span></div>
      <Link to="/status" className="workspace-service-link" onClick={navigate}><Icon name="shield" />Connection status</Link>
    </aside>}
    <div className="workspace-body">
      <header className="workspace-topbar">
        {authentication ? brand : <>
          <button ref={menuButton} className="workspace-menu-button secondary" type="button" aria-label={open ? 'Close workspace navigation' : 'Open workspace navigation'} aria-expanded={open} aria-controls="workspace-mobile-navigation" onClick={() => setOpenPath(open ? null : pathname)}><Icon name={open ? 'close' : 'menu'} /></button>
          <div className="workspace-breadcrumb"><span>Workspace</span><Icon name="chevron-right" /><strong>{current?.label ?? 'Service status'}</strong></div>
        </>}
        <div className="workspace-topbar-actions"><NotificationLink />
          {session.state === 'authenticated' ? <Link className="workspace-account" to="/profile" onClick={navigate} aria-label="Open account profile"><span className="workspace-account-avatar" aria-hidden="true">{initials}</span><span>{session.user?.name}</span></Link> : <Link className="workspace-signin" to={authentication ? '/jobs' : '/login'} onClick={navigate}>{authentication ? 'Explore jobs' : 'Sign in'}<Icon name="arrow-right" /></Link>}
        </div>
      </header>
      {!authentication && <nav id="workspace-mobile-navigation" aria-label="Mobile workspace" className="workspace-mobile-navigation" hidden={!open} onKeyDown={event => { if (event.key === 'Escape') { setOpenPath(null); menuButton.current?.focus(); } }}>{destinations.map(item => <NavLink key={item.to} to={item.to} onClick={navigate}><Icon name={item.icon} />{item.label}</NavLink>)}</nav>}
      <main id="workspace-content" className="workspace-content" tabIndex={-1}>{children}</main>
      {!authentication && <footer className="workspace-footer"><span>CareerOS</span><span>Make room for your next chapter.</span></footer>}
    </div>
  </div>;
}

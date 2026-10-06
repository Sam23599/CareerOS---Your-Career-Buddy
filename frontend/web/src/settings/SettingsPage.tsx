import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeading } from '../ui/WorkspaceUi';
import { currentTheme, saveTheme, type Theme } from '../ui/theme';

export function SettingsPage() {
  const [theme, setTheme] = useState(currentTheme);
  return <div className="workspace-page profile-page"><PageHeading eyebrow="Make it yours" title="Settings" description="Appearance and shortcuts, with a preview of future usage and credit settings." />
    <section className="panel profile-section"><h2>Appearance</h2><label>Theme<select value={theme} onChange={event => { const value = event.target.value as Theme; saveTheme(value); setTheme(value); }}><option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option></select></label><p className="muted">Remembered in this browser.</p></section>
    <section className="panel profile-section"><h2>Your workspace</h2><div className="actions"><Link to="/profile">Account and profile</Link><Link to="/notifications">Notifications</Link><Link to="/recycle-bin">Recycle bin</Link><Link to="/tasks">Task history</Link><Link to="/status">Service status</Link></div></section>
    <section className="panel profile-section" aria-label="Demo usage and credits"><div className="workspace-card-heading compact-card-heading"><h2>AI usage and credits</h2><span className="workspace-badge">Demo only</span></div><p>Sample figures for the future settings page. No usage is tracked here and no payment can be made.</p><div className="profile-grid"><div><strong>1,200</strong><p className="muted">Sample credits remaining</p></div><div><strong>8</strong><p className="muted">Sample analyses this month</p></div></div><fieldset disabled><label>Sample recharge amount<select defaultValue="500"><option value="500">500 credits</option><option value="1000">1,000 credits</option></select></label><label className="check-label"><input type="checkbox" />Automatically refill credits</label><button>Recharge — coming later</button></fieldset><p className="muted">Real provider usage, purchased credits and payment history will come in a later release.</p></section>
  </div>;
}

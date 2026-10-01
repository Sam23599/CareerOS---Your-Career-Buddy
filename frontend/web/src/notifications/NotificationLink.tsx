import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { authenticatedRequest, useSession } from '../auth/session';

export function notificationsChanged() { window.dispatchEvent(new Event('notifications-updated')); }
function Badge() {
  const { pathname } = useLocation(); const [count, setCount] = useState<number>();
  useEffect(() => {
    let active = true;
    const refresh = () => { if (document.hidden) return; void authenticatedRequest<{ unreadCount: number }>('/notifications?limit=1').then(result => { if (active) setCount(result.unreadCount); }).catch(() => { if (active) setCount(undefined); }); };
    refresh(); const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('notifications-updated', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('notifications-updated', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [pathname]);
  return <Link to="/notifications">Notifications{count ? ` (${count})` : ''}</Link>;
}
export function NotificationLink() { const session = useSession(); return session.state === 'authenticated' ? <Badge key={session.user?.id} /> : null; }

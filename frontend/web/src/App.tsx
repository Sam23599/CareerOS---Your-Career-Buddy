import { ResumesPage } from './resumes/ResumesPage';
import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { AuthPage } from './auth/AuthPage';
import { Dashboard } from './auth/Dashboard';
import { initializeSession, refreshSession, useSession } from './auth/session';
import { ProfileView } from './profiles/ProfileView';
import { ProfilePage } from './profiles/ProfilePage';
import { ConnectionStatus } from './ConnectionStatus';

function AccountRoutes() {
  const session = useSession();
  const [retrying, setRetrying] = useState(false);
  if (session.state === 'loading') return <p role="status">Restoring your session…</p>;
  if (session.state === 'unavailable') return (
    <section className="panel auth-panel">
      <h2>We couldn’t check your session</h2>
      <p role="alert">Check your connection and try again.</p>
      <button disabled={retrying} onClick={() => {
        setRetrying(true);
        void refreshSession().catch(() => {}).finally(() => setRetrying(false));
      }}>{retrying ? 'Checking…' : 'Try again'}</button>
    </section>
  );
  const destination = session.state === 'authenticated' ? '/dashboard' : '/login';
  return <Routes>
    <Route path="/login" element={<AuthPage key="login" mode="login" />} />
    <Route path="/register" element={<AuthPage key="register" mode="register" />} />
    <Route path="/resumes" element={session.state === 'authenticated' ? <ResumesPage key={session.user?.id} /> : <Navigate to="/login" replace />} />
    <Route path="/profile" element={session.state === 'authenticated' ? <ProfileView key={session.user?.id} /> : <Navigate to="/login" replace />} />
    <Route path="/profile/edit" element={session.state === 'authenticated' ? <ProfilePage key={session.user?.id} /> : <Navigate to="/login" replace />} />
    <Route path="/dashboard" element={session.state === 'authenticated' ? <Dashboard key={session.user?.id} /> : <Navigate to="/login" replace />} />
    <Route path="/" element={<Navigate to={destination} replace />} />
    <Route path="*" element={<section className="panel auth-panel"><h1>Page not found</h1><Link to={destination}>Go to your workspace</Link></section>} />
  </Routes>;
}

export function App() {
  useEffect(() => { void initializeSession(); }, []);
  return <BrowserRouter><main>
    <header><Link className="brand" to="/"><span className="logo" aria-hidden="true">C</span><strong>CareerOS</strong></Link><span className="badge">Your career buddy</span></header>
    <Routes>
      <Route path="/status" element={<ConnectionStatus />} />
      <Route path="*" element={<AccountRoutes />} />
    </Routes>
  </main></BrowserRouter>;
}

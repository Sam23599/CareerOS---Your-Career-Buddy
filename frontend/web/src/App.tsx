import { TasksPage } from './tasks/TasksPage';
import { CadyPage } from './cady/CadyPage';
import { SettingsPage } from './settings/SettingsPage';
import { RecycleBinPage } from './recovery/RecycleBinPage';
import { SavedJobsPage } from './saved-jobs/SavedJobsPage';
import { JobsPage, JobDetailPage } from './jobs/JobsPage';
import { ResumesPage } from './resumes/ResumesPage';
import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router';
import { AuthPage } from './auth/AuthPage';
import { Dashboard } from './auth/Dashboard';
import { initializeSession, restoreSession, useSession } from './auth/session';
import { ProfileView } from './profiles/ProfileView';
import { ProfilePage } from './profiles/ProfilePage';
import { ConnectionStatus } from './ConnectionStatus';
import { CareerSourcesPage } from './career-sources/CareerSourcesPage';
import { SourceJobsPage } from './career-sources/SourceJobsPage';
import { NotificationsPage } from './notifications/NotificationsPage';
import { WorkspaceShell } from './ui/WorkspaceShell';

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
        void restoreSession().catch(() => {}).finally(() => setRetrying(false));
      }}>{retrying ? 'Checking…' : 'Try again'}</button>
    </section>
  );
  const destination = session.state === 'authenticated' ? '/dashboard' : '/login';
  return <Routes>
    <Route path="/cady" element={session.state === 'authenticated' ? <CadyPage key={session.user?.id} /> : <Navigate to="/login" replace />} />
    <Route path="/tasks" element={session.state === 'authenticated' ? <TasksPage /> : <Navigate to="/login" replace />} />
    <Route path="/settings" element={session.state === 'authenticated' ? <SettingsPage /> : <Navigate to="/login" replace />} />
    <Route path="/recycle-bin" element={session.state === 'authenticated' ? <RecycleBinPage /> : <Navigate to="/login" replace />} />
    <Route path="/login" element={<AuthPage key="login" mode="login" />} />
    <Route path="/register" element={<AuthPage key="register" mode="register" />} />
    <Route path="/career-sources" element={session.state === 'authenticated' ? <CareerSourcesPage key={session.user?.id} /> : <Navigate to="/login" replace />} />
    <Route path="/career-sources/:id/jobs" element={session.state === 'authenticated' ? <SourceJobsPage key={session.user?.id} /> : <Navigate to="/login" replace />} />
    <Route path="/notifications" element={session.state === 'authenticated' ? <NotificationsPage key={session.user?.id} /> : <Navigate to="/login" replace />} />
    <Route path="/saved-jobs" element={session.state === 'authenticated' ? <SavedJobsPage key={session.user?.id} /> : <Navigate to="/login" replace />} />
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
  return <BrowserRouter><WorkspaceShell>
    <Routes>
      <Route path="/jobs" element={<JobsPage />} />
      <Route path="/jobs/:id" element={<JobDetailPage />} />
      <Route path="/status" element={<ConnectionStatus />} />
      <Route path="*" element={<AccountRoutes />} />
    </Routes>
  </WorkspaceShell></BrowserRouter>;
}

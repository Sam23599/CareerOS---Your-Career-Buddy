import { useEffect } from 'react';

export const workspaceNavigationEvent = 'careeros:workspace-navigate';
export const workspaceLabels = { jobs: 'Jobs', savedJobs: 'Saved jobs', resumes: 'Resumes', careerSources: 'Career sources', notifications: 'Notifications' } as const;

/** Keep a page's existing discard confirmation on the new workspace navigation. */
export function useWorkspaceNavigationGuard(canLeave: () => boolean) {
  useEffect(() => {
    const guard = (event: Event) => { if (!canLeave()) event.preventDefault(); };
    window.addEventListener(workspaceNavigationEvent, guard);
    return () => window.removeEventListener(workspaceNavigationEvent, guard);
  }, [canLeave]);
}

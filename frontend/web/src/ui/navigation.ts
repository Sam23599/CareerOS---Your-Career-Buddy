import { useEffect } from 'react';

export const workspaceNavigationEvent = 'careeros:workspace-navigate';

/** Keep a page's existing discard confirmation on the new workspace navigation. */
export function useWorkspaceNavigationGuard(canLeave: () => boolean) {
  useEffect(() => {
    const guard = (event: Event) => { if (!canLeave()) event.preventDefault(); };
    window.addEventListener(workspaceNavigationEvent, guard);
    return () => window.removeEventListener(workspaceNavigationEvent, guard);
  }, [canLeave]);
}

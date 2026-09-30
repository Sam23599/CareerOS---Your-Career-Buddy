import { useSyncExternalStore } from 'react';

export type User = { id: string; name: string; email: string; roles: ('USER' | 'ADMIN')[] };
type LoginResult = { user: User; accessToken: string; expiresAt: string };
type Snapshot = { state: 'loading' | 'authenticated' | 'anonymous' | 'unavailable'; user: User | null };
let snapshot: Snapshot = { state: 'loading', user: null };
let accessToken: string | null = null;
let expiresAt = 0;
let pendingRefresh: Promise<void> | undefined;
let bootstrap: Promise<void> | undefined;
const listeners = new Set<() => void>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('careeros-auth') : null;

function publish(next: Snapshot, token: string | null = null, expiry = 0) {
  snapshot = next;
  accessToken = token;
  expiresAt = expiry;
  listeners.forEach(listener => listener());
}
function signedIn(result: LoginResult) {
  publish({ state: 'authenticated', user: result.user }, result.accessToken, Date.parse(result.expiresAt));
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useSession() { return useSyncExternalStore(subscribe, () => snapshot); }

export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function request(path: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options, credentials: 'same-origin', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', 'X-CareerOS-Client': 'web', ...options.headers },
    });
  } catch { throw new RequestError(0, 'Cannot reach CareerOS. Please try again.'); }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new RequestError(response.status, body?.error?.message ?? 'The request failed. Please try again.');
  }
  return response.status === 204 ? null : response.json();
}
// Single-tab requests share a promise; Web Locks also serialize cookie rotation across tabs.
async function sessionLock<T>(work: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('careeros-session', work) : work();
}
export function refreshSession(): Promise<void> {
  pendingRefresh ??= sessionLock(async () => {
    try { signedIn(await request('/auth/refresh', { method: 'POST', body: '{}' })); }
    catch (error) {
      if (error instanceof RequestError && error.status === 401) publish({ state: 'anonymous', user: null });
      else { publish({ state: 'unavailable', user: null }); throw error; }
    }
  }).finally(() => { pendingRefresh = undefined; });
  return pendingRefresh;
}
export function initializeSession() {
  bootstrap ??= refreshSession().catch(() => { /* The snapshot shows a retry screen. */ });
  return bootstrap;
}
export async function signIn(mode: 'login' | 'register', fields: { email: string; password: string; name?: string }) {
  await sessionLock(async () => {
    const result: LoginResult = await request(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(fields) });
    signedIn(result);
    channel?.postMessage('signed-in');
  });
}
export async function signOut() {
  await sessionLock(async () => {
    await request('/auth/logout', { method: 'POST', body: '{}' });
    publish({ state: 'anonymous', user: null });
    channel?.postMessage('signed-out');
  });
}
export async function authenticatedRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!accessToken || expiresAt <= Date.now() + 30_000) await refreshSession();
  if (!accessToken) throw new RequestError(401, 'Please sign in again.');
  const attemptedToken = accessToken;
  try {
    return await request(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${attemptedToken}` } });
  } catch (error) {
    if (!(error instanceof RequestError) || error.status !== 401) throw error;
    if (accessToken === attemptedToken) await refreshSession();
    if (!accessToken) throw new RequestError(401, 'Please sign in again.');
    try {
      return await request(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken}` } });
    } catch (retryError) {
      if (retryError instanceof RequestError && retryError.status === 401) publish({ state: 'anonymous', user: null });
      throw retryError;
    }
  }
}
if (channel) channel.onmessage = event => {
  if (event.data === 'signed-out') publish({ state: 'anonymous', user: null });
  if (event.data === 'signed-in') void refreshSession().catch(() => {});
};

export async function getCurrentUser(): Promise<User> {
  return (await authenticatedRequest<{ user: User }>('/users/me')).user;
}

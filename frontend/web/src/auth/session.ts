import { useSyncExternalStore } from 'react';

export type User = { id: string; name: string; email: string; roles: ('USER' | 'ADMIN')[];
  username: string | null; hasPassword: boolean; oauthProvider: 'google' | 'github' | null; passwordPromptPending: boolean };
export type RememberedAccount = Pick<User, 'id' | 'name' | 'email' | 'oauthProvider' | 'hasPassword'>;
const rememberedKey = 'careeros_last_account';
export function rememberedAccount(): RememberedAccount | null {
  try {
    const account = JSON.parse(localStorage.getItem(rememberedKey) ?? 'null');
    if (!account || typeof account.id !== 'string' || account.id.length > 100
      || typeof account.name !== 'string' || account.name.length > 100
      || typeof account.email !== 'string' || account.email.length > 254
      || typeof account.hasPassword !== 'boolean' || ![null, 'github', 'google'].includes(account.oauthProvider)) return null;
    return { id: account.id, name: account.name, email: account.email, hasPassword: account.hasPassword, oauthProvider: account.oauthProvider };
  } catch { return null; }
}
function rememberAccount(user: User) {
  try { localStorage.setItem(rememberedKey, JSON.stringify({ id: user.id, name: user.name, email: user.email,
    hasPassword: user.hasPassword, oauthProvider: user.oauthProvider })); }
  catch { /* Browser storage is optional; it never authorizes a session. */ }
}
export function forgetAccount() {
  try { localStorage.removeItem(rememberedKey); } catch { /* Storage may be unavailable. */ }
}
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
  rememberAccount(result.user);
  publish({ state: 'authenticated', user: result.user }, result.accessToken, Date.parse(result.expiresAt));
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useSession() { return useSyncExternalStore(subscribe, () => snapshot); }

export class RequestError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
async function request(path: string, options: RequestInit = {}, binary = false) {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options, credentials: 'same-origin', signal: options.signal ?? AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', 'X-CareerOS-Client': 'web', ...options.headers },
    });
  } catch { throw new RequestError(0, 'Cannot reach CareerOS. Please try again.'); }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new RequestError(response.status, body?.error?.message ?? 'The request failed. Please try again.', body?.error?.code);
  }
  return binary ? response.blob() : response.status === 204 ? null : response.json();
}
// Single-tab requests share a promise; Web Locks serialize restoration and rotation across tabs.
async function sessionLock<T>(work: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('careeros-session', work) : work();
}
function loadSession(rotate: boolean): Promise<void> {
  pendingRefresh ??= sessionLock(async () => {
    try { signedIn(await request(rotate ? '/auth/refresh' : '/auth/restore', { method: 'POST', body: '{}' })); }
    catch (error) {
      if (error instanceof RequestError && error.status === 401) publish({ state: 'anonymous', user: null });
      else { publish({ state: 'unavailable', user: null }); throw error; }
    }
  }).finally(() => { pendingRefresh = undefined; });
  return pendingRefresh;
}
export function refreshSession() { return loadSession(true); }
export function restoreSession() { return loadSession(false); }
export function initializeSession() {
  bootstrap ??= restoreSession().catch(() => { /* The snapshot shows a retry screen. */ });
  return bootstrap;
}
export async function signIn(mode: 'login' | 'register', fields: { identifier: string; password: string; name?: string }) {
  await sessionLock(async () => {
    const body = mode === 'register' ? { email: fields.identifier, password: fields.password, name: fields.name }
      : { identifier: fields.identifier, password: fields.password };
    const result: LoginResult = await request(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
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
export async function authenticatedRequest<T>(path: string, options: RequestInit = {}, binary = false): Promise<T> {
  if (!accessToken || expiresAt <= Date.now() + 30_000) await refreshSession();
  if (!accessToken) throw new RequestError(401, 'Please sign in again.');
  const attemptedToken = accessToken;
  try {
    return await request(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${attemptedToken}` } }, binary);
  } catch (error) {
    if (!(error instanceof RequestError) || error.status !== 401) throw error;
    if (accessToken === attemptedToken) await refreshSession();
    if (!accessToken) throw new RequestError(401, 'Please sign in again.');
    try {
      return await request(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken}` } }, binary);
    } catch (retryError) {
      if (retryError instanceof RequestError && retryError.status === 401) publish({ state: 'anonymous', user: null });
      throw retryError;
    }
  }
}
if (channel) channel.onmessage = event => {
  if (event.data === 'signed-out') publish({ state: 'anonymous', user: null });
  if (event.data === 'signed-in') void restoreSession().catch(() => {});
};

export async function getCurrentUser(): Promise<User> {
  return (await authenticatedRequest<{ user: User }>('/users/me')).user;
}

async function updateAccount(path: string, body: unknown) {
  const { user } = await authenticatedRequest<{ user: User }>(path, { method: 'POST', body: JSON.stringify(body) });
  if (snapshot.state === 'authenticated' && snapshot.user?.id === user.id) {
    rememberAccount(user);
    publish({ ...snapshot, user }, accessToken, expiresAt);
    channel?.postMessage('signed-in');
  }
}
export function addPassword(password: string) { return updateAccount('/auth/password', { password }); }
export function dismissPasswordPrompt() { return updateAccount('/auth/password-prompt/dismiss', {}); }
export function setUsername(username: string) { return updateAccount('/auth/username', { username }); }

export async function startProviderSignIn(id: 'google' | 'github', selectAccount = false) {
  const { providers } = await request('/auth/providers');
  const provider = (providers as { id: string; url: string }[]).find(value => value.id === id);
  if (!provider) throw new Error('This sign-in provider is not available.');
  const url = new URL(provider.url);
  if (selectAccount) {
    url.searchParams.set('select_account', 'true');
    await signOut();
  }
  window.location.assign(url.href);
}

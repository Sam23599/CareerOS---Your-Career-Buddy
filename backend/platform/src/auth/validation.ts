import { ApiError } from '../errors.js';

const usernamePattern = /^[a-z0-9_]{3,30}$/;
export function usernameInput(body: unknown): string {
  const invalid = () => new ApiError(400, 'INVALID_INPUT', 'Use 3–30 letters, numbers or underscores, or leave the username empty.');
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid();
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some(key => key !== 'username') || typeof fields.username !== 'string') throw invalid();
  const username = fields.username.trim().toLowerCase();
  if (username && !usernamePattern.test(username)) throw invalid();
  return username;
}

export function loginCredentials(body: unknown) {
  const invalid = () => new ApiError(400, 'INVALID_INPUT', 'Enter your email or username and password.');
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid();
  const fields = body as Record<string, unknown>;
  const identifier = fields.identifier ?? fields.email;
  if (Object.keys(fields).some(key => !['identifier', 'email', 'password'].includes(key))
    || ('identifier' in fields) === ('email' in fields)
    || typeof identifier !== 'string' || typeof fields.password !== 'string') throw invalid();
  const normalized = identifier.trim().toLowerCase();
  if (normalized.length > 254 || (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && !usernamePattern.test(normalized))
    || fields.password.length < 1 || fields.password.length > 128) throw invalid();
  return { identifier: normalized, password: fields.password };
}

export function newPassword(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)
    || Object.keys(body).some(key => key !== 'password')
    || typeof (body as Record<string, unknown>).password !== 'string') {
    throw new ApiError(400, 'INVALID_INPUT', 'Enter a password of 12–128 characters.');
  }
  const password = (body as { password: string }).password;
  if (password.length < 12 || password.length > 128) throw new ApiError(400, 'INVALID_INPUT', 'Enter a password of 12–128 characters.');
  return password;
}

export function credentials(body: unknown, registering: boolean) {
  const invalid = () => new ApiError(400, 'INVALID_INPUT', registering
    ? 'Enter a name (1–100 characters), a valid email, and a password of 12–128 characters.'
    : 'Enter a valid email and password.');
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid();
  const fields = body as Record<string, unknown>;
  const allowed = registering ? ['name', 'email', 'password'] : ['email', 'password'];
  if (Object.keys(fields).some(key => !allowed.includes(key))) throw invalid();
  if (typeof fields.email !== 'string' || typeof fields.password !== 'string') throw invalid();
  const email = fields.email.trim().toLowerCase();
  const password = fields.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || password.length < (registering ? 12 : 1) || password.length > 128) throw invalid();
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  if (registering && (name.length < 1 || name.length > 100)) throw invalid();
  return { email, password, name };
}

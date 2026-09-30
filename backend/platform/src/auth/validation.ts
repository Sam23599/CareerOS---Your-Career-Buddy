import { ApiError } from '../errors.js';

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

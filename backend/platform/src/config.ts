import { type OAuthSettings } from './auth/oauth-providers.js';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }
  const mongoUri = env.MONGODB_URI;
  if (!mongoUri || !/^mongodb(?:\+srv)?:\/\//.test(mongoUri)) {
    throw new Error('MONGODB_URI must be a MongoDB connection string. See .env.example.');
  }
  const authSecret = env.AUTH_SECRET ?? '';
  if (!/^[a-f0-9]{64,}$/i.test(authSecret) || authSecret.length % 2 !== 0) {
    throw new Error('AUTH_SECRET must contain at least 32 random bytes in hex. Run npm run setup.');
  }
  const secureCookie = env.AUTH_COOKIE_SECURE === 'true';
  if (env.AUTH_COOKIE_SECURE && !['true', 'false'].includes(env.AUTH_COOKIE_SECURE)) {
    throw new Error('AUTH_COOKIE_SECURE must be true or false.');
  }
  const allowedOrigins = (env.AUTH_ALLOWED_ORIGINS
    || `http://localhost:${env.WEB_PORT ?? 5173},http://127.0.0.1:${env.WEB_PORT ?? 5173}`)
    .split(',').map(value => value.trim());
  if (allowedOrigins.some(value => {
    try { const url = new URL(value); return !['http:', 'https:'].includes(url.protocol) || url.origin !== value; }
    catch { return true; }
  })) throw new Error('AUTH_ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins without paths.');
  if (env.NODE_ENV === 'production' && (!secureCookie || allowedOrigins.some(value => !value.startsWith('https://')))) {
    throw new Error('Production authentication requires secure cookies and HTTPS origins.');
  }
  const publicOrigin = env.OAUTH_PUBLIC_ORIGIN || allowedOrigins[0];
  if (!allowedOrigins.includes(publicOrigin)) throw new Error('OAUTH_PUBLIC_ORIGIN must be one of AUTH_ALLOWED_ORIGINS.');
  const provider = (name: 'GOOGLE' | 'GITHUB') => {
    const clientId = env[`${name}_CLIENT_ID`];
    const clientSecret = env[`${name}_CLIENT_SECRET`];
    if (Boolean(clientId) !== Boolean(clientSecret)) throw new Error(`${name} requires both CLIENT_ID and CLIENT_SECRET.`);
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };
  const oauth: OAuthSettings = { publicOrigin, google: provider('GOOGLE'), github: provider('GITHUB') };
  return { oauth, port, host: env.API_HOST ?? '127.0.0.1', mongoUri, authSecret, allowedOrigins, secureCookie };
}

import * as oidc from 'openid-client';
import { ApiError } from '../errors.js';

export type ProviderId = 'google' | 'github';
export type OAuthIdentity = { provider: ProviderId; subject: string; email: string; name: string };
export type OAuthAttempt = { state: string; nonce: string; verifier: string };
export type OAuthProvider = {
  id: ProviderId; name: string;
  authorizationUrl(attempt: OAuthAttempt, selectAccount?: boolean): Promise<URL>;
  exchange(url: URL, attempt: OAuthAttempt): Promise<OAuthIdentity>;
};
export type OAuthSettings = {
  publicOrigin: string;
  google?: { clientId: string; clientSecret: string };
  github?: { clientId: string; clientSecret: string };
};
function identity(provider: ProviderId, subject: unknown, email: unknown, name: unknown): OAuthIdentity {
  if (typeof subject !== 'string' || !subject || typeof email !== 'string'
    || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(401, 'OAUTH_IDENTITY_INVALID', 'The provider did not return a verified identity.');
  }
  return { provider, subject, email: email.trim().toLowerCase(), name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : 'CareerOS user' };
}
export function googleIdentity(claims: Record<string, unknown>): OAuthIdentity {
  if (claims.email_verified !== true) throw new ApiError(401, 'OAUTH_EMAIL_UNVERIFIED', 'A verified email is required.');
  return identity('google', claims.sub, claims.email, claims.name);
}
export function githubIdentity(profile: Record<string, unknown>, emails: unknown): OAuthIdentity {
  if (!Array.isArray(emails) || !Number.isSafeInteger(profile.id) || (profile.id as number) < 1) {
    throw new ApiError(401, 'OAUTH_IDENTITY_INVALID', 'The provider did not return a verified identity.');
  }
  const primary = emails.find(item => typeof item === 'object' && item !== null && item.primary === true && item.verified === true);
  return identity('github', String(profile.id), primary?.email, profile.name ?? profile.login);
}

export function createOAuthProviders(settings: OAuthSettings): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (settings.google) {
    const config = new oidc.Configuration({
      issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token', jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    }, settings.google.clientId, settings.google.clientSecret);
    config.timeout = 8;
    oidc.enableNonRepudiationChecks(config);
    const redirect = `${settings.publicOrigin}/api/v1/auth/oauth/google/callback`;
    providers.push({
      id: 'google', name: 'Google',
      async authorizationUrl(attempt, selectAccount) {
        return oidc.buildAuthorizationUrl(config, {
          redirect_uri: redirect, scope: 'openid email profile', state: attempt.state, nonce: attempt.nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(attempt.verifier), code_challenge_method: 'S256',
          ...(selectAccount ? { prompt: 'select_account' } : {}),
        });
      },
      async exchange(url, attempt) {
        const tokens = await oidc.authorizationCodeGrant(config, url, {
          pkceCodeVerifier: attempt.verifier, expectedState: attempt.state, expectedNonce: attempt.nonce, idTokenExpected: true,
        });
        return googleIdentity(tokens.claims()!);
      },
    });
  }
  if (settings.github) {
    const config = new oidc.Configuration({
      issuer: 'https://github.com/login/oauth', authorization_endpoint: 'https://github.com/login/oauth/authorize',
      token_endpoint: 'https://github.com/login/oauth/access_token',
    }, settings.github.clientId, settings.github.clientSecret);
    config.timeout = 8;
    const redirect = `${settings.publicOrigin}/api/v1/auth/oauth/github/callback`;
    providers.push({
      id: 'github', name: 'GitHub',
      async authorizationUrl(attempt, selectAccount) {
        return oidc.buildAuthorizationUrl(config, {
          redirect_uri: redirect, scope: 'read:user user:email', state: attempt.state,
          code_challenge: await oidc.calculatePKCECodeChallenge(attempt.verifier), code_challenge_method: 'S256',
          ...(selectAccount ? { prompt: 'select_account' } : {}),
        });
      },
      async exchange(url, attempt) {
        const tokens = await oidc.authorizationCodeGrant(config, url, { pkceCodeVerifier: attempt.verifier, expectedState: attempt.state });
        async function resource(path: string) {
          const response = await oidc.fetchProtectedResource(config, tokens.access_token, new URL(`https://api.github.com${path}`), 'GET', undefined, new Headers({ Accept: 'application/vnd.github+json' }));
          if (!response.ok) throw new ApiError(502, 'OAUTH_PROVIDER_UNAVAILABLE', 'GitHub sign-in is temporarily unavailable.');
          return response.json();
        }
        const [profile, emails] = await Promise.all([resource('/user'), resource('/user/emails')]);
        return githubIdentity(profile, emails);
      },
    });
  }
  return providers;
}

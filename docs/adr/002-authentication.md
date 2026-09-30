# ADR-002 — JWT sessions and OAuth sign-in

Status: Accepted. Date: 2026-09-30.

## Context

The authentication milestone covers registration, login, refresh, logout, protected routes, and USER/ADMIN authorization. The user also requested JWT authentication with both Google and GitHub OAuth sign-in. All sign-in methods must produce the same CareerOS session.

## Decision

- Password sign-in and OAuth sign-in both issue a 15-minute CareerOS access JWT and a session lasting at most seven days. `jose` signs and validates tokens with explicit HS256, issuer, audience, expiry, and token-purpose checks. Access and refresh tokens cannot substitute for each other.
- Access tokens exist only in browser memory. A signed refresh token is stored in an HttpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`. Secure cookies and HTTPS origins are mandatory under `NODE_ENV=production`; HTTP is allowed for local development.
- MongoDB stores a hash of the current refresh token, never its raw value. Rotation atomically replaces that hash. Reusing a valid, already-rotated refresh token revokes the entire session. The original seven-day expiry never extends.
- Protected APIs check the JWT and the current MongoDB session/user. Logout immediately invalidates existing access tokens for that session. Roles come from the current user record, so demotions take effect immediately. USER is the only public-registration default; there is no public role-assignment endpoint.
- Email identifiers are trimmed and lowercased, with a unique database index. Passwords are not trimmed. New passwords require 12–128 characters and use salted Node scrypt with N=131072, r=8, p=1. Unknown-user logins perform the same expensive password calculation and return the same error as an incorrect password.
- Cookie-authenticated POST endpoints require an allowlisted Origin, JSON content type, and a custom header. No cross-origin CORS access is enabled. Apply process-local throttling to registration, login, refresh, and OAuth starts/callbacks. These limits are for the single-process foundation; a shared store and explicit proxy policy are needed before scaling.
- Google uses OpenID Connect through `openid-client`, including ID-token signature, issuer, audience, expiry, nonce, and verified-email checks. GitHub uses OAuth authorization-code exchange followed by `/user` and `/user/emails`; it requires a verified primary email and uses GitHub's immutable numeric user ID.
- Both providers use S256 PKCE, random state, and a ten-minute, browser-bound attempt stored in MongoDB. Callback state is atomically consumed once. A separate HttpOnly SameSite=Lax cookie allows the cross-site callback. Redirects use one configured public frontend origin, never a caller-supplied return URL.
- Successful OAuth callbacks set the CareerOS refresh cookie and redirect to the dashboard. Provider access tokens remain server-side only for the identity lookup and are not stored. No tokens are placed in redirect URLs.
- Provider identities are stored as `users.oauth.{provider,subject}` with a unique partial index. OAuth-only users have no password hash. Do not silently link accounts using matching emails. Users with a conflicting email must use the original sign-in method; authenticated account linking is a later feature.
- Google and GitHub buttons are always visible. They are disabled with an availability message until the matching ID/secret pair is configured. Credentials remain in ignored environment configuration. `npm run setup` creates a random signing secret without replacing existing settings.

## Consequences and scope

MongoDB availability is required for protected access; failure is closed. Single-flight refresh plus browser Web Locks serializes refresh across tabs, and BroadcastChannel synchronizes sign-in/logout. Browsers without Web Locks can encounter a rejected session if refreshes race; they must sign in again.

Email verification, password recovery/change, MFA, account linking, session-management screens, and administrator provisioning are not included in this batch. Local password registration does not claim that an email is verified. The identity-provider flow is implemented, but real Google/GitHub consent and token exchanges require locally configured app credentials.

## References

- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)

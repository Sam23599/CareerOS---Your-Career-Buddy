# Authentication API

Base path: `/api/v1`. Errors use the [standard error envelope](health.md).

| Method and path | Input | Result |
| --- | --- | --- |
| `POST /auth/register` | `{ "name", "email", "password" }` | 201, session response and refresh cookie |
| `POST /auth/login` | `{ "identifier", "password" }`; identifier is email or username (legacy `email` field also accepted) | 200, session response and refresh cookie |
| `POST /auth/restore` | `{}` plus current refresh cookie | 200, new access token without changing the refresh cookie |
| `POST /auth/refresh` | `{}` plus refresh cookie | 200, new access token and rotated refresh cookie |
| `POST /auth/logout` | `{}` plus refresh cookie | 204, session revoked and cookie cleared |
| `POST /auth/password` | `{ "password" }` and Bearer access token from a recent sign-in | 200, updated public user; add a password once to an OAuth account |
| `POST /auth/password-prompt/dismiss` | `{}` and Bearer access token | 200, updated public user; persist dismissal of the signup suggestion |
| `POST /auth/username` | `{ "username" }` and Bearer access token | 200, updated public user; set/change optional username, or remove with an empty string |
| `GET /users/me` | `Authorization: Bearer <accessToken>` | 200, `{ "user": { "id", "name", "email", "username", "roles", "hasPassword", "oauthProvider", "passwordPromptPending" } }` |
| `GET /auth/providers` | None | Configured providers with name, ID, and canonical start URL |
| `GET /auth/oauth/google/start` | Browser navigation | Redirect to Google |
| `GET /auth/oauth/github/start` | Browser navigation | Redirect to GitHub |
| `GET /auth/oauth/:provider/callback` | Provider code/state and binding cookie | Set session cookie; redirect to dashboard, or login with a safe error code |

The session response contains `user`, `accessToken`, and ISO `expiresAt`. It never contains the refresh token or password hash in JSON. Access expires after 15 minutes; sessions expire after seven days. Logout affects the current session only.

## Optional password, username and remembered account

New OAuth signups see one optional dashboard suggestion to add a CareerOS password. Skip/Escape saves dismissal in MongoDB. A returning OAuth login also clears any outstanding signup suggestion; existing accounts are not prompted retroactively. The profile's Password section always offers setup for accounts without a password, with an info button explaining direct email/password login.

Password enrollment requires a valid Bearer token and a session created within the last 15 minutes; restoration/refresh do not reset that window. An older session gets `403 REAUTH_REQUIRED` and the UI offers provider confirmation. Users then return to their profile to set the password. Enrollment accepts only `password` (12–128 characters), stores the same salted scrypt hash used by registration, and atomically refuses overwrites with `409 PASSWORD_ALREADY_SET`. Both password and provider sign-in continue to access the same user ID and data. Changing/recovering an existing password and linking separate accounts remain deferred.

The profile also offers an optional CareerOS username: 3–30 letters, numbers or underscores, normalized to lowercase and protected by a unique partial MongoDB index. This is chosen by the user, independently of GitHub's handle. Empty input removes it. A taken username returns `409 USERNAME_IN_USE`. The login form accepts either email or username with the same password; no account is created or linked by adding a username. Failed credentials always return the same generic message, whether the email/username is unknown or the password is incorrect.

The login page shows “Continue as…” with an initials avatar. A valid CareerOS browser session opens the dashboard directly. After sign-out or expiry, the card requires a password or another provider sign-in. `careeros_last_account` in localStorage contains only the last account's ID, name, email, provider and password-availability flag; it never contains tokens, passwords or provider subjects and cannot authorize access. “Forget this account” removes those display details. Unavailable browser storage does not block ordinary sign-in.

“Sign in with another GitHub account” first revokes the current CareerOS session and then opens the canonical provider start URL with `select_account=true`. The server sets `prompt=select_account` on the authorization URL, as supported by [GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#web-application-flow). The same selection option is supported for Google. Cancellation leaves CareerOS signed out; the account card remains display information only.

All auth POST requests require `Origin` matching `AUTH_ALLOWED_ORIGINS`, `Content-Type: application/json`, and `X-CareerOS-Client: web`. Browser fetches supply Origin automatically. GET `/users/me` uses only the Bearer token; cookies alone never authorize it.

Status codes: 400 invalid input, 401 invalid credentials/session, 403 origin/permission failure, 409 email already used, 415 incorrect content type, 429 throttled, and 503 unavailable database. Registration rejects extra fields such as `roles`. Login errors do not distinguish an unknown email from an incorrect password.

Page loads, session-check retries and cross-tab sign-in use `/auth/restore`. It validates the current stored token hash and issues an access JWT without rotating or extending the refresh cookie, so interrupted navigation can retry safely. `/auth/refresh` still rotates when an access token expires or a protected API returns 401. Presenting an already-rotated token to either endpoint revokes its session. Restoration and refresh requests are serialized across browser tabs. Database TTL indexes clean up expired sessions/attempts; every operation checks expiry directly instead of relying on asynchronous TTL cleanup.

## Google and GitHub setup

Keep credentials in the root `.env`; do not put them in `VITE_*` variables. Set:

```dotenv
OAUTH_PUBLIC_ORIGIN=http://localhost:5173
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

Use a Google OAuth client of type **Web application**, configure the consent screen/test users, and register this exact authorized redirect URI:

```text
http://localhost:5173/api/v1/auth/oauth/google/callback
```

Create a GitHub **OAuth App** with homepage `http://localhost:5173` and authorization callback:

```text
http://localhost:5173/api/v1/auth/oauth/github/callback
```

Change the origin in all three places together when using another port or HTTPS. `OAUTH_PUBLIC_ORIGIN` must be in the allowed frontend origins. The frontend proxy forwards callbacks to Express. Always start provider login through the returned canonical URL, so its binding cookie and callback share a host.

Recreate the API after changing credentials:

```bash
docker compose up -d --force-recreate api
```

Google requests `openid email profile`; GitHub requests `read:user user:email`. A provider with blank credentials stays visible as a disabled button with an availability message. Configured providers become clickable automatically. Supplying only an ID or only a secret fails configuration validation.

GitHub callback issuer validation uses `https://github.com/login/oauth`, as [documented by GitHub](https://docs.github.com/en/apps/github-authentication-discovery-endpoints). A callback containing `iss` must match that value; foreign issuers are rejected. Do not remove issuer validation to work around a generic callback error.

Successful provider sign-in creates a USER account or finds the existing immutable provider identity. Matching an existing account's email alone does not link it. On a conflict the UI directs the user to their original sign-in method.

### GitHub-first local verification

GitHub credentials are configured and live sign-in, logout and returning-account sign-in were verified on 2026-10-02 after correcting the callback issuer. The user confirmed the dashboard shows their GitHub identity, and the account/session records confirm stable identity and logout revocation. Actual consent cancellation and a live email-conflict scenario remain unexercised; component/backend tests cover these and other safeguards with mocked provider responses. Google verification is deferred by the user's decision.

1. In [GitHub developer settings](https://github.com/settings/developers), choose **OAuth Apps → New OAuth App** ([GitHub's setup guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)). Use **CareerOS Local** as the name, `http://localhost:5173` as the homepage and `http://localhost:5173/api/v1/auth/oauth/github/callback` as the callback. Device Flow is not needed.
2. Generate a client secret, then set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `OAUTH_PUBLIC_ORIGIN=http://localhost:5173` in the root `.env`. Leave Google credentials blank. Keep the secret out of chat and Git.
3. Recreate the API using the command above. Open `http://localhost:5173/login` consistently; the GitHub link becomes active while Google remains disabled.
4. Choose **Continue with GitHub**, grant consent and confirm the dashboard shows the expected GitHub identity. Reload, open a second tab, then sign out and sign in again; the same CareerOS account should return.
5. In a signed-out browser, start again and cancel consent; it must return to login without creating a session. GitHub may skip consent for an already-authorized app; revoke that app under GitHub **Settings → Applications → Authorized OAuth Apps** before testing cancellation again.
6. If your GitHub email already belongs to an email/password account, expect the original-sign-in-method message. This is the intended conflict behavior. Use a separate verified GitHub test identity for a successful new-account check; account linking remains deferred.

Record live results in the [release report](../phase-1-release-verification.md). A bad or missing callback state must return a safe login error; automated tests cover provider exchange errors that cannot be reliably triggered through consent UI. Do not mark live consent verified from mocks alone.

If a callback returns `?oauth=failed`, the API emits `oauth_sign_in_failed` with the provider, failed step (`binding`, `state`, `exchange` or `session`), a safe application code and request ID. It does not log cookies, state values, authorization codes, provider tokens or raw provider errors. Inspect it with `docker compose logs --since 5m api`; start a fresh sign-in attempt rather than reusing a consumed callback.

See [ADR-002](../adr/002-authentication.md) for the security model and deliberate exclusions.

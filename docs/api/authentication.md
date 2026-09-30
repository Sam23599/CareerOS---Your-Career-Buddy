# Authentication API

Base path: `/api/v1`. Errors use the [standard error envelope](health.md).

| Method and path | Input | Result |
| --- | --- | --- |
| `POST /auth/register` | `{ "name", "email", "password" }` | 201, session response and refresh cookie |
| `POST /auth/login` | `{ "email", "password" }` | 200, session response and refresh cookie |
| `POST /auth/refresh` | `{}` plus refresh cookie | 200, new access token and rotated refresh cookie |
| `POST /auth/logout` | `{}` plus refresh cookie | 204, session revoked and cookie cleared |
| `GET /users/me` | `Authorization: Bearer <accessToken>` | 200, `{ "user": { "id", "name", "email", "roles" } }` |
| `GET /auth/providers` | None | Configured providers with name, ID, and canonical start URL |
| `GET /auth/oauth/google/start` | Browser navigation | Redirect to Google |
| `GET /auth/oauth/github/start` | Browser navigation | Redirect to GitHub |
| `GET /auth/oauth/:provider/callback` | Provider code/state and binding cookie | Set session cookie; redirect to dashboard, or login with a safe error code |

The session response contains `user`, `accessToken`, and ISO `expiresAt`. It never contains the refresh token or password hash in JSON. Access expires after 15 minutes; sessions expire after seven days. Logout affects the current session only.

All auth POST requests require `Origin` matching `AUTH_ALLOWED_ORIGINS`, `Content-Type: application/json`, and `X-CareerOS-Client: web`. Browser fetches supply Origin automatically. GET `/users/me` uses only the Bearer token; cookies alone never authorize it.

Status codes: 400 invalid input, 401 invalid credentials/session, 403 origin/permission failure, 409 email already used, 415 incorrect content type, 429 throttled, and 503 unavailable database. Registration rejects extra fields such as `roles`. Login errors do not distinguish an unknown email from an incorrect password.

A reused refresh token revokes its session. Refresh requests must be serialized, including across browser tabs. Database TTL indexes clean up expired sessions/attempts; every operation checks expiry directly instead of relying on asynchronous TTL cleanup.

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

Successful provider sign-in creates a USER account or finds the existing immutable provider identity. Matching an existing account's email alone does not link it. On a conflict the UI directs the user to their original sign-in method.

See [ADR-002](../adr/002-authentication.md) for the security model and deliberate exclusions.

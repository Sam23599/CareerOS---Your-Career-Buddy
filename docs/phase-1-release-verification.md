# Phase 1 release verification

Verified: 2026-10-02, Asia/Kolkata.

**Result:** The agreed local core workflow and follow-up hardening are verified. Findings F-001 (interrupted restoration) and F-002 (GitHub issuer mismatch) are resolved, and standalone component tests are implemented. Live GitHub sign-in, logout and returning-account sign-in are verified. Google consent verification is deferred by the user's decision.

## Candidate and environment

- Verified the current candidate based on commit `7b1c2d1`, including staged source registry, Google Careers, bookmarks and inline filter changes, plus the new combined journey test.
- Used a clean copy of candidate files with no existing `.env`, `node_modules`, generated builds or database. This checks the uncommitted candidate rather than claiming to test a published Git checkout.
- Built and started a separate Compose project with fresh MongoDB/resume volumes and host ports 5273/3101/27119. The user's existing stack and data stayed available.
- Application and test runtime: Node 24.21.0; container npm 11.19.0; MongoDB 7.0.43; Chromium browser. The host's default Node 25 was not used for the release tests.
- Setup generated a private `.env` with mode `0600`; rerunning it preserved the full configuration and signing secret. A fresh `npm ci`, followed immediately by both builds, passed in a disposable Node 24 container.
- The authentication/component follow-up uses commit `00fce84` plus the current hardening changes. It was checked with host Node 24.21.0, a separate application database and temporary frontend/API ports 5274/3102. The original clean Docker, outage and persistence results below remain the initial verification evidence.

## Checks run

| Check | Result |
| --- | --- |
| ESLint | Passed |
| TypeScript checks, both workspaces | Passed |
| Web and API production builds | Passed, including after a fresh lockfile install |
| Unit/API tests | 35 passed; none skipped |
| MongoDB integration tests | 47 passed in the hardening follow-up; none skipped; temporary suite databases removed |
| Chromium browser journeys | All 11 passed in the hardening follow-up, including interrupted reload/navigation |
| Standalone component tests | 10 passed in Chromium; no API, database or provider credentials needed |
| Production dependency audit | `npm audit --omit=dev` reported 0 known vulnerabilities at verification time |
| Frontend/API connectivity | Direct readiness and Vite-proxied readiness returned 200; request ID and no-store headers present |
| Database outage/recovery | Liveness stayed 200; readiness returned 503 while MongoDB was stopped and recovered after restart |
| Container recreation | Account/profile data, active resume metadata and exact downloaded PDF bytes, saved-job metadata, bookmarks and notification preferences survived `down`/`up` without deleting volumes |
| Real job import | Startup imported 16 Remotive listings; the successful import and stored listings remained after recreation. This is a feed snapshot, not a guaranteed count. |
| Basic mobile layout | Existing jobs/profile browser assertions and separate login/source-card checks passed at 390px width |
| OAuth availability UI | Both unconfigured provider buttons were visible and disabled |
| Documentation | All eight domain API documents exist; local file links resolve. Whitespace checks exclude the pre-existing staged notebook whitespace. |

## Workflow and access coverage

The new [combined browser journey](../frontend/web/e2e/phase1-release.spec.ts) uses one account to register, maintain its profile, upload a real PDF, set career preferences, search a fixture job through the real API, open and save it, edit notes/status/priority, sign out and back in, and verify persisted data after reload. It deletes its resume and cleans up its fixture job/saved entry.

The existing browser flows additionally cover conflicting edits, resume preview/download/delete, job search/detail errors, source detection, Google coverage labels, bookmarks and explicit tracking activation, optional check filters and inline filter saving, and notifications/preferences.

Integration checks cover JWT purpose/expiry, refresh rotation and replay revocation, logout, CSRF and throttling, USER/ADMIN enforcement, private ownership including ADMIN, stale revisions, concurrent saves/imports, source failure retention, literal filtering, complete/limited feed expiry rules, notification retries and scheduler behavior. Six private endpoints also returned 401 in the running isolated app; USER ingestion returned 403.

OAuth checks use mocked provider exchanges and callbacks, including PKCE, Google signature/nonce validation, verified provider identities, browser-bound one-time state, cancellation and email conflicts. They do not demonstrate live provider consent.

## Resolved finding: interrupted session restoration

**F-001 — Resolved on 2026-10-02.** The original immediate `page.goto('/saved-jobs')` followed by `page.reload()` interrupted session restoration. The API recorded a successful refresh followed by a 401 refresh, and the private view became unavailable.

The cause was confirmed by sending a refresh to the real API, discarding its replacement cookie and retrying with the unchanged browser cookie: the first response was 200 and the retry was 401. Page startup consumed the token before the browser received its replacement.

Page startup, session-check retries and cross-tab sign-in now use `POST /auth/restore`, which validates the current stored token hash and issues an access JWT without rotating the cookie or extending the seven-day expiry. Explicit refresh still rotates; presenting an already-rotated token to either endpoint still revokes the session. See [the session contract](api/authentication.md) and [ADR-002](adr/002-authentication.md).

The browser tests hold a successful server response without delivering it to the browser, then reload or navigate away. Both restore successfully and retain the same refresh cookie. Simultaneous-tab restoration, normal login/logout and access-token 401 recovery also pass. MongoDB tests verify repeatable restoration, expiry, logout, CSRF and genuine token replay. Lost delivery during an actual explicit rotation can still require sign-in; this fix addresses interrupted page restoration without adding a replay grace period.

The standalone component suite covers tag normalization/clearing, entry limits/removal/current-role dates, OAuth loading/configuration/errors, PDF preview dismissal/object-URL cleanup, and save/unsave/retry/anonymous states. The test-only gallery reuses existing Playwright and Vite packages and is excluded from the production application entry point.

## GitHub configuration and live handoff

Checked on 2026-10-02 after the user added credentials:

- Configuration validates with GitHub enabled, Google unconfigured and public origin `http://localhost:5173`. Only the API was recreated; API, web and MongoDB remain healthy.
- Chromium verified the enabled GitHub link, disabled Google button, real GitHub login page, exact callback URL, `read:user user:email` scopes, S256 PKCE and the scoped HttpOnly/SameSite=Lax binding cookie. This browser had no GitHub login session.
- A token-endpoint probe with a deliberately invalid authorization code returned `bad_verification_code`, rather than a client-credential error, and issued no token. This is configuration evidence, not successful account authorization; see [GitHub's error definitions](https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/troubleshooting-oauth-app-access-token-request-errors).
- A simulated `access_denied` callback returned the safe login error without a CareerOS session; replaying the callback was rejected. Actual consent cancellation still needs the user's browser.
- After the issuer correction below, the user confirmed the dashboard opens with the GitHub identity. Two real successful callbacks produced one stable GitHub USER account and two sessions: the earlier session was revoked by logout, and the returning session is active. Session restoration and `/users/me` returned 200. Provider tokens were not logged or persisted; refresh tokens are stored as hashes.
- Actual consent cancellation and an existing-account email conflict were not manually exercised against GitHub. They retain automated mock coverage and the simulated cancellation check above; see the [live checklist](api/authentication.md#github-first-local-verification).

**F-002 — Resolved on 2026-10-02.** The user reported `http://localhost:5173/login?oauth=failed`. A fresh attempt passed browser binding and saved-state checks, then failed at `exchange`. The configured issuer was `https://github.com`; [GitHub documents](https://docs.github.com/en/apps/github-authentication-discovery-endpoints) `https://github.com/login/oauth`. A regression callback carrying that documented `iss` reproduced `unexpected "iss" (issuer) response parameter value` before any token request. The issuer value is corrected without disabling validation, and the user's fresh sign-in now opens the dashboard.

The regression now accepts the documented issuer, rejects a foreign issuer before network access, and preserves compatibility with callbacks omitting `iss`. Inside the running API, an issuer-bearing probe reaches GitHub's real token endpoint; readiness is 200. All 35 unit/API tests, backend lint/type checks/build and 12 auth integration cases pass; the integration cases also prove diagnostics omit state, binding cookies and raw provider errors. Successful live account and returning-account sign-in are supported by the user confirmation, callback/current-user statuses and stored account/session records described above.

## Optional password, username and browser continuation follow-up

On 2026-10-02, added the optional first-OAuth-signup password suggestion, persistent dismissal, profile password setup/help, a user-chosen CareerOS username, and the remembered-account login card. Password login accepts either email or username for the same account. Automatic seven-day session restoration remains in place; a signed-out/expired remembered account must authenticate again. Provider switching revokes the old session before requesting account selection.

- All 37 unit/API tests and 16 authentication MongoDB integration cases passed. They cover recent-sign-in password enrollment, atomic overwrite prevention, username uniqueness/case normalization, matching account IDs for both login methods, and existing session/CSRF/replay safeguards.
- Five new Chromium UI cases passed with simulated provider/API responses, and five existing authentication/profile journeys passed against an isolated real API/database. These include first-signup skip/setup, remembered-account continuation/switching, mobile card width, real username/password login, reload/cross-tab restoration and profile editing. The profile view reveals username/password inputs only when setup is selected.
- Repository lint, both workspace type checks and production builds passed. Temporary test databases and servers were removed; the user's main stack/data were preserved.
- Live account-picker consent, a new real-provider signup/password enrollment, and Google sign-in were not manually reverified in this follow-up. Earlier confirmed GitHub sign-in/logout/returning-account results remain recorded above.

See the [updated authentication contract](api/authentication.md#optional-password-username-and-remembered-account) for endpoint inputs, password setup limits and remembered-display data.

## Remaining validation and scope boundaries

- Live GitHub account sign-in, logout and returning-account sign-in are verified. Actual consent cancellation and a live email-conflict scenario remain unexercised; automated tests cover these safeguards. Google live verification is deferred. See the [GitHub checklist](api/authentication.md#github-first-local-verification).
- The broader roadmap still includes unimplemented capabilities such as date/experience job filters, viewed-job markers, a standalone `/settings` page and authenticated professional-profile imports. This report covers the agreed core definition of done, not every item in the product vision. Current settings live in the profile and notifications pages; connected profiles are saved URLs.
- Google coverage is limited to its first 20 unfiltered public results; unsupported career pages remain bookmarks. See the [source contract](api/career-sources.md).
- Community remains in Phase 5, AI/Cady in Phase 2, application tracking in Phase 3 and production deployment in Phase 7. This is local release verification.

## Repeat the checks

Use Node 24 for host commands. Rebuild the development image first so it contains current test files:

```bash
npm run setup
docker compose up --build -d --wait
docker compose exec -T api npm run lint
docker compose exec -T api npm run typecheck
docker compose exec -T api npm test
docker compose exec -T -e TEST_MONGODB_URI=mongodb://mongodb:27017 api npm run test:integration
docker compose exec -T api npm run build
docker compose exec -T api npm audit --omit=dev
npm ci
npx playwright install chromium
npm run test:e2e
npm run test:components
```

Browser fixture tests use `MONGODB_URI` from `.env`; override `E2E_MONGODB_URI` and `E2E_BASE_URL` when checking another stack. Use a separate Compose project and fresh configuration for outage, recreation and cleanup checks, as in this verification. Browser accounts/profile data remain in the test database; the isolated verification volumes are removed after checking persistence.

API contracts: [health](api/health.md), [authentication](api/authentication.md), [profiles](api/profiles.md), [resumes](api/resumes.md), [jobs](api/jobs.md), [saved jobs](api/saved-jobs.md), [career sources](api/career-sources.md), [notifications](api/notifications.md).

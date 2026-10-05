# Local development

## Start everything in Docker

Prerequisite: Docker with Compose and a running Docker engine. Compose uses MongoDB 7.0; the kernel compatibility reason is recorded in [ADR-001](adr/001-local-platform-foundation.md#local-compatibility-finding). Run from the repository root:

```bash
npm run setup
docker compose up --build -d --wait
```

The setup script creates `.env` and a random JWT signing secret, preserving existing settings. It requires Node on the host but does not require `npm install`. Without host Node, run `docker run --rm --mount type=bind,src="$PWD",dst=/app -w /app node:24-alpine node scripts/setup-env.mjs` instead.

Open http://localhost:5173 to register or sign in. The connection diagnostic is at `/status`. Google/GitHub sign-in is optional; follow [provider setup](api/authentication.md#google-and-github-setup) to configure credentials.

Default host addresses:

| Service | Address |
| --- | --- |
| React | http://localhost:5173 |
| API liveness | http://localhost:3000/api/v1/health |
| API database readiness | http://localhost:3000/api/v1/ready |
| MongoDB | `mongodb://127.0.0.1:27017/careeros` |

If a port is occupied, change `WEB_PORT`, `API_PORT`, or `MONGO_PORT` in `.env`. Compose uses fixed internal ports, independent of these host ports.

```bash
docker compose logs -f api web
docker compose down
```

`down` keeps MongoDB data in the `mongodb_data` named volume. `docker compose down -v` deletes that data; use it only for an intentional reset.

Changes under either application's `src/` directory reload automatically. Rebuild after dependency, environment, or configuration changes. MongoDB has no local credentials; published services bind only to loopback. These containers are for development.

## Run Node applications on your host

Prerequisites: Node 24 (`nvm use` if using nvm), npm 11, and Docker. First create `.env` as above. Stop the Compose web/API services if they are already running, then:

```bash
docker compose stop web api
docker compose up -d --wait mongodb
npm ci
npm run dev
```

The backend loads the root `.env`; Vite loads the same configuration and proxies `/api` to the backend. If you change `MONGO_PORT`, update the port in `MONGODB_URI` too. Host Node applications bind to loopback by default.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Without a host Node installation, run those checks in the development image:

```bash
docker compose run --rm --no-deps api sh -c 'npm run lint && npm run typecheck && npm test && npm run build'
```

Unit/API tests cover health, validation, password hashing, JWT purpose/expiry, and OAuth provider validation with mocked provider HTTP responses. Run the database integration suite against a dedicated temporary database (created and deleted by the suite):

```bash
docker compose exec -T -e TEST_MONGODB_URI=mongodb://mongodb:27017 api npm run test:integration
```

For browser checks against the running local stack:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

Set `E2E_BASE_URL` if the frontend uses another address. Browser tests create accounts with random `e2e-...@example.com` addresses in the local application database and sign them out; they do not contact Google or GitHub.

For standalone component checks, use the same installed Chromium browser:

```bash
npm run test:components
```

This starts a test-only Vite gallery on port 5183 and exercises shared components in Chromium with mocked requests. No API, MongoDB or OAuth credentials are needed. The gallery is outside the application entry point and is not included in its production build. See [Playwright component testing](https://playwright.dev/docs/test-components). GitHub live setup/checks are in the [authentication guide](api/authentication.md#github-first-local-verification).

## Verify live connections and persistence

```bash
curl --fail http://localhost:5173/api/v1/ready
docker compose exec mongodb mongosh careeros --quiet --eval 'db.foundation_check.updateOne({_id:"persistence"}, {$set:{verified:true}}, {upsert:true})'
docker compose down
docker compose up -d --wait
docker compose exec mongodb mongosh careeros --quiet --eval 'if (!db.foundation_check.findOne({_id:"persistence", verified:true})) quit(1)'
docker compose exec mongodb mongosh careeros --quiet --eval 'db.foundation_check.deleteOne({_id:"persistence"})'
```

The commands above use the default web port; substitute your configured `WEB_PORT` if changed.

To check failure reporting, stop only this project's MongoDB with `docker compose stop mongodb`. `/api/v1/health` should remain 200, while `/api/v1/ready` should return 503. Click **Check again** on `/status` to see the unavailable database. Start it with `docker compose start mongodb`, wait for its health check, and check again to see recovery.

## Current scope

Private PDF text extraction is implemented as the first Phase 2 batch. **Extract text** on `/resumes` opens a transient page-text preview. See [Python service setup, limits and checks](intelligence-development.md). Structured drafts with reviewed profile import are implemented; see [draft setup](resume-drafts.md). Job-description analysis is implemented on job detail pages; see [local use and checks](job-description-analysis.md). OCR, matching and Cady remain planned.

Registration, JWT login/refresh/logout, protected dashboard/current-user API, USER/ADMIN middleware, and configurable Google/GitHub OAuth flows are implemented. Private career profiles are implemented at `/profile`, including skills, experience, education, certifications, preferences, and professional links. Resume management is implemented at `/resumes` with PDF uploads up to 5 MiB. Public job search/details and explicit Remotive imports are implemented; Cady remains future work. See the [profile API](api/profiles.md). See [the next steps](implementation-next-steps.md), [ADR-002](adr/002-authentication.md), and the [authentication API](api/authentication.md).

Private saved jobs, [career sources](api/career-sources.md), and [in-app notifications](api/notifications.md) are implemented. Watch Greenhouse boards and limited Google Careers results manually or every 4/12/24 hours while the API runs; other career URLs can be saved as separate bookmarks. No additional secrets or Docker services are needed. MongoDB persists `career_sources`, `notifications`, and `notification_preferences` in the existing database volume.

## Foundation verification (previous batch)

- Docker stack healthy with Node 24.21.0 and MongoDB 7.0.
- Lint, TypeScript checks, three API tests, and both builds passed inside the Node 24 image.
- Frontend HTML and transformed entry module served successfully; `/api/v1/ready` reached MongoDB through the Vite proxy.
- With MongoDB stopped, liveness stayed at 200 and readiness returned 503. Readiness recovered after MongoDB restarted, without an API restart.
- A temporary database record survived `docker compose down` and container recreation; the record was then deleted.
- Browser rendering was not automated in the foundation batch; authentication adds browser coverage.


## Authentication verification

- Lint, TypeScript checks, and application builds passed.
- Eleven unit/API tests passed, including password hashing, JWT validation, and real OAuth client exchanges against mocked Google/GitHub HTTP responses.
- Nine MongoDB integration tests passed against an isolated database, including role enforcement, duplicate registration, refresh replay revocation, logout, CSRF guards, and one-time OAuth callbacks.
- Two Chromium browser tests passed: registration/login, protected routing, session restoration, cross-tab logout, and automatic access-token refresh.
- The three local containers are healthy. Google/GitHub app credentials are not configured; live provider consent/token exchange has not been tested.


## Career profile verification

- Lint, TypeScript checks, and both application builds passed in the Node 24 image.
- All 16 unit/API tests and 13 MongoDB integration tests passed, including profile validation, owner-only access (also for ADMIN), partial updates, removals, and concurrent first-save/update conflicts.
- All three Chromium browser tests passed. Profile coverage includes the complete editor, persistence after reload, entry removal, and retaining an unsaved draft after a conflicting save.
- Docker Compose rebuilt successfully and all three services are healthy. Browser checks leave randomly named test accounts/profile data in the local application database; integration databases are deleted by the suite.


## Resume file storage

Docker stores uploaded bytes in `careeros_resume_data`, mounted at `/data/resumes` in the API container. MongoDB stores private version metadata in `resume_libraries`. Both volumes persist across ordinary container recreation. Host development can set `RESUME_STORAGE_DIR` (default `./data/resumes` relative to the API directory); uploaded files are ignored by Git and Docker builds. See [resume API and failure behavior](api/resumes.md).

## Resume management verification

- Lint, TypeScript checks, and both builds passed.
- All 16 unit/API tests and 19 MongoDB integration tests passed. Resume checks include invalid/oversized uploads, exact download bytes, owner isolation including ADMIN, version allocation under concurrent uploads, active selection, deletion, and retry after storage failure.
- All four Chromium browser tests passed, including upload, reload, active selection, authenticated download, and deletion through the resume page.
- Docker Compose rebuilt and all services became healthy with the persistent resume volume mounted. Integration files/databases are removed after tests; the resume browser test deletes its uploaded files.


## Job ingestion

Run `docker compose exec -T api npm run jobs:ingest -- remotive` once to populate live jobs, then open `/jobs`. The API automatically refreshes every four hours while running, checking persisted due times every minute and at startup. Manual imports share that cooldown. Demo data requires an explicit `fixture` import and is labeled separately. See [job API and source behavior](api/jobs.md).


## Jobs and ingestion verification

- Lint, TypeScript checks, both builds, and whitespace checks passed.
- All 20 unit/API tests and 24 MongoDB integration tests passed, including source normalization, invalid-feed rejection, stable upserts, source failure retention, literal search/filtering, expiry, pagination, ADMIN-only ingestion, and database-backed cooldown.
- Existing four browser flows and both new jobs flows passed. The retry simulation was corrected to remain unavailable until Retry, because development StrictMode can issue an aborted initial fetch.
- A real Remotive import saved 16 listings on 2026-10-01. A separate Chromium check opened the live job list and one real detail page with its source link. This count is a verification snapshot, not a guaranteed feed size.
- Job search uses cached MongoDB records; visits do not call the external provider. No fixture jobs were added to the application database.


## Scheduled refresh and resume preview verification

- Lint, type checks, both builds, and whitespace checks passed.
- All 23 unit/API tests and 25 MongoDB integration tests passed, including four-hour scheduling with a simulated clock, persisted cooldowns, migration from six-hour intervals, non-overlapping runs, and shutdown behavior.
- The resume browser flow covers the authenticated in-page preview, Close/Escape, preview fetch errors, and existing upload/download/delete behavior. Preview object URLs are released on close/unmount.
- Scheduled refresh runs inside the API process. When the computer/API is stopped it cannot fetch; overdue imports are checked when the API starts again. Source feeds still retain their own publication delay.


## Saved jobs

Save a listing from `/jobs` or its detail page after signing in, then manage notes, interest status, and priority at `/saved-jobs`. Saved data is private per account. See the [API contract](api/saved-jobs.md).

The saved-job browser test temporarily inserts a uniquely identified fixture job into the local application's database and removes that record and its saved entries after the test. It reads `MONGODB_URI` from the local `.env`, or `E2E_MONGODB_URI` when supplied. That URI must point to the same database used by the browser test app. It never calls a live provider.

## Saved-jobs verification

- Lint, TypeScript checks, both builds, and whitespace checks passed.
- All 25 unit/API tests and 30 MongoDB integration tests passed. Saved-job checks cover concurrent/idempotent saves, private ownership including ADMIN, notes/status/priority persistence, filters, stale revisions, source updates/removal, and unsave/re-save behavior.
- All seven browser flows passed across the full run and the corrected saved-job rerun. The saved-job flow verifies saving from search, editing and reloading metadata, conflicting edits in two tabs, priority filtering, and unsaving from job details. Its initial failure was an overly strict dropdown locator, corrected before the passing rerun.
- The local Docker stack is running with saved-job APIs enabled. Browser fixture jobs and their saved entries are cleaned up after the test.

## Career sources and notifications verification

Verified on 2026-10-01:

- Lint, TypeScript checks, both production builds, and 30 unit/API tests passed.
- All MongoDB integration suites passed (39 tests), followed by all 10 source/notification integration cases after adding shared-failure coverage and tightening filter edits. Coverage includes ownership, duplicate URLs, stale revisions, literal matching, provider caching, missing-job expiry, failure transitions, preferences, retrying persisted notifications after a service restart, scheduling, and overlapping checks. Temporary test databases are deleted.
- Eight browser flows passed across the full run and the corrected source/notification rerun. The new flow verifies source creation/edit/search/removal, unsupported link labels, cached matching, saving a matched job, public source filtering, read/unread and read-all actions, and persisted preferences. Initial browser failures exposed a field label that included helper text and an overly strict dropdown locator; both were corrected before the passing rerun.
- A complete live Greenhouse check imported 15 YugabyteDB published listings, produced one matching-job summary, and used the cached import on repeat. This verification used a temporary database that was deleted afterward; it did not add entries to the user's watchlist. Feed size is a snapshot, not a promised count.
- The three local Docker services are healthy and readiness reports MongoDB up. The browser test uses unique cached fixture jobs and removes its sources, notifications, preferences, saved entries, jobs, and ingestion record afterward; randomly named test accounts remain as with the existing browser suites.
- The next roadmap step is Phase 1 release verification. Live Google/GitHub consent still needs provider credentials; email/push providers and additional career-page adapters remain future work.

## Source registry and Google Careers verification

Verified across 2026-10-01–02 (Asia/Kolkata):

- Lint, TypeScript checks, both builds, 33 unit/API tests and 42 MongoDB integration tests passed. The 12 source integration cases also passed after refining migration handling for existing URL aliases. Coverage includes Google detection, fixed unpaginated fetching, malformed/oversized responses, partial-feed retention, scheduling, owner isolation and legacy migration without losing Greenhouse history.
- The career-source browser flow passed with Google detection before Save, enabled refresh controls, limited-coverage notices and generic matching-page labels, alongside existing Greenhouse matching, saved jobs and notifications. It makes no live provider calls and cleans up its source records and cached Greenhouse fixtures.
- A live refresh of the existing Google watchlist entry imported 20 public listings and found 4 matches for its saved Python keyword. Its label, filters and manual-only schedule were preserved. This import populated the application's real catalog; counts are a snapshot, not a guaranteed feed size.
- A separate Chromium check verified those 20 live jobs in the public Google source filter, the limited-coverage warning, job details and original Google listing links. Google reads only the first unfiltered results page and never expires missing listings; see the [integration plan](architecture/career-source-integration.md).
- Whitespace checks for this batch pass when excluding the pre-existing user notebook edit; `docs/project-notes.md` was left untouched.

## Career bookmarks verification

Verified on 2026-10-02 (Asia/Kolkata):

- Lint, TypeScript checks, both builds, 34 unit/API tests and all 13 source/notification MongoDB integration cases passed. Coverage includes strict bookmark input, private ownership, kind filtering, migration without automatic activation, preserving working-source history and legacy filters, stale-edit rejection, and skipping bookmarks even when stale scheduling/pending-delivery fields exist.
- The updated source browser flow passed. It checks both views, unsupported-page Save as bookmark, the simple bookmark form, editing/reloading, cancellation of tracking setup, explicit activation with manual frequency, cached job matching, removal, and existing saved jobs/notification/Google coverage behavior. It uses uniquely identified cached Greenhouse fixtures rather than calling live providers.
- The running app migrated its two existing native connections as job sources. The user's Google entry retained its Python filter, successful check, 4 matches, enabled state and manual schedule. Supported bookmarks require a saved tracking setup; recognition upgrades alone cannot start imports or alerts.
- On-demand career-page browsing remains future work, documented in [ADR-009](adr/009-career-bookmarks.md).

## Optional Check now filters verification

Verified on 2026-10-02 (Asia/Kolkata):

- Lint, TypeScript checks, both production builds, 35 unit/API tests and all 14 source/notification MongoDB integration cases passed. Temporary checks cover partial overrides, explicit clearing, literal matching, shared imports, private ownership, invalid inputs, failed imports and edits during a check. Saved settings, history, schedules and notifications remain intact.
- The career-source Chromium flow passed with inline keyword/location defaults, one-time checks, reset, filtered result links, pagination/reload and returning to saved filters. Existing source/bookmark editing, saved jobs and notification behavior also passed in that flow. Tests use cached fixture jobs without contacting live providers.
- The [career-source API contract](api/career-sources.md#optional-filters-for-check-now) documents temporary filters and inline saving. Edit source continues to include saved filters for scheduled checks and alerts.
- Follow-up: Update saved filters passed lint, TypeScript checks, the web production build and the expanded source browser flow. Coverage includes saving both inline fields, clearing restrictions, persistence after reload, matching saved values, resetting to updated defaults, retaining invalid drafts and preserving other source settings. A test expectation was corrected to use Greenhouse's existing canonical URL.

## Phase 1 release verification

Verified on 2026-10-02 (Asia/Kolkata):

- Node 24 checks passed: lint, TypeScript, both builds, 35 unit/API tests and 44 MongoDB integration tests. All 9 browser journeys passed across the full run and the corrected combined-journey rerun. The new flow verifies the core journey with one account, including persisted profile/preferences, resume and saved-job metadata after signing in again.
- A clean candidate copy started in a separate Compose project. Setup was idempotent with private `.env` permissions; fresh `npm ci` and builds passed, and the production dependency audit reported zero known vulnerabilities. Readiness/proxy headers, database outage/recovery and both data volumes were verified. The isolated startup imported 16 live Remotive jobs without changing the user's existing stack.
- The combined test's strict preference-label and unscoped priority locators were corrected. This initial verification exposed interrupted session restoration, fixed in the follow-up below. See [the full report](phase-1-release-verification.md).

## Authentication and component hardening

Verified on 2026-10-02 (Asia/Kolkata), using Node 24.21.0 and an isolated application database:

- Page-load restoration now validates the existing cookie without rotating it. Controlled reload/navigation interruptions, concurrent tabs, login/logout and expired access recovery pass; actual rotation still rejects/revokes replayed tokens and preserves absolute expiry.
- Lint, both workspace type checks/builds, 35 unit/API tests, 47 MongoDB integration tests, all 11 browser journeys and 10 standalone Chromium component tests passed. Repeated preliminary browser runs exhausted the test API's registration throttle; the final full run used a fresh temporary API process. Production limits were unchanged.
- Component tests exercise profile fields, OAuth availability/errors, resume preview cleanup/dismissal and saved-job interactions. They reuse existing packages and need no real API/database.
- GitHub callback failure/conflict checks are covered with mocked provider responses. The later configuration/live-handoff check is recorded below; Google live verification is deferred.

## GitHub configuration and live handoff

Checked on 2026-10-02 after credentials were added: configuration validation passed, the API was recreated and all three local services remain healthy. Chromium reached GitHub's actual login page from the enabled button, checked the callback/scopes/PKCE and binding cookie, and verified safe handling of simulated cancellation and callback replay. A deliberately invalid-code token probe returned `bad_verification_code` and issued no token. The subsequent real sign-in and issuer fix are recorded below; see [the release evidence](phase-1-release-verification.md#github-configuration-and-live-handoff) and [checklist](api/authentication.md#github-first-local-verification).

Follow-up: a real attempt returned `?oauth=failed`. Safe failure-stage logging isolated the exchange step. The regression reproduced rejection of GitHub's documented issuer by the old configuration; changing it to `https://github.com/login/oauth` fixes that validation failure and keeps foreign-issuer rejection. All 35 unit/API tests, backend lint/type checks/build and 12 auth integration cases pass, with no state/cookie/raw-error leakage in diagnostics. The user then confirmed the GitHub dashboard opens. Two real sign-ins reused one USER account; logout revoked the earlier session, the returning session is active, and restoration/current-user responses are 200. Actual consent cancellation and a live email-conflict scenario remain covered by mocks/simulation rather than manual provider checks. Google verification stays deferred.

## Structured resume drafts verification

Batch 2 was verified on 2026-10-03: modular Python services, shared OpenAI generation, durable PostgreSQL drafts and selected-field profile import. See [configuration, processing limits, deletion lifecycle and exact validation evidence](resume-drafts.md). The local stack now includes five ordinary services; original MongoDB/PDF volumes are preserved.

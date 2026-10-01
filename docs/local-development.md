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

Registration, JWT login/refresh/logout, protected dashboard/current-user API, USER/ADMIN middleware, and configurable Google/GitHub OAuth flows are implemented. Private career profiles are implemented at `/profile`, including skills, experience, education, certifications, preferences, and professional links. Resume management is implemented at `/resumes` with PDF uploads up to 5 MiB. Public job search/details and explicit Remotive imports are implemented; Cady remains future work. See the [profile API](api/profiles.md). See [the next steps](implementation-next-steps.md), [ADR-002](adr/002-authentication.md), and the [authentication API](api/authentication.md).

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

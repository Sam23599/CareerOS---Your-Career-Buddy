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

Registration, JWT login/refresh/logout, protected dashboard/current-user API, USER/ADMIN middleware, and configurable Google/GitHub OAuth flows are implemented. Profiles, resumes, jobs, and Cady remain future work. See [the next steps](implementation-next-steps.md), [ADR-002](adr/002-authentication.md), and the [authentication API](api/authentication.md).

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

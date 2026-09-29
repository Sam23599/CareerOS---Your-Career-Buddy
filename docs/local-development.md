# Local development

## Start everything in Docker

Prerequisite: Docker with Compose and a running Docker engine. Compose uses MongoDB 7.0; the kernel compatibility reason is recorded in [ADR-001](adr/001-local-platform-foundation.md#local-compatibility-finding). Run from the repository root:

```bash
cp .env.example .env
docker compose up --build -d --wait
```

Copy `.env.example` only on first setup; keep any existing `.env` values. Open http://localhost:5173. The page checks Express and MongoDB through the frontend's `/api` proxy.

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

API tests cover database outage/recovery, error responses, request IDs, and configuration validation using a stub database probe. They do not replace the live MongoDB checks below.

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

To check failure reporting, stop only this project's MongoDB with `docker compose stop mongodb`. `/api/v1/health` should remain 200, while `/api/v1/ready` should return 503. Click **Check again** on the page to see the unavailable database. Start it with `docker compose start mongodb`, wait for its health check, and check again to see recovery.

## Current scope

The page is a local connection diagnostic. Authentication, profiles, resumes, jobs, and Cady are not implemented yet. See [the next steps](implementation-next-steps.md) and [ADR-001](adr/001-local-platform-foundation.md).

## Verification recorded for this batch

- Docker stack healthy with Node 24.21.0 and MongoDB 7.0.
- Lint, TypeScript checks, three API tests, and both builds passed inside the Node 24 image.
- Frontend HTML and transformed entry module served successfully; `/api/v1/ready` reached MongoDB through the Vite proxy.
- With MongoDB stopped, liveness stayed at 200 and readiness returned 503. Readiness recovered after MongoDB restarted, without an API restart.
- A temporary database record survived `docker compose down` and container recreation; the record was then deleted.
- Browser rendering and interactive UI behavior were not automated in this batch.

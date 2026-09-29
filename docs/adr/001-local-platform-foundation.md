# ADR-001 — Local platform foundation

Status: Accepted. Date: 2026-09-30.

## Context

The first release needs a runnable foundation for profiles and job discovery. Node owns platform data, Python will own intelligence, and Java will own application workflows. Community remains in Phase 5.

## Decision

- Use TypeScript for React and Express, with npm workspaces and one committed lockfile.
- Use Node 24 LTS and npm 11. `.nvmrc` selects the host runtime; Docker uses `node:24-alpine`.
- Use Vite for React development and builds. Browser requests use `/api/v1`; the development proxy forwards them to Express without exposing database configuration to the browser.
- Run one Express application in `backend/platform/`. Add domain modules as their features arrive, without separate service deployments yet.
- Use MongoDB 7.0 with the official Node driver. There is no domain model requiring an ODM at this stage.
- Docker Compose runs web, API, and MongoDB. MongoDB uses a named volume. Host ports default to 5173, 3000, and 27017 and bind only to loopback.
- Keep local MongoDB unauthenticated and accessible only through local published ports and the Compose network. This is a development setup, not a production deployment.
- Separate process liveness from database readiness. Each readiness request pings MongoDB with a two-second operation timeout, allowing recovery without restarting the API.
- Use JSON request logs, generated request IDs, bounded JSON bodies, and a consistent error envelope. Do not log request bodies, credentials, or raw database errors.

## Consequences

One install and one local startup command serve both applications. The Node modules can be extracted later while preserving the existing ownership boundaries. Redis, Python, Java, Kafka, authentication, and business features are added in their planned batches.

Source files are mounted into development containers for reloads; dependency or configuration changes require a rebuild. The Dockerfile is for local development. Production images and routing will be designed in the production phase.

Runtime compatibility was checked against the [Node release schedule](https://github.com/nodejs/Release), [Vite requirements](https://vite.dev/guide/), and [MongoDB driver compatibility](https://www.mongodb.com/docs/drivers/compatibility/?driver-language=javascript&javascript-driver-framework=nodejs). Exact npm dependency resolutions are recorded in `package-lock.json`.

## Local compatibility finding

During verification, MongoDB 8.0.32 refused to start on Docker Desktop's `7.0.12-linuxkit` kernel. MongoDB documents an [8.0 incompatibility with Linux kernels 6.19 through 7.0.13](https://www.mongodb.com/docs/manual/release-notes/8.0/). The local foundation therefore uses the MongoDB 7.0 release line, [supported through August 31, 2027](https://www.mongodb.com/legal/support-policy/lifecycles). Revisit the database version when the Docker kernel is compatible; follow the documented database upgrade process once data exists.

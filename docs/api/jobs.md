# Jobs and ingestion

`/jobs` and `/jobs/:id` are public, including their APIs. Profiles, resumes and account data remain authenticated and private. Listings credit the provider and link to the original source; no application submission occurs inside CareerOS.

## Read APIs

- `GET /api/v1/jobs`: `{ jobs, total, page, limit }`.
- `GET /api/v1/jobs/sources`: `{ sources }`, the distinct active catalog source IDs used by the search dropdown. Includes imported Greenhouse boards and `google-careers` without any user's private settings.
- `GET /api/v1/jobs/:id`: `{ job }`; unknown IDs return 404.

Filters: `q` (title, company, description or skills), `location`, `company`, `skill`, `source`, `employmentType`, `remoteType`, `page` (1–1000), `limit` (1–50; default 20). Text filters are case-insensitive literal substrings, not regular expressions. `source` is an exact source identifier. Text inputs allow 100 characters. Repeated values and invalid pagination/enums return 400.

Employment types: `FULL_TIME`, `PART_TIME`, `CONTRACT`, `INTERNSHIP`, `TEMPORARY`, `OTHER`, `UNKNOWN`. Work modes: `REMOTE`, `HYBRID`, `ONSITE`, `UNKNOWN`. Missing values remain unknown/empty instead of being inferred. Remote location restrictions are displayed verbatim.

Results exclude explicitly expired jobs and sort by posted date descending, then stable ID. Detail pages remain available for expired records with an expiry notice. Missing expiry is not a guarantee that a vacancy remains open. Remotive does not supply expiry dates; check the original listing.

Normalized fields: `id`, `sourceId`, `title`, `company`, plain-text `description`, `location`, `employmentType`, `remoteType`, `skills`, `source`, `sourceUrl`, nullable `postedAt`/`expiresAt`, `metadata` (category/salary text), `createdAt`, `updatedAt`. Provider descriptions are displayed as text, never injected as HTML.

## Imports

```bash
# From the project root, with Docker running:
docker compose exec -T api npm run jobs:ingest -- remotive

# Optional, explicitly labeled demo listing (not seeded automatically):
docker compose exec -T api npm run jobs:ingest -- fixture
```

Host equivalent: `npm run jobs:ingest -- remotive` using the local `.env` connection.

`POST /api/v1/jobs/ingest/remotive` is also available with an ADMIN bearer token. Ordinary USER accounts receive 403; missing tokens receive 401. There is no automatic role promotion. Unknown source IDs return 404. No arbitrary source URL is accepted.

Remotive calls use a fixed HTTPS endpoint, a 20-second timeout, and a 20 MiB response limit. A MongoDB source record enforces a four-hour refresh interval across API/CLI instances (409 on cooldown). The API checks due times on startup and every minute, fetching every four hours while running (up to one minute of scheduling delay). Restarts preserve the schedule; overdue work runs on startup. Manual refreshes use the same cooldown. This user-requested schedule makes up to six calls daily; Remotive recommends at most four. Failed imports keep their cooldown and stored jobs. Scheduler errors are logged and subsequent checks continue.

Each job uses a deterministic ID from `(source, sourceId)` and a unique compound index. Reimport updates mutable data while preserving `createdAt`. Duplicate IDs, malformed rows and invalid source responses reject the feed before any job writes. Remotive and fixture imports retain missing jobs, including on empty feeds. Complete successful Greenhouse board imports expire missing jobs; see [career sources](career-sources.md). Fetch failures preserve stored jobs; a database failure during a bulk write may leave a partially refreshed batch, recoverable through an idempotent retry after cooldown.

Google jobs carry `metadata.coverage: "limited"`: imports read the first 20 unfiltered public results, retain missing jobs, and cannot establish complete coverage or closure. Job cards/details show that limitation and retain links to the original listing. Missing provider fields stay unknown.

`job_ingestion_runs` records the source status, timestamps, imported count and next allowed refresh; `jobs` stores normalized records. The fixture adapter exists for tests and explicit demos only. Remotive refresh is admin/CLI/scheduler controlled. Users can manage and check their own [career sources](career-sources.md). Manual editing/deletion of provider-owned jobs is not exposed.

Provider contract: [Remotive API documentation](https://github.com/remotive-com/remote-jobs-api) and [source terms](https://remotive.com/remote-jobs/api). Listings are delayed 24 hours; attribution, original links, and ungated listing access are retained. Do not redistribute this feed to third-party job boards.

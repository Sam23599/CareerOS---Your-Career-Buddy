# Custom career sources

Manage dream companies at `/career-sources`, with search, source-type filters, and pagination. Company labels, URLs, keywords, locations, check settings, and notifications belong to the signed-in user. ADMIN has no access to another user's watchlist. APIs require a USER/ADMIN bearer token and use `/api/v1/career-sources`.

## Supported sources

Greenhouse board URLs support job refreshes: `https://boards.greenhouse.io/{board}` and `https://job-boards.greenhouse.io/{board}`. Use the board root, without a query or job path. Both forms are stored as the same canonical URL. Other HTTPS career URLs can be saved and opened as links; they are clearly labeled as unsupported for job reading and cannot be scheduled or refreshed.

Only the fixed `boards-api.greenhouse.io` public API is fetched. Requests reject redirects, time out after 20 seconds, and cap each response at 20 MiB. Arbitrary saved URLs are never fetched by the server. Provider contract: [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html).

Published Greenhouse listings become public catalog jobs with source `greenhouse:{board}` and the provider's official company name. Personal company labels and filters are never copied into jobs. Importing uses the existing deterministic `(source, sourceId)` identity; users watching the same board share its imported public listings. Source filters only choose which listings that user sees as matches and receives alerts for.

## API contract

| Method/path | Behavior |
| --- | --- |
| `GET /` | `{ sources, total, page, limit }`; optional `q` searches company/URL literally, `filter` is `supported`, `reference`, or `paused`. |
| `POST /` | Create settings; 201 `{ source }`. Duplicate owner/URL pairs return 409. |
| `PATCH /:id` | Replace settings with the current `revision`; `{ source }`. Stale revisions return 409. |
| `DELETE /:id` | Remove only the owner's source; idempotent 204. Imported public jobs and existing notifications remain. |
| `POST /:id/refresh` | No body fields; `{ source, cached, failed }`. Unsupported/paused sources return 400; an overlapping check or provider import returns 409. |
| `GET /:id/jobs` | Owner-only matches; `{ source, jobs, total, page, limit }`. Unsupported sources return 400. |

Lists use `page` 1–1000 and `limit` 1–50 (default 20). Sources sort newest first with an ID tie-breaker; matching jobs sort by import update time and ID. Unknown/unowned sources return 404 on reads/edits/checks. JSON is required for creation/edits. Unknown fields and user-supplied ownership fail validation.

Create/edit settings:

```json
{
  "company": "YugabyteDB",
  "careerUrl": "https://job-boards.greenhouse.io/yugabyte",
  "keywords": ["Engineer", "Python"],
  "locations": ["India", "Bengaluru"],
  "scanHours": 4,
  "enabled": true
}
```

Edits also require the last returned UUID `revision`. Company labels allow 200 characters; HTTPS URLs allow 2048 characters without embedded credentials. Each keyword/location list allows 30 trimmed values of up to 100 characters. `scanHours` is `0` (manual), `4`, `12`, or `24`; unsupported URLs require `0`. All settings must be provided on edit. Filter changes invalidate the previous check summary until the next check. Revisions protect concurrent edits and prevent an old in-progress check from applying results to new settings.

Matches are case-insensitive literal substrings: **any keyword** in title/description/skills AND **any location** in the supplied location name. Empty groups impose no restriction. This is saved-filter matching; it does not use the profile, resume, AI, or inferred work mode. Greenhouse does not reliably provide posted dates, employment type, work mode, or skills through this listing contract; unavailable fields stay null/unknown/empty.

## Refresh and notifications

Scheduled sources are due immediately when created or edited. The API checks persisted due times on startup and every minute, processing up to 25 sources per pass without overlapping passes. Checks run while the API is running; downtime is caught up after restart. Paused and manual-only sources are skipped. Failures retry after an hour for scheduled sources, retain existing jobs, and produce one source-failure alert until a successful check resets the failure state.

Each Greenhouse board has a shared one-hour import cooldown. A manual check inside that window evaluates filters against the last successful import and reports `cached: true`; it does not force another provider call. A failed shared import is reported as a failed check for every subscriber, rather than as a fresh successful import. Provider failures are recorded and returned with `failed: true` and a failed source status, even though the check endpoint returns 200.

Complete successful Greenhouse feeds expire previously imported jobs that disappear, including after a genuinely empty board. Invalid/incomplete feeds are rejected before job writes and do not expire old listings. Expired detail pages and saved-job notes remain accessible; returning jobs reuse their original IDs. Database writes are idempotent but a database failure during a bulk import can leave a partial update, recoverable on a later import.

The first successful check sends a summary for existing matching jobs. Later checks notify about newly matching IDs compared with the previous successful check. Repeated unchanged checks do not repeat alerts; a previously removed match can alert again when it returns. Notification preferences can suppress future alerts. A pending notice is stored alongside check results and retried if delivery fails; see [notifications](notifications.md) and [ADR-007](../adr/007-career-sources-notifications.md).

MongoDB collection: `career_sources`, with owner/URL uniqueness, configuration revisions, check status/timestamps, seen matching IDs, persisted due times, short check leases, and pending notice delivery. API responses omit owner IDs, leases, seen IDs, and pending delivery records.

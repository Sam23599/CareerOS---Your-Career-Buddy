# Custom career sources

Manage dream companies at `/career-sources`, with separate Job sources and Career bookmarks views, search, tracking-status filters and pagination. Company labels, URLs, keywords, locations, check settings, and notifications belong to the signed-in user. ADMIN has no access to another user's watchlist. APIs require a USER/ADMIN bearer token and use `/api/v1/career-sources`.

## Supported sources

Greenhouse board URLs support complete job refreshes: `https://boards.greenhouse.io/{board}` and `https://job-boards.greenhouse.io/{board}`. Use the board root, without a query or job path. Both forms are stored as the same canonical URL.

Google Careers supports a **limited import** from `https://www.google.com/about/careers/applications/jobs/results/`, including its career root aliases such as `https://careers.google.com/`. Listing query filters/page numbers are discarded: each import reads the first 20 **unfiltered** public results only. Google's robots rules disallow automated pagination. User filters apply to collected listings, so jobs elsewhere on Google's site may be absent. Repeated checks can accumulate jobs; their availability must be confirmed at the original link. This uses public embedded listing data, not a documented Google jobs API.

Other HTTPS career URLs can be saved through Bookmark career page, using only a company name and URL. The job-source form detects support before Save and offers Save as bookmark for unsupported pages. Bookmarks have no matching filters, schedules, job alerts or refresh controls. Native pages can also be bookmarked intentionally. When support becomes available, Enable job tracking opens the full setup form; saving it activates tracking on the same entry. No provider fetch occurs while bookmarking or detecting support. See the [consistent integration plan](../architecture/career-source-integration.md) for future ATS and custom-site support.

Only the fixed `boards-api.greenhouse.io` public API and Google Careers' unpaginated public root are fetched. Requests reject redirects, time out after 20 seconds, and cap each response at 20 MiB. Arbitrary saved URLs are never fetched by the server. Provider contract: [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html).

Published Greenhouse listings become public catalog jobs with source `greenhouse:{board}` and the provider's official company name. Personal company labels and filters are never copied into jobs. Importing uses the existing deterministic `(source, sourceId)` identity; users watching the same board share its imported public listings. Source filters only choose which listings that user sees as matches and receives alerts for.

Google uses shared source ID `google-careers` and marks jobs with `metadata.coverage: "limited"`. Source responses expose `kind` (`bookmark`/`job-source`), `provider`, `providerName`, `sourceId`, `coverage` (`complete`/`limited`/`link`), `canRefresh` and `canEnableTracking`; they omit the internal connection definition. Coverage describes native capability, independent of intent: a supported bookmark has provider coverage but `canRefresh: false`, `canEnableTracking: true` and no next scan.

## API contract

| Method/path | Behavior |
| --- | --- |
| `GET /` | `{ sources, total, page, limit }`; optional `kind` is `job-source` or `bookmark`, `q` searches company/URL literally. `filter=paused` selects inactive job sources; compatibility filters `supported`/`reference` select supported job sources/bookmarks. Combined filters must all match. |
| `GET /detect?url=...` | Authenticated, read-only URL recognition: `{ provider, providerName, sourceId, careerUrl, coverage, canRefresh, message }`. Makes no external requests. Invalid/repeated URLs return 400. |
| `POST /` | Create a bookmark or job source with explicit `kind`; 201 `{ source }`. Duplicate owner/URL pairs and job-source connections return 409. |
| `PATCH /:id` | Replace settings with explicit `kind` and current `revision`; `{ source }`. Also supports enabling job tracking on a bookmark. Stale revisions return 409. |
| `DELETE /:id` | Move only the owner's source/bookmark to the recovery bin; idempotent 204. Imported public jobs and existing notifications remain. |
| `POST /:id/refresh` | Optional `{ filters: { keywords, locations } }`; `{ source, cached, failed, temporary, filters, matchingCount }`. Without filter overrides, checks the saved filters. Bookmarks and unsupported/paused sources return 400; an overlapping check or provider import returns 409. |
| `GET /:id/jobs` | Owner-only matches; `{ source, filters, temporary, jobs, total, newTotal, page, limit, since, visitedAt }`. Optional `keywords`/`locations` are JSON arrays; `q`/`location` refine results, `sort` chooses newest/oldest/title/posted, and `since` pins the visit boundary. Each job includes `isNew`. Bookmarks and unsupported sources return 400. |
| `POST /:id/view` | Acknowledge the server-issued `visitedAt` after results display; monotonically updates that owner's source view marker. |

Lists use `page` 1–1000 and `limit` 1–50 (default 20). Sources sort newest first with an ID tie-breaker; matching jobs put New before Earlier, then the chosen order and stable ID. New uses immutable discovery time against the previous view, not every import; first visit treats all matches as new. Unknown/unowned/trashed sources return 404 on reads/edits/checks. JSON is required for creation/edits. Unknown fields and user-supplied ownership fail validation.

Create/edit job-source settings:

```json
{
  "kind": "job-source",
  "company": "YugabyteDB",
  "careerUrl": "https://job-boards.greenhouse.io/yugabyte",
  "keywords": ["Engineer", "Python"],
  "locations": ["India", "Bengaluru"],
  "scanHours": 4,
  "enabled": true
}
```

Create/edit bookmark settings:

```json
{
  "kind": "bookmark",
  "company": "Dream company",
  "careerUrl": "https://example.com/careers"
}
```

Edits also require the last returned UUID `revision`. Company labels allow 200 characters; HTTPS URLs allow 2048 characters without embedded credentials. Job sources require native support and all tracking settings; each keyword/location list allows 30 trimmed values of up to 100 characters, and `scanHours` is `0` (manual), `4`, `12`, or `24`. Bookmark requests reject tracking fields and store `enabled: false`, `scanHours: 0`; existing legacy filters are retained internally on edits for future tracking setup. Bookmark URLs keep their original query rather than being canonicalized to a provider root. Enabling tracking requires a full `kind: "job-source"` edit; the UI starts with manual frequency and Enabled checked. Tracking transitions preserve the ID/creation date and clear prior check summaries, leases and pending notices. Filter changes invalidate the previous check summary. Revisions protect concurrent edits and prevent an old in-progress check from applying results to new settings.

Matches are case-insensitive literal substrings: **any keyword** in title/description/skills AND **any location** in the supplied location name. Empty groups impose no restriction. Matching uses saved filters unless temporary overrides are supplied; it does not use the profile, resume, AI, or inferred work mode. Greenhouse does not reliably provide posted dates, employment type, work mode, or skills through this listing contract. The shared catalogue normalizer now derives unambiguous missing metadata from listing text with provenance; unresolved facts stay null/unknown/empty. See [notebook changes](../notes-improvements.md).

### Optional filters for Check now

Each job-source card shows keyword/location inputs above Check now, prefilled with its saved filters. Changes apply only to that check; Reset to saved filters restores the defaults. Separate values with commas, or clear a field to remove that restriction. Update saved filters saves both current inputs through the existing revision-protected `PATCH /:id`, keeping the company, URL, check frequency and enabled setting. The updated filters become the defaults for future checks and alerts. Failed saves retain the draft for correction or reset. Edit source still includes the saved filters.

Example temporary check:

```json
{
  "filters": {
    "keywords": ["Python"],
    "locations": []
  }
}
```

An omitted group uses its saved values; an explicit empty array means unrestricted. The same 30-value/100-character limits apply. An absent body, `{}`, or `{ "filters": {} }` runs the normal saved-filter check. Nonempty requests must use JSON, and unsupported fields return 400.

A temporary check shares provider imports and cooldowns, returns its effective `filters`, `temporary: true` and `matchingCount`, and leaves saved settings, check history, seen matching IDs, next scan and notifications unchanged. A failed temporary check returns `failed: true` and `matchingCount: null`, retaining existing listings and the saved check summary. Concurrent edits still discard stale results.

View matches for this check links to `GET /:id/jobs` with URL-encoded JSON arrays, for example `keywords=["Python"]&locations=[]`. Pagination preserves those overrides; Use saved filters removes them. Both endpoints return the effective filters so the result page identifies which rules selected its jobs. Filters select from imported jobs; they do not change provider coverage or fetch additional pages.

## Refresh and notifications

Scheduled job sources are due immediately when created or edited. The API checks persisted due times on startup and every minute, processing up to 25 sources per pass without overlapping passes. Checks run while the API is running; downtime is caught up after restart. Bookmarks, paused and manual-only sources are skipped. Pending source notices are only delivered for job sources. Failures retry after an hour for scheduled sources, retain existing jobs, and produce one source-failure alert until a successful check resets the failure state.

Each Greenhouse board and the shared Google Careers source have a one-hour import cooldown. A manual check inside that window evaluates filters against the last successful import and reports `cached: true`; it does not force another provider call. A failed shared import is reported as a failed check for every subscriber, rather than as a fresh successful import. Provider failures are recorded and returned with `failed: true`, even though the check endpoint returns 200. Saved-filter checks also persist a failed source status; temporary checks preserve the existing summary.

Complete successful Greenhouse feeds expire previously imported jobs that disappear, including after a genuinely empty board. Invalid/incomplete feeds are rejected before job writes and do not expire old listings. Expired detail pages and saved-job notes remain accessible; returning jobs reuse their original IDs. Database writes are idempotent but a database failure during a bulk import can leave a partial update, recoverable on a later import.

Google's partial snapshots never expire missing listings. Consent/error pages, missing listing links or changed embedded-data formats fail the import instead of being treated as empty feeds. Google also keeps unavailable posted dates, work mode, employment type and skills null/unknown/empty.

The first successful check sends a summary for existing matching jobs. Later checks notify about newly matching IDs compared with the previous successful check. Repeated unchanged checks do not repeat alerts; a previously removed match can alert again when it returns. Notification preferences can suppress future alerts. A pending notice is stored alongside check results and retried if delivery fails; see [notifications](notifications.md) and [ADR-007](../adr/007-career-sources-notifications.md).

MongoDB collection: `career_sources`, with owner/URL uniqueness, configuration revisions, check status/timestamps, seen matching IDs, persisted due times, short check leases, and pending notice delivery. API responses omit owner IDs, leases, seen IDs, and pending delivery records.

Internal `connection` definitions and `registryVersion` support startup recognition upgrades. Entries with existing provider connections or legacy Greenhouse boards are backfilled as job sources, keeping their history/settings. Old unsupported references become bookmarks. Recognition upgrades update bookmark capabilities without changing their `kind` or activating them. Existing Greenhouse jobs and IDs stay intact. Legacy alias URLs are retained, including on job-source settings edits, to prevent owner/URL migration collisions. New duplicate job-source connections return 409; bookmarks retain owner/URL uniqueness. Add adapters through the registry and bump its version when detection changes. See [ADR-009](../adr/009-career-bookmarks.md).

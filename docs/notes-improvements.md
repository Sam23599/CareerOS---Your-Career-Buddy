# Notebook improvements — 2026-10-07

Implemented from the user's project-notes request, with these clarified decisions:
seven-day sessions already work; post-cleanup recovery is support-only; settings
usage/credits/payments are a demo. Personalized AI preparation remains a separate
future step. These changes make no new AI call on page reads or imports.

## Browsing and analysis

- Global job sources are grouped into job platforms and company feeds. Company
  sources retain their searchable/paginated list, bookmarks, optional check filters,
  reset and update-saved-filter actions. Shorter help keeps the check flow compact.
- All selected filters must match. Skill search checks tags and description text.
  `JobMetadataNormalizer` fills unknown employment/work-mode fields only from
  unambiguous phrases and records inferred fields separately from explicit upstream
  values. A versioned, idempotent backfill updates existing listings without changing
  their discovery/import dates or description hash. Ambiguous facts stay UNKNOWN.
  Keyword mentions are not a claim that a skill is required. No paid LLM ingestion.
- Employer-published email addresses are extracted from source text and labelled
  unverified; no recruiter identity or deliverability is invented. LinkedIn/Apollo
  and company-review links open external research. Native LinkedIn search/Easy Apply,
  licensed contact enrichment and imported ratings still require supported access.
- Source feeds show New/Earlier groups. New means `createdAt > lastViewedAt` for
  that account's source. First visit treats existing matches as new. Each visit pins
  its previous boundary across sorting/search/pages; a separate POST acknowledges
  the server-issued visit time after display, using a monotonic `$max`. Refreshing
  old listings does not make them new. Searches debounce 300 ms and query all pages;
  they neither edit saved filters nor refresh the provider.
- Job analysis categories and CV import fields have native expand/collapse controls.
  Collapsing retains edits; warnings, version/model controls and import confirmation
  remain visible. Ranking has short controls with expandable method/limits help.

## Durable job-analysis tasks

The UI uses `POST /api/v1/intelligence/jobs/:id/tasks` with
`{model, reasoning, requestKey: UUID}`. The authorized gateway constructs source
text/hash and returns HTTP 202 `{taskId}` after PostgreSQL accepts the task.

Python owns `analysis_tasks` and a modular repository/worker. The queue has at most
20 active tasks globally and two per owner; a duplicate owner/request key returns
the original task, while an active task for the same owner/job is reused. One task
runs globally; CV and job generation still share the existing generation gate.
Only contention before generation is requeued. Provider failures are not retried
automatically by the worker; the existing single validation-recovery attempt inside
job generation remains unchanged and may incur its additional provider charge.

Queued tasks survive restart. Running tasks have a three-minute lease; shutdown or
an expired lease marks an interrupted task failed rather than generating again.
A saved version may exist after an uncertain interruption: inspect history before
retrying. Each successful result is the normal immutable numbered analysis; task
rows contain its ID. Current source checks and analysis verification still apply.
Source changes are reported as stale when reading old results, not silently applied.

Owner-scoped endpoints:

| Endpoint | Behavior |
| --- | --- |
| GET `/api/v1/intelligence/jobs/:id/tasks` | Latest 100 tasks for this owned namespace/job |
| GET `/api/v1/intelligence/tasks` | Latest 100 tasks for the signed-in account |
| POST `/api/v1/intelligence/tasks/:id/cancel` | Cancel a queued task; running provider work continues |

The task-history page polls every five seconds; the job panel polls pending work
every two seconds without overlapping requests. Leaving only stops browser polling.
It does not cancel an accepted task. Failed tasks offer safe copy/download details:
IDs, action, timestamps, state and code; no CV/JD text, token, secret or provider body.
No mail is sent automatically. Resume generation/extraction keep their existing
inline cancellation behavior; general HTTP logs are not a persisted user log viewer.

## Recovery and manual tracking

- Resume versions, saved jobs, sources and bookmarks move to trash instead of
  erasure. MongoDB stores `trash.deletedAt/expiresAt`; PDFs and Python analyses are
  retained. Original sources are hidden immediately and owner gateways deny reads
  or mutation while trashed. In-flight result reads recheck availability.
- Bin visibility/restore windows expire on reads; there is no destructive cleanup
  job or TTL index. Default 30 days, configurable 1–365 for future deletions. Expired
  rows stay stored and leave the user's bin. Ordinary restore cannot bypass expiry.
- New saves can coexist with retained deleted versions. Partial unique indexes
  enforce one active saved job per owner/job and one active source per owner/URL.
  Restoring a conflicting old version returns 409 instead of overwriting live data.
- Restoring a resume preserves bytes/version and leaves active selection explicit.
  Already-erased historical files are not recoverable. Legacy cleanup outboxes
  continue handling historical deletion work; new user trash does not enqueue it.
- GET `/api/v1/recycle-bin`, PATCH `/api/v1/recycle-bin/preferences` (`binDays`),
  POST `/api/v1/recycle-bin/:kind/:id/restore` are owner-scoped. Kinds are `resume`,
  `saved-job`, `career-source`; IDs are resource IDs from the bin, not always job IDs.
- ADMIN support uses GET `/api/v1/recycle-bin/support/:owner` and POST
  `/api/v1/recycle-bin/support/:owner/:kind/:id/restore`; account IDs are explicit,
  support reads/restoration requests are audited, and expired entries are accessible
  only through these role-protected routes. Role names can become a dedicated
  support role later; ordinary ADMIN resource routes retain owner isolation.
- Saved jobs have location, inclusive UTC posting-date range, manual application
  progress and company-history filters. Unknown posting dates are excluded only
  when a range is selected. Legacy snapshots are backfilled where catalogue data
  exists. Interest status remains separate from application progress.
- Progress: NOT_APPLIED/APPLIED/IN_PROGRESS/INTERVIEWING/OFFERED/REJECTED/WITHDRAWN.
  Changed statuses add timestamped events; saving unchanged notes adds no event.
  Company history uses normalized exact company names and recorded applications,
  including retained saves. It cannot discover external applications or merge
  company aliases. No application is submitted or connected to employer systems.
  This is a manual foundation; the full Phase 3 workflow/service remains future.
- Ranking uses every applied saved-list filter and retains existing scores/bounds.

## Appearance, settings and services

Light/Dark/System uses semantic tokens and a browser-persisted preference, responds
to system changes, and initializes before React renders. Settings provides account,
notification, bin, history and status shortcuts. Credit figures are labelled samples;
recharge and auto-refill are disabled. There is no real usage ledger or payment.

Authenticated GET `/api/v1/system/status` aggregates core MongoDB and private Python
dependency checks. Python pings PostgreSQL and reports parser readiness and AI
configuration separately. An unconfigured/unreachable optional service is not proof
its database/provider is down; the UI says Cannot verify. No Docker socket, provider
network probe or paid call is used for health. Core readiness remains independent.

Compose's database service is now `intelligence-postgres`. The named
`intelligence_db_data` volume is unchanged. Stop the old service before using the new
name; never run two PostgreSQL containers against the same data directory. Do not
use `down -v`. The old stopped container can be removed without deleting the volume.

## Verification and limits

Tests use isolated MongoDB/PostgreSQL databases and mocked provider responses.
Browser tests mock task generation; they never spend credits. Live public catalogue
filter comparisons and private dependency probes make no AI call.

Final local checks: lint/typecheck/production build, 71 Node unit tests, 91 MongoDB
integration tests and 115 Python tests (including isolated PostgreSQL task storage)
passed. Five Chromium flows passed for theme/mobile layout, pinned source visits,
combined live filters, navigation-safe tasks, saved job-analysis versions and CV
field review/conflicts. The four changed job/source/theme flows were rerun after
final UI corrections. API, web, MongoDB, intelligence and intelligence-postgres
report healthy; the replacement PostgreSQL container uses the original volume.
No changes were staged, committed or pushed by this implementation.

Google's existing adapter/setup remains ready, but local credentials are empty;
real consent needs the user's OAuth app configuration and browser interaction.
No native LinkedIn/contact/review integration, real billing, general failed-request
log collection or personalized AI preparation is represented as completed here.

# Saved jobs

Open `/saved-jobs` from the dashboard, or use Save job on a search result/detail page. Public job browsing stays available without sign-in; saving requires an authenticated account. Notes, priorities, and saved-job lists belong only to that account, including when the account has ADMIN privileges.

All endpoints require `Authorization: Bearer <accessToken>`:

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/saved-jobs` | `{ savedJobs, total, page, limit }`, newest saves first. |
| `GET /api/v1/saved-jobs/:jobId` | `{ savedJob }`; `null` if this user has not saved it. |
| `PUT /api/v1/saved-jobs/:jobId` | Save an existing catalog job; no fields required. Returns `{ savedJob }`. Repeat saves preserve notes, status, priority and timestamps. |
| `PATCH /api/v1/saved-jobs/:jobId` | Update `notes`, `status`, `priority` and/or `applicationStatus` using the latest `revision`; returns `{ savedJob }`. |
| `DELETE /api/v1/saved-jobs/:jobId` | Move the save and its private notes/history to the recovery bin; repeated removal returns 204. |

Job IDs are the catalog's 64-character hexadecimal IDs. Unknown catalog jobs cannot be newly saved (404). Invalid IDs/fields/filters return 400. PATCH requires JSON (415 otherwise). Every operation derives ownership from the bearer token, never the body or query.

Defaults: `status: SAVED`, `priority: MEDIUM`, `notes: ""`. Supported statuses are `SAVED`, `INTERESTED`, `NOT_INTERESTED`; priorities are `LOW`, `MEDIUM`, `HIGH`. These are interest states, not application statuses. Notes allow up to 5,000 characters and can be cleared with an empty string.

```json
{
  "revision": "the-uuid-returned-by-the-last-read",
  "status": "INTERESTED",
  "priority": "HIGH",
  "notes": "Ask about the engineering team."
}
```

Each successful edit generates a new revision. A stale edit, or editing an entry removed in another tab, returns 409 `SAVED_JOB_CHANGED`. The editor preserves the draft and offers Reload saved job. Removing and re-saving creates a fresh record/revision so an old draft cannot overwrite the new entry. Unsave hides associated notes after UI confirmation; the bin retains them. Restoring a removed copy while another is active returns 409 `RECOVERY_CONFLICT`.

List filters: optional exact `status`, `priority`, `applicationStatus`, location text, inclusive UTC posting-date range `postedFrom`/`postedTo` (YYYY-MM-DD), and `companyHistory` (`first_application`/`previously_applied`); `page` 1–1000 (default 1), `limit` 1–50 (default 20). Repeated parameters are rejected. Sort is saved date descending with a stable ID tie-breaker. Reapply filters after editing metadata to refresh the filtered list. Unknown dates are excluded only when a date range is selected. Application progress/history is manually recorded; no employer submission or external application history is inferred.

Each result includes `jobId`, `status`, `priority`, `notes`, `revision`, `savedAt`, `updatedAt`, `available`, and a compact `job` summary. Current catalog details are used where available; if a catalog record disappears, the original saved summary remains with `available: false`. Expired and missing listings stay in the private list so notes are not lost. Source links retain attribution.

MongoDB collection: `saved_jobs`. Each save has its own ID; a partial unique owner/job index prevents concurrent active duplicates while preserving removed versions. A separate owner/date index supports private list pagination. Reimporting source jobs never updates private saved-job metadata.

## 2026-10-07 extension

See [notebook improvements](../notes-improvements.md) for applicationStatus edits/history, location/posting-date/company-history filters, matching ranking filters, and recoverable removal. DELETE now moves the saved record/notes to the bin. Application progress is manually recorded, separate from interest; it does not submit applications.

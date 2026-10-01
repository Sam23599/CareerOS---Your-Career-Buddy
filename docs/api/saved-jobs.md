# Saved jobs

Open `/saved-jobs` from the dashboard, or use Save job on a search result/detail page. Public job browsing stays available without sign-in; saving requires an authenticated account. Notes, priorities, and saved-job lists belong only to that account, including when the account has ADMIN privileges.

All endpoints require `Authorization: Bearer <accessToken>`:

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/saved-jobs` | `{ savedJobs, total, page, limit }`, newest saves first. |
| `GET /api/v1/saved-jobs/:jobId` | `{ savedJob }`; `null` if this user has not saved it. |
| `PUT /api/v1/saved-jobs/:jobId` | Save an existing catalog job; no fields required. Returns `{ savedJob }`. Repeat saves preserve notes, status, priority and timestamps. |
| `PATCH /api/v1/saved-jobs/:jobId` | Update `notes`, `status`, and/or `priority` using the latest `revision`; returns `{ savedJob }`. |
| `DELETE /api/v1/saved-jobs/:jobId` | Unsave and delete private notes; repeated removal returns 204. |

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

Each successful edit generates a new revision. A stale edit, or editing an entry removed in another tab, returns 409 `SAVED_JOB_CHANGED`. The editor preserves the draft and offers Reload saved job. Removing and re-saving creates a fresh revision so an old draft cannot overwrite the new entry. Unsave removes all associated notes after UI confirmation.

List filters: optional exact `status` and `priority`; `page` 1–1000 (default 1), `limit` 1–50 (default 20). Repeated parameters are rejected. Sort is saved date descending with a stable ID tie-breaker. Reapply filters after editing metadata to refresh the filtered list.

Each result includes `jobId`, `status`, `priority`, `notes`, `revision`, `savedAt`, `updatedAt`, `available`, and a compact `job` summary. Current catalog details are used where available; if a catalog record disappears, the original saved summary remains with `available: false`. Expired and missing listings stay in the private list so notes are not lost. Source links retain attribution.

MongoDB collection: `saved_jobs`. A deterministic primary key from owner ID and job ID prevents duplicates even under concurrent saves. A separate owner/date index supports private list pagination. Reimporting source jobs never updates private saved-job metadata.

# ADR-006: Private saved jobs and interest tracking

Status: Accepted. Date: 2026-10-01.

Store saved jobs separately from the public catalog in `saved_jobs`. Use a deterministic primary key derived from `(ownerId, jobId)` to enforce one save per user/job pair. Resolve ownership exclusively from the authenticated session; ADMIN has no cross-user access.

Saving is idempotent and preserves existing private metadata. Defaults are SAVED, MEDIUM priority, and empty notes. Use the roadmap's SAVED/INTERESTED/NOT_INTERESTED statuses; application progress remains a separate later domain. Support bounded notes and exact status/priority filters with pagination.

Use fresh UUID revisions for conditional edits. This prevents lost updates and also rejects stale drafts after an entry is removed and re-saved. Unsave is idempotent and removes the private metadata; the UI asks before removal.

Display current catalog summaries, retaining the original saved summary as a fallback when a source record disappears. Expiry and disappearance do not automatically remove the user's notes. Do not duplicate full descriptions or private data into the public jobs collection.

See the [saved-jobs API](../api/saved-jobs.md). Custom career sources and basic notifications remain the next Phase 1 scope.

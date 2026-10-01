# ADR-007: Custom career sources and in-app notifications

Status: Accepted. Date: 2026-10-01.

Keep private watchlist configuration in the existing Node platform's `career-sources` module. Support company labels, career URLs, keywords, locations, enabled state, and manual/4/12/24-hour checks. Add searchable, paginated management for large dream-company lists, separate from platform job search.

Start automated job reading with Greenhouse's public Job Board API. Recognize only board-root URLs and fetch a fixed provider endpoint with timeout, response bounds, and redirects disabled. Other HTTPS career pages remain clearly labeled links until an adapter is added. Do not introduce arbitrary scraping. Normalize published listings into the public job catalog with official provider company names; owner settings stay private. Share board imports across users with a one-hour cooldown. Only complete successful feeds may expire missing Greenhouse jobs; existing Remotive retention behavior remains unchanged.

Extend the existing in-process job scheduler with persisted user-source due times and short per-source leases. Process a bounded batch and do not overlap passes. Configuration revisions prevent stale edits or refreshes from overwriting newer settings. Schedules require a running API; dedicated workers/queues belong to later automation and infrastructure work.

Keep notification preferences and delivery in a separate module. `NotificationService` depends on a provider interface; use MongoDB for in-app delivery initially. Notify on newly matching source jobs and failure transitions, respect per-user preferences, and support read/unread state. Persist a pending notice with check results and use owner/event identities for safe delivery retries. One pending slot per source may coalesce alerts during an extended delivery outage; a durable event queue can replace this when required. Avoid external notification services or Kafka in Phase 1.

See the [career-source API](../api/career-sources.md) and [notification API](../api/notifications.md). Phase 1 release verification is the next step; AI/Cady, application tracking, and community remain in their planned phases.

# In-app notifications

View alerts and preferences at `/notifications`. Signed-in users see matching-job summaries and career-source failure alerts. The header shows an unread count, refreshed on route changes, local updates, and every 30 seconds while the page is visible. Read/unread actions and preferences are stored in MongoDB and survive reloads.

All `/api/v1/notifications` endpoints require a USER/ADMIN bearer token. Ownership comes only from the session; ADMIN cannot read or change another user's notifications/preferences.

| Method/path | Response/behavior |
| --- | --- |
| `GET /` | `{ notifications, total, unreadCount, page, limit }`; `unread=true` selects unread records. `unreadCount` always covers all the owner's unread notifications. |
| `PATCH /:id` | JSON `{ "read": true }` or `{ "read": false }`; 204. Unknown/unowned IDs return 404. |
| `POST /read-all` | No body fields; mark the owner's current notifications as read, 204. |
| `GET /preferences` | `{ preferences: { newJobs, sourceErrors } }`; both default to true. |
| `PATCH /preferences` | One or both boolean settings; returns the persisted preferences. Unknown fields/invalid values return 400. |

Pagination: `page` 1–1000, `limit` 1–50 (default 20). Newest notifications come first with an ID tie-breaker. Record fields: `id`, `type` (`NEW_JOBS` or `SOURCE_ERROR`), `title`, `message`, `href`, `createdAt`, and `read`. Private delivery keys and owner IDs are omitted from responses.

Preferences apply at delivery time. Disabling a type suppresses future delivery, leaves existing records untouched, and does not pause source checks. Suppressed alerts are not replayed when the preference is re-enabled.

`NotificationService` checks preferences and calls the provider-independent `NotificationProvider.deliver(owner, notice)` contract. The initial provider is the MongoDB in-app store. Deterministic owner/event IDs make delivery retries idempotent. Source refresh results and a pending notice are saved in one source-document update before delivery; failed deliveries are retried on the scheduler's next pass, including for manual-only sources. Each source has one pending notice slot; repeated updates during a prolonged delivery outage can coalesce notices. This is a small local foundation, rather than an event queue.

MongoDB collections: `notifications` and `notification_preferences`. Email, browser push, mobile providers, WebSockets, and reminder automation remain future phases. See [ADR-007](../adr/007-career-sources-notifications.md).

# ADR-005: Normalized jobs and explicit source ingestion

Status: Accepted. Date: 2026-10-01.

Keep jobs in the existing Node platform. Use a source-adapter interface, deterministic source-scoped IDs, and MongoDB upserts. A fixture adapter makes normalization/import testing deterministic; the first live adapter is Remotive's public remote-job feed. It is accessible without credentials and supplies stable IDs, job descriptions and source links.

Use global remote coverage initially, preserving each listing's geographic restrictions. Search supports literal keywords, company, location, skills, source, work mode and employment type with bounded pagination. Missing provider fields stay unknown; salary is source text, not an inferred numeric range. Convert descriptions to plain text and render them as text in React.

Job reads are public to honor the provider's ungated-access requirement. Attribute Remotive and link back to each original listing. Private user resources remain protected. ADMIN-only refresh and the local operator CLI share the same ingestion service and database cooldown; normal users cannot trigger provider requests. No arbitrary-URL fetching is introduced. At the user’s request, the API checks persisted due times every minute and refreshes Remotive every four hours, including an overdue refresh on startup. Restarting does not reset the clock; database cooldowns coordinate manual and scheduled imports. The scheduler stops and awaits in-flight work before database shutdown.

Validate the full batch before writes. Failed fetches and empty feeds do not erase existing jobs. Preserve creation timestamps during reimport, retain source identity, and do not deduplicate different providers by title alone. Source IDs may be reused only within their own namespace. A database failure may partially apply a bulk update; retrying is idempotent. Missing listings need a future explicit expiry/reconciliation policy, not deletion inferred from a potentially incomplete feed.

Manual provider-job editing/deletion, additional providers, advanced indexed search and source management remain later work. Saved jobs are the next planned batch. See the [API contract](../api/jobs.md).

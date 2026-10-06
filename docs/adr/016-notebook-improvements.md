# ADR-016: Notebook recovery, durable job tasks and workspace preferences

Status: Accepted. Date: 2026-10-07 (Asia/Kolkata).

The user approved implementing the notebook requests after clarifying seven-day
sessions, support-only recovery after bin expiry, and demo-only credits/payments.

- Keep existing absolute seven-day sessions and automatic restoration. Refresh
  and browser restart already restore valid sessions; no cache or expiry change.
- Node owns recoverable removal for original resumes, saved jobs and career
  sources/bookmarks. Keep file bytes/derived results. Default bin visibility is
  30 days, configurable for future removals; after expiry only audited ADMIN
  support routes restore retained records. Never purge as part of bin cleanup.
  Partial unique indexes allow active copies beside retained versions; conflicting
  restores return 409 without overwriting data. Historical hard-delete cleanup
  remains supported; already-erased data is not recreated.
- Python owns durable PostgreSQL job-analysis tasks and a modular worker. Node
  authorizes the owner/source, then returns accepted task ID. Preserve the shared
  generation slot, bounded queue, idempotency and owner-isolated safe history.
  Navigation stops polling only. Queued work can be cancelled; interrupted/running
  provider work is not automatically charged again after restart.
- Fill missing catalogue metadata deterministically with provenance. Keep
  ambiguity UNKNOWN and let skill search inspect descriptions. No AI ingestion.
  Source New/Earlier groups use immutable discovery time and owner view markers.
- Manual application progress/history stays distinct from saved interest. This
  extends saved jobs as a foundation; full application workflows stay Phase 3.
- Light/Dark/System is a browser preference. Settings credit figures are explicit
  samples; no ledger or payments. Status checks private dependencies without paid
  provider probes. Rename PostgreSQL's Compose service, preserving its data volume.
- External LinkedIn/contact/review research and published listing emails are
  available; native imports/enrichment require supported provider access. Google
  live consent needs credentials. Personalized AI preparation stays deferred.

This supersedes user-removal behavior in ADR-004/006/007/011 and browser-lifetime
job-generation behavior in ADR-012; it does not change historical hard erasure or
resume-generation cancellation. Contracts/limits: [notebook improvements](../notes-improvements.md).

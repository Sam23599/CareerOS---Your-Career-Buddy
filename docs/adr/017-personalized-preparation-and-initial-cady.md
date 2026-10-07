# ADR-017: Personalized preparation and initial Cady

Status: Accepted. Date: 2026-10-07 (Asia/Kolkata).

The user selected the original preparation → Cady sequence. Reuse shared intelligence.

- Preparation explicitly selects owned CV/current JD analyses, gap classifications,
  time/goal and model/reasoning. Missing evidence is not a demonstrated learning gap.
  Bound advice and validate requirement indexes, time, classification and coverage.
- Python owns numbered immutable plans and revisioned user review overlays in
  PostgreSQL. Reviews do not mutate original generation, CVs or profiles. Recovery
  retains plans; gateway checks hide removed sources, historical tombstones prevent
  late hard-delete writes and derived cleanup follows the original source.
- Extend the existing durable task worker now, with service-authenticated Node
  source checks before spending and saving. Preserve the shared slot, bounded queue,
  explicit queued cancellation and no automatic uncertain paid retry. Celery is a
  separately planned executor migration, not a prerequisite for this selected batch.
- Cady begins as a read-only authenticated assistant using one selected CV,
  optional profile skills and up to three current job analyses. Resolve authorized
  context through service boundaries, validate exact citation facts/source identity
  and keep conversation transient/bounded. Defer agents, retrieval, durable memory,
  browsing and mutation tools until their contracts are selected.
- Both use existing OpenAI capabilities, strict structured Responses, `store:false`,
  minimal projection and visible charge notice before explicit actions. Checks mock
  providers; live paid checks require separately scoped authorization. No new SDK/broker.

This supersedes personalized-AI deferral in ADR-016 and the earlier plan, preserving
Celery planning and other separately deferred notebook items. See [use and limits](../personalized-preparation.md).

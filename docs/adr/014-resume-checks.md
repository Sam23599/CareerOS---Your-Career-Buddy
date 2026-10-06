# ADR-014: Evidence-backed resume checks and preparation

Status: Accepted. Date: 2026-10-06 (Asia/Kolkata). Implements the Phase 2 batch 5
baseline after [ADR-013](013-cv-job-matching.md).

- Use deterministic checks on saved CV/JD analyses, with no new provider calls.
  Keep rules and orchestration in modular Python OOP services; shared AI infrastructure
  remains available to future features without becoming a dependency of this report.
- Support standalone resume checks and optional selected-job preparation through one
  authenticated Node route. Node resolves owner/source-bound inputs and optional
  self-reported profile skills; Python reads its own repositories and reuses matching.
- Version rules as `resume-checks-v1`. Treat missing draft sections as unrecognized
  facts, not proven PDF omissions. Separate warnings from optional suggestions,
  preserve parser warnings, quote observed facts and never fabricate absence evidence.
- Keep the existing skill-coverage score unchanged. Required/unspecified/preferred
  gaps reference matcher items; profile-only matches suggest evidence improvements.
  Ambiguous and non-skill requirements require human judgment.
- Literal job keyword mentions use exact CV page quotes and do not establish
  proficiency or change matching scores. Never label a CareerOS heuristic as a real
  employer ATS assessment, hiring probability or complete qualification evaluation.
- Generate action templates without inventing skills, metrics, dates or experience.
  Personalized AI learning plans remain separate work requiring advance AI notice.
- Offer an explicit resume-library check dialog and a job-page review action sharing
  existing version selectors. Use compact counts and native collapsible groups,
  accessible focus restoration and mobile wrapping. Input changes/errors clear results.
- Validate bounded generated contracts and source/evidence references in Node, then
  recheck source lifetime/job content/included profile revision. Retain equal owner
  isolation for ADMIN, stale rejection and expired-job reference labels.
- Limit private input to 16 KB/output to 2 MiB, fifteen seconds per upstream call,
  and sixty reviews/user/fifteen minutes separately from paid processing. Cancel
  disconnected requests; no automatic retry, stored reports, migration or cache.

See [use, rules, limits and verification](../resume-checks.md). Ranking and Cady remain
later batches; broader semantic/AI guidance is not implied by this baseline.

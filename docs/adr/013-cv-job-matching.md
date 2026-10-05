# ADR-013: Explainable CV-to-job matching

Status: Accepted. Date: 2026-10-06 (Asia/Kolkata). Implements Phase 2 batch 4 after
[ADR-011](011-structured-resume-drafts.md) and [ADR-012](012-job-description-analysis.md).

- Follow the roadmap's documented deterministic baseline first. Reuse saved AI
  analyses; comparison does not call a model or send CV/profile data externally.
- Keep matching in a modular Python OOP domain (`matching`) with thin controllers.
  Resolve exact owner/source-bound CV and job analyses through the existing private
  PostgreSQL repository interfaces. Node owns authentication/current inputs and
  supplies trusted references and an optional profile-skill snapshot.
- Expose explicit version selection on the existing job page. Profile skills are
  optional and self-reported; quoted CV evidence wins duplicate candidate labels.
  Other users' sources remain unavailable to ADMIN. Stale job analyses cannot be
  used, while expired unchanged listings are allowed for reference with a warning.
- Version the formula as `skill-coverage-v1`: unique exact/curated-alias skill and
  technology coverage, weighted required=3, unspecified=2, preferred=1. Round the
  weighted percentage half up. Missing scorable requirements return null.
  Ambiguous/negated claims and remaining requirement categories require human
  review and carry no score weight. Do not claim overall qualification, hiring
  probability, actual employer ATS behavior or semantic equivalence.
- Attach job, priority and CV evidence, selected source hashes/versions, analysis
  IDs/versions, matcher version and optional profile revision. Validate bounded
  schema/source/evidence/arithmetic in Node and recheck sources after processing.
  A concurrent source edit/deletion/profile revision rejects a stale response.
- Calculate on demand with no persistent match history, cache or migration. Reuse
  existing analysis deletion/tombstones. Any future cached/ranked match needs the
  complete input identity and fresh owner/lifetime checks.
- Bound trusted input to 16 KB, output to 2 MiB and each Node upstream request to
  fifteen seconds. Separate non-AI matching throttle: sixty/user/fifteen minutes. Ordinary
  platform routes remain usable if matching/intelligence is unavailable.

The intentionally conservative first score can undercount differently worded skills.
The UI explains the formula, reports missing fields and exposes evidence for review.
Semantic matching, ranking and preparation remain separate future work with advance
AI notification. See [setup, formula and checks](../cv-job-matching.md).

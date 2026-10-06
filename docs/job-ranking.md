# Saved-job ranking

Phase 2 batch 6 saved-job baseline, implemented 2026-10-06 (Asia/Kolkata).
See [ADR-015](adr/015-saved-job-ranking.md) and the [API](api/intelligence.md#saved-job-ranking).

## Use

Open `/saved-jobs`, apply optional status/priority filters, expand **Rank your
shortlist**, choose a PDF and a saved CV analysis, then **Rank saved jobs**.
Older CV analyses can be loaded. Profile skills are optional and off initially;
saved role/location/work-mode preferences are on initially.

Ranking covers **all pages of the applied filters**, up to 50 saved jobs. A larger
shortlist returns a clear limit error; narrow the filters instead of silently
ranking only the first page. The top five results appear first, with an option
to show all. Each row expands to coverage, missing skills, preference reasons,
profile-only skills, manual-review counts and a link to the existing job report.
Job reports have their own version selectors; use the same CV/JD versions shown
in the ranking when reviewing its evidence.

Jobs with missing/stale analyses, expired/unavailable listings, no scorable skill
requirements, or **Not interested** status appear separately with their reason.
An unanalysed job needs the existing **Analyze job** action before it can rank.
Those explicit prerequisite analyses retain their existing OpenAI costs.

Opening or running ranking makes **no new AI, embedding or external-provider
call**. Results are transient snapshots, not stored recommendations/history.
Changes to selection clear results; saved-job updates/removal on this page reset
ranking inputs/results. Closing the panel/navigation cancels pending work. Notes,
interest controls and unsaved-edit navigation protection retain their behavior.

## Ordering and interpretation

`saved-skill-coverage-v1` sorts by:

1. Existing rounded `skill-coverage-v1` percentage, descending. Its required /
   unspecified / preferred weights remain **3 / 2 / 1**, with existing aliases,
   deduplication and manual-review boundaries.
2. Count of matching configured role, location and work-mode preference categories.
   A category matches if any configured value matches. Role/location use NFKC,
   case/whitespace normalization and literal phrase boundaries; work mode uses
   the exact normalized catalogue enum. Missing listing data is **unknown**.
3. Saved priority: High, Medium, Low.
4. Most recent saved date, then job ID for stable ties.

For example, 80% coverage precedes 75%, even if the latter matches more preferences.
Two 75% jobs use preference matches first, then saved priority/date. Preferences
never alter the skill percentage. Empty preferences add no tie-breakers. This
does not infer equivalent job titles or geographical eligibility from phrases.

Salary, experience level, interests, company preferences and non-skill requirements
are outside this initial ordering. No company-preference profile field exists.
Missing evidence is not proof of lacking a skill. The score is not overall fit,
employer ATS performance or hiring likelihood; users review other requirements.

## Ownership, implementation and limits

Node owns shortlist and preference orchestration through `SavedJobRankingService`
and `SavedJobRanker`; it resolves one owned CV analysis and each job's newest
owner-scoped analysis for its current content hash. Python remains the sole skill
matcher through the existing private compare endpoint. No new Python module,
database table, migration, cache or duplicate matching rules are needed.

The existing gateway verifies each full matcher result against source-bound CV/JD
records and evidence before projecting its compact summary. Up to four jobs run
concurrently, with a 60-second whole-request deadline and the existing 15-second /
2 MiB limits per private response. The final compact response is also capped at
2 MiB; oversize results require narrower filters. Ten rankings/user/15 minutes are allowed in a
separate limiter. There is no automatic retry or background ranking.

Before returning, Node rechecks CV availability, shortlist membership/revisions
and job summaries, profile version when included, job-description hashes and
ranked-job expiration. Changes reject the snapshot; provider/storage failures
fail the request rather than returning a misleading partial order. All owner
checks apply equally to ADMIN. Source data can change after any snapshot is
returned; rerun ranking when inputs change elsewhere.

## Verification

Tests cover ordering/preferences, profile-only labels, strict input validation,
authenticated owner isolation, missing/stale/expired/unavailable/excluded jobs,
filters/limits, source races, bounded concurrency/cancellation and throttling.
Browser tests cover explicit execution, older-version selection, collapsed/mobile
results, errors/retry, cancellation and preservation of private-note editing.
See test files `ranking.test.ts`, `ranking.integration.ts` and `ranking.spec.ts`.

Verified locally on 2026-10-06:

- `npm test`: 66 Node unit/API tests passed, including four ranking rule tests.
- Ranking, matching, reviews and saved-job Mongo integration files: 20 tests
  passed, including seven ranking tests. Temporary databases/PDF directories were
  removed. These use a fixture intelligence client, not a live provider.
- Ranking, matching, resume-checks and saved-job browser files: nine tests passed,
  including three ranking tests. Ranking uses mocked authenticated responses;
  existing saved-job journey checks also exercise the running API.
- Workspace builds/type checks, lint and `git diff --check` passed. Desktop/mobile
  ranking screenshots were inspected, including 375-pixel wrapping. The existing
  Python matcher/provider code is unchanged; no paid calls were made.

Node/web use existing Compose source mounts and reload these changes. No new
configuration or database migration is needed; preserve existing data volumes.

Next: [personalized preparation plan](personalized-preparation-plan.md), followed
by initial Cady in the original roadmap. That plan does not enable paid processing.

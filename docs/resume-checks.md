# Resume checks and job preparation

Phase 2 batch 5 baseline, implemented 2026-10-06 (Asia/Kolkata).
See [ADR-014](adr/014-resume-checks.md) and the [API](api/intelligence.md#resume-checks-and-preparation).

## Use locally

No additional credentials, dependencies or database migration are needed.
Rebuild Python with `docker compose up -d --build --wait intelligence`; Node and web
source changes reload in the existing local Compose stack. Keep existing volumes.

- **Resume library:** open `/resumes` → **Check resume** → select a saved CV analysis
  → **Run resume checks**. Load older analyses when needed. If there is no saved
  analysis, **Open resume draft** leads to the existing analysis workflow.
- **Selected job:** open a job → choose PDF, CV analysis and current job analysis
  in the comparison panel → **Review fit & gaps**. Including profile skills is
  optional. The same action returns the existing skill-coverage comparison plus
  resume findings, preparation actions and job terminology checks.
- **Review fit & gaps** includes the skill comparison and resume checks. Report groups
  and their evidence are collapsed initially. Open a group, then a finding to read
  its action and quotes. Counts and section labels provide an overview.
- Changing any selected input clears the prior result. Refresh reloads available
  saved versions. Check/review failures clear the report and keep selections for a retry. Closing
  the resume dialog or navigating away cancels pending work and discards the report.
  Escape closes the dialog and returns keyboard focus to the opening control.

Opening either interface does not generate an analysis or run a check automatically.
This feature makes **no new LLM/embedding/external-provider call**. Prerequisite
**Analyze resume/job** actions retain their existing OpenAI processing and costs.
Checks leave original PDFs, saved analyses, profiles and jobs unchanged. Reports
are computed on demand and are not stored as new versions/history.

## Rules: `resume-checks-v1`

Six recognized-section indicators summarize the selected saved draft. They are
a checklist, not an ATS percentage or an overall qualification score.

| Check | Interpretation and action |
| --- | --- |
| Name | Warn when the draft has no recognized full name; check readability in the PDF |
| Contact | Warn only when neither email nor phone was recognized; either one is sufficient |
| Summary | Suggest a concise, truthful summary if relevant; it is optional |
| Skills | Count explicit skills/technologies and work/project skill facts; profile-only skills do not fill this CV section |
| Work experience | Recognize an entry with a role or company; early-career users may appropriately rely on projects/education |
| Education | Recognize an institution or qualification; absence is an optional suggestion |
| Incomplete work context | Suggest review when a recognized work entry lacks a role or company; cite recognized work facts |
| Achievements | Suggest reviewing work descriptions when no achievement facts were recognized; never invent metrics or outcomes |
| PDF reading warnings | Preserve the saved parser warning/message before optional findings; compare reading order/text with the PDF |

“Not recognized” means absent from the **saved analysis**, not necessarily absent
from the original PDF. Missing facts have no fabricated quotes; findings identify
the checked draft fields. Observed facts use selected-CV page evidence. Parser
warnings refer to saved extraction metadata. Heuristics do not inspect the visual
layout, diagnose actual ATS parsing, assess spelling, infer dates/years or create
new qualifications.

## Job-specific preparation and terminology

The existing [matching rules](cv-job-matching.md) and `skill-coverage-v1` formula
remain unchanged. Preparation actions reference comparison item indexes, so every
action retains its exact job requirement and priority evidence.

1. Required skills not found appear first, then unspecified and preferred skills.
   Check whether the skill is already known before calling it a learning gap. If
   true, document a work/project example; otherwise review fundamentals and practise
   a small project before claiming it.
2. A profile-only match is an **evidence gap**, not a claim that the user lacks the
   skill. Suggest adding a concrete CV example only if accurate. Its profile source
   remains explicitly self-reported.
3. Ambiguous, negated, conflicting and non-skill requirements stay separate for
   human judgment. This report does not decide years of experience, eligibility,
   education equivalence, compensation suitability or semantic role alignment.
4. Job-analysis keywords are checked as literal phrases against saved extracted CV
   pages. Comparison ignores case and whitespace differences, deduplicates repeated
   phrases and respects word/technology boundaries (Java is not JavaScript, C is not
   C++/C#, Node is not Node.js). Found phrases carry one exact page quote. A phrase
   mention does not count as skill evidence or affect the skill score. No keywords
   produces an explicit empty checklist, not an invented coverage percentage.

The first version uses general, evidence-bound action templates, not personalized
courses, resource links, generated exercises or a new overall ATS score. Optional
OpenAI preparation plans require a separate scope/model/data/cost discussion before
implementation or live calls. Ranking is the next planned batch; Cady follows.

## Architecture and safeguards

- Python `app/reviews/` owns typed models, OOP resume/keyword rules, preparation
  planning and repository orchestration. The service uses owner-scoped saved
  PostgreSQL CV/JD records and reuses the existing matcher. It has no LLM dependency.
- Node owns session authorization, exact PDF/CV/JD lookup and optional profile-skill
  snapshots. It forwards trusted references rather than browser text, owner IDs,
  skills, file URLs or provider credentials. Python has no MongoDB/PDF-volume access.
- Node validates the generated Pydantic schema, selected source versions, observed
  CV evidence, saved parser warnings, keyword provenance/quotes, preparation indexes
  and existing comparison arithmetic. It rechecks resume lifetime, job hash and
  included profile revision after processing. ADMIN has the same ownership rules.
- Stale JD analyses are rejected. Expired unchanged listings remain reference-only
  with a visible warning. Deleted/foreign sources and concurrently changed inputs
  cannot produce a current report.
- Private input is limited to 16 KB; report output to 2 MiB, including keyword
  quotes. Each upstream request has a fifteen-second deadline. Reviews have a
  separate sixty-attempts/user/fifteen-minute allowance and do not consume paid
  analysis/extraction attempts. Requests can be cancelled; no automatic retries.
- No persistence migration, queue, cache, stored report or provider requirement is
  added. Ordinary Phase 1 routes remain usable if intelligence is unavailable.

## Verification commands

```sh
docker compose --profile test run --rm --build intelligence-tests
npm test
TEST_MONGODB_URI=mongodb://127.0.0.1:27019 node --import tsx --test backend/platform/test/reviews.integration.ts backend/platform/test/matching.integration.ts backend/platform/test/drafts.integration.ts backend/platform/test/job-analysis.integration.ts
npx playwright test frontend/web/e2e/resume-checks.spec.ts frontend/web/e2e/matching.spec.ts frontend/web/e2e/resumes.spec.ts frontend/web/e2e/job-analysis.spec.ts
backend/intelligence/.venv/bin/python scripts/export-draft-schema.py --check
npm run lint
npm run typecheck
npm run build
```

Use the MongoDB host port configured in your local environment; this workspace uses
27019. Integration tests create/remove unique temporary databases and PDF directories.
Python runs parser/resource and PostgreSQL checks in Linux; generation is mocked.
Browser checks use synthetic saved analyses and mocked endpoints, without AI calls.

## Verification recorded — 2026-10-06

- The Linux intelligence suite passed 111 checks. A later focused review run passed
  all sixteen checks, including the added real PostgreSQL/private-route test for
  saved records after restart, foreign owners and deleted sources.
- All 62 Node unit/API checks and 23 focused MongoDB gateway checks passed. Coverage
  includes strict inputs, exact source versions, malformed evidence/preparation,
  owner isolation for ADMIN, stale listings, expired reference labels and source/
  profile changes during review. Temporary test databases/files were removed.
- Seven distinct Chromium flows passed across the final focused runs: three new
  resume-check flows, two existing matching flows, job analysis and resume management.
  New checks cover explicit actions, old-version selection, compact default groups,
  profile evidence gaps, failure/retry, stale rejection, 375px wrapping, pending-request
  cancellation, Escape and focus restoration. Desktop/mobile reports were inspected.
- ESLint, both workspace type checks/builds, all four generated-schema checks and
  `git diff --check` passed. No paid generation was used for verification.
- Python intelligence was rebuilt/reloaded. All five ordinary local Compose services
  were healthy afterward; existing MongoDB/PDF/PostgreSQL volumes were retained.

# CV-to-job matching

Phase 2 batch 4 implements the original plan's explainable, deterministic baseline.
It compares saved, source-verified AI analyses. Matching itself makes no LLM,
embedding or external provider call, needs no new key and incurs no AI charge.
Generating the prerequisite resume/job analyses still uses the existing explicit
OpenAI actions and their documented charges. See [ADR-013](adr/013-cv-job-matching.md).

## Try it

1. Analyze a text PDF from **Your resumes** and analyze a job from its detail page.
2. On that job, use **Compare your CV to this job**. The active PDF is selected
   initially; choose any owned PDF and saved CV/job analysis versions. Older
   versions load through the existing paginated history without generation.
3. Optionally include saved profile skills. These are labelled self-reported;
   CV evidence takes precedence when the same skill appears in both.
4. Click **Compare CV to job**. Review skill coverage, matched skills, skills not
   found and other requirements. Expand evidence to see the exact job quotation,
   priority quotation and resume page quotation.
5. Changing any selection clears the result. **Refresh comparison inputs** loads
   updated histories. Successful job analysis refreshes these inputs automatically.

Missing analyses explain which action is needed. Failed matching does not generate
analyses or change data. Expired but unchanged jobs can be compared for reference
with a visible warning. Stale job analyses are disabled and rejected server-side;
analyze the current listing first. Deleted/foreign resumes, analyses and missing jobs
are unavailable, including for ADMIN. A concurrent job/profile edit or resume
deletion rejects the result. Comparisons use immutable selected analyses, not an
unannounced replacement by a newer version.

## Score contract: `skill-coverage-v1`

This is **skill coverage**, not an overall suitability score, employer ATS score or
hiring probability. All other requirements remain visible for human review.

| Requirement priority | Weight |
| --- | --- |
| Required | 3 |
| Unspecified | 2 |
| Preferred | 1 |

`score = round_half_up(100 × matchedWeight / totalWeight)`

Only structured job skills/technologies count. Repeated normalized skills count
once, using the strongest priority, even across both sections. Candidate evidence
comes from CV skills/technologies and skills explicitly listed under experience or
projects; summary, keyword and responsibility mentions are not treated as skills.
Optional profile skills count with an explicit self-reported label.

Comparison uses Unicode NFKC, case folding, collapsed whitespace and these fixed
aliases: JS/JavaScript, TS/TypeScript, React.js/ReactJS/React, Node.js/Node JS/NodeJS,
Postgres/PostgreSQL, Amazon Web Services/AWS, Google Cloud Platform/GCP, and
continuous integration/continuous delivery/CI/CD. Punctuation otherwise remains
significant: C, C++, C#, Java and JavaScript are distinct. No fuzzy substring or
semantic equivalence is inferred.

Compound/prose requirements (such as “Python or Java” or “experience with Python”),
possible negation in source evidence, and requirements overlapping an analysis
ambiguity/conflict warning need review and receive zero weight. These conservative
English checks do not resolve all natural-language ambiguity. Experience, education,
certifications, languages, eligibility, application requirements, other requirements,
location, work mode, employment type and compensation also need review and are not
scored. No years are invented, overlapping experience is not summed and remote work
does not imply worldwide eligibility. Missing job fields are listed as not stated.
If there are no scorable requirements, the score is null rather than an invented 0%.
“Not found” means absent from the chosen inputs; it does not prove the user lacks a skill.

## Service and storage boundaries

- `app/matching/` owns models, normalization, scoring and repository orchestration.
  It has no LLM dependency. The private controller authenticates before reading a
  maximum 16 KB JSON body and honors cancellation.
- Node authenticates the session, resolves/validates selected owner-scoped analyses,
  hashes current sources and supplies only their trusted references plus optional
  profile version/skills. Python reads its own PostgreSQL repositories. Node does
  not query PostgreSQL and Python does not query MongoDB.
- Node validates the generated matching JSON schema, source IDs/hashes/versions,
  job/CV evidence, profile claims and score arithmetic, then rechecks source lifetime
  and profile revision. The shared upstream response bound is 2 MiB with a fifteen
  second deadline. Oversized comparisons fail instead of returning partial scores.
- Matching has a separate allowance of sixty attempts per user per fifteen minutes;
  it does not consume the ten-attempt paid analysis/extraction allowance.
- Scores are computed on demand and shown in the page only. No new match table,
  cache, profile write, original-document write or persistent match history is added.
  Results identify matcher version, PDF hash/version, exact CV/job analysis IDs and
  versions, job content hash and optional profile revision. Future ranking/cache work
  must use this full identity and current authorization, not just a job ID.

Ranking, embeddings, semantic scoring, ATS checks, preparation recommendations and
Cady remain their later planned batches. Notify the user before any new AI stage.

## Verification

Regular verification uses synthetic fixtures and mocked generation, with no paid calls:

```bash
docker compose --profile test run --rm --build intelligence-tests
npm run lint
npm run typecheck
npm test
npm run build
backend/intelligence/.venv/bin/python scripts/export-draft-schema.py --check
TEST_MONGODB_URI=mongodb://127.0.0.1:27019 node --import tsx --test backend/platform/test/matching.integration.ts
npx playwright test frontend/web/e2e/matching.spec.ts frontend/web/e2e/job-analysis.spec.ts frontend/web/e2e/jobs.spec.ts frontend/web/e2e/drafts.spec.ts
```

MongoDB/PostgreSQL tests create and remove their own temporary databases and files;
they do not delete application data. Use your configured host MongoDB port in the
integration command.

## Verified locally — 2026-10-06

- All 96 Python checks passed in Linux Docker, including matching from exact saved
  PostgreSQL versions after restart, owner isolation and source deletion.
- All 58 Node checks and 31 focused MongoDB gateway checks passed, covering new
  comparisons and existing resume/extraction/job-analysis workflows.
- Six Chromium flows passed: two new matching flows, job analysis, two job browsing
  flows and resume draft review. Matching checks cover explicit clicks, older
  versions, quoted evidence, profile supplementation, missing/stale inputs and 375px
  mobile layout. The browser's comparison endpoints were mocked.
- ESLint, both TypeScript checks, both builds, all three generated-schema checks
  and whitespace checks passed.
- A real local Node → Python → PostgreSQL comparison succeeded with existing
  saved analyses, both with and without profile skills. No analysis was generated,
  no paid provider call occurred, and career data was not modified. The smoke
  sign-in session was signed out afterward.
- Intelligence was rebuilt/restarted; all five normal services report healthy.
  Existing volumes and the Git index were preserved. Changes remain unstaged.

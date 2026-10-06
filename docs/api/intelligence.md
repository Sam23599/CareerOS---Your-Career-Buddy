# Intelligence API — Resume and job analysis

Status: Batches 1–3 implemented locally, 2026-10-05. Extraction is transient; saved structured drafts require explicit review before profile updates. See [ADR-010](../adr/010-resume-intelligence-foundation.md) and the [Phase 2 backlog](../phase-2-backlog.md).

## Browser gateway

Both routes require the normal CareerOS Bearer access token and USER/ADMIN role. ADMIN does not bypass resume ownership. Responses use `Cache-Control: no-store`; errors use the [existing envelope](health.md).

| Endpoint | Request | Result |
| --- | --- | --- |
| `GET /api/v1/intelligence/status` | None | `{ "resumeExtraction": { "configured": true, "available": true } }`; expose no internal URL/token |
| `POST /api/v1/intelligence/resumes/:id/extract` | `Content-Type: application/json`, body `{}` | Owner-checked text preview, status 200 |

`configured: false` means no service URL/token pair is configured. `available: false` means the configured service did not pass its bounded readiness check. This status never replaces authorization on extraction requests or changes ordinary Node/MongoDB readiness.

The extraction route accepts only a resume ID and empty body. Reject owner IDs, file paths, arbitrary URLs and document text in the browser body. Node resolves an immutable owned PDF, calculates its SHA-256, forwards bytes to Python and rechecks that the same owned version remains available before returning it.

```json
{
  "schemaVersion": 1,
  "source": {
    "resumeId": "owned-resume-uuid",
    "resumeVersion": 2,
    "sha256": "64-lowercase-hex-characters"
  },
  "parser": { "name": "pypdf", "version": "installed-version" },
  "status": "extracted",
  "pageCount": 1,
  "pages": [{ "number": 1, "text": "Example resume text" }],
  "text": "Example resume text",
  "warnings": []
}
```

`status` is `extracted` or `no_text`; use `no_text` when no page contains non-whitespace text. Pages are ordered, numbered from 1 and include empty pages. Combined text joins page strings with `\n\n`. Preserve extracted wording; normalize line endings to `\n` and remove null characters only. The character budget includes page separators. Do not infer skills or modify the profile in this endpoint.

Warnings have `{ "code", "message" }`. A completely empty extraction uses `NO_EXTRACTABLE_TEXT`, explaining that a scanned or blank PDF may contain no readable text. Empty pages in an otherwise readable document use `PAGES_WITHOUT_TEXT`; do not imply all resume content was recovered. A general layout caveat belongs in the preview UI, since correct reading order cannot be guaranteed.

Known structural repairs add `PDF_STRUCTURE_REPAIRED`: “Minor PDF structure issues were corrected during extraction. Review the text against your original PDF.” The pinned parser currently allows only nonzero xref indexing and extra object-header whitespace. Repeated repair warnings become one fixed message, without document values or exception details. It can accompany either empty-text warning; responses contain at most two distinct warnings. Unknown warnings or warnings about unreadable/skipped content still fail with `INVALID_PDF`. The preview displays these warnings above the page text.

Results are transient, not analysis records. Render text safely. No public PDF URLs, storage paths or service credentials appear in the result.

## Internal Python contract

`POST /internal/v1/resumes/extract` accepts raw `application/pdf`, a dedicated Bearer service token and `X-Request-Id`. Node supplies no user JWT. Python returns the same extraction fields except `source`, which Node derives from its trusted resume read.

Python reads at most 5 MiB and enforces ADR-010's page, character, output, concurrency, time and memory limits. Parse only after service authentication. Reject remote-URL/path/body metadata inputs. On timeout, disconnect or shutdown, stop and reap the parser process and discard in-memory bytes/output. Do not log PDF text or raw parser exception contents.

Readiness has a two-second gateway budget. Python liveness is `GET /internal/v1/health`; service-authenticated readiness is `GET /internal/v1/ready`. Readiness checks configured credentials, parser availability and enforceable worker bounds. They have no database dependency in this first batch.

## Error mapping

Node attaches its request ID and safe message. Do not proxy Python response bodies blindly. Invalid internal service credentials are an upstream configuration error to the browser, not a CareerOS sign-out.

| Browser HTTP/code | Meaning |
| --- | --- |
| 400 `INVALID_INPUT` | Invalid resume ID or nonempty extraction request body |
| 401 `UNAUTHENTICATED` | Missing/expired/revoked CareerOS session |
| 403 `FORBIDDEN` | Missing permitted role |
| 404 `RESUME_NOT_FOUND` | Missing/foreign/deleting source, including a deletion during extraction |
| 413 `EXTRACTION_LIMIT` | Input/page/text/output limit exceeded |
| 415 `JSON_REQUIRED` | Browser request uses the wrong content type |
| 422 `INVALID_PDF` / `PDF_ENCRYPTED` | Stored PDF cannot be parsed or requires a password |
| 429 `RATE_LIMITED` | Per-user request allowance exhausted; include Retry-After |
| 502 `INTELLIGENCE_RESPONSE_INVALID` | Unexpected upstream status, schema or inconsistent page/text data |
| 503 `INTELLIGENCE_UNAVAILABLE` | Missing configuration, unreachable service, bad service credentials or failed readiness |
| 503 `INTELLIGENCE_BUSY` | Parser slot already occupied; include Retry-After |
| 503 `PARSER_RESOURCE_LIMIT` | Worker could not complete within its memory/resource bound |
| 504 `INTELLIGENCE_TIMEOUT` | Parser or upstream deadline exceeded |

Python uses the corresponding parser/input codes, with 401 for bad service credentials and 415 for non-PDF input. Node should never send those requests; translate those internal failures to `INTELLIGENCE_UNAVAILABLE` or `INTELLIGENCE_RESPONSE_INVALID` as appropriate. A valid `no_text` response is 200, not a parser exception.

Service responses must have the expected schema/parser/status, bounded strings, consecutive page numbers and a consistent page count/combined text. Unknown fields or inconsistent output are rejected. Repeated extraction requests do no persistent writes and receive no automatic retry or cache in batch 1.

## Local setup and checks

See [resume intelligence development](../intelligence-development.md). The supported parser runs in Linux Docker; the default Compose service has no published host port. fontTools supports embedded CFF Type1 font encodings and is checked during readiness. pypdf warnings indicating skipped or damaged content reject the entire result rather than returning a partial success. Library decompression limits also map to `EXTRACTION_LIMIT`.

## Structured resume drafts

Implemented in batch 2; see [ADR-011](../adr/011-structured-resume-drafts.md). The extraction contract above remains stateless and unchanged.

| Browser endpoint | Input/result |
| --- | --- |
| `GET /api/v1/intelligence/capabilities` | Safe availability, provider/model/reasoning choices, defaults and input/output/time limits; no secrets or internal endpoints |
| `POST /api/v1/intelligence/resumes/:id/analyze` | JSON `{ "model": "gpt-6-luna", "reasoning": "medium" }`; validated saved `DraftRecord` |
| `GET /api/v1/intelligence/resumes/:id/draft` | Latest draft for the owned available source/version/hash; no generation; 404 `ANALYSIS_NOT_FOUND` if absent |
| `GET /api/v1/intelligence/resumes/:id/draft?analysisId=draft-uuid` | One owned saved version for the current source; no generation |
| `GET /api/v1/intelligence/resumes/:id/drafts?beforeVersion=21` | `{ versions: [{ id, version, model, reasoning, createdAt }], nextBeforeVersion }`; newest first, at most twenty; cursor optional, null when complete |
| `POST /api/v1/intelligence/resumes/:id/draft/apply` | JSON `{ "analysisId": "draft-uuid", "patch": { "version": 0, "headline": "Reviewed headline" } }`; `{ profile }` |

All routes use existing JWT/role/owner rules. Foreign, missing or deleting sources return 404, including for ADMIN. Analyze accepts exactly `model` and `reasoning`; GPT-4.1 requires `reasoning: null`. Use only compatible options from capabilities. Unsupported IDs/options and caller-supplied owner/text/URL fields return 400. Analyze shares extraction's ten-attempts/user/15-minute limit; no automatic retries.

Every successful Analyze saves an immutable `version` (1, 2, …) per owned resume, even with identical model/settings. This counter is separate from the PDF's `source.resumeVersion`. Failures do not save a version. History contains metadata only; fetch an individual ID for its full draft. Unknown/repeated query fields, invalid UUIDs and nonpositive/noninteger/out-of-range cursors return 400. Reads apply no profile changes and make no provider call.

The complete bounded result schema is [generated from Python](../../backend/platform/src/intelligence/resume-draft.schema.json). A record includes schema/version/id/status, source `{ resumeId, resumeVersion, sha256 }`, analyzer/provider/model/reasoning, token usage, creation time, extraction pages/warnings and the rich draft. Each scalar fact is `{ value: "copied text" | null, evidence: [{ page, quote }] }`; known values require valid exact quotes and copied values, unknown values use empty evidence. Arrays are empty when absent. Source dates retain their original wording/precision. Lists and strings are bounded. This is extracted information, not a resume/JD evaluation or employer ATS score.

Apply accepts only an owned saved draft ID bound to the current source/version/hash and a reviewed profile patch. Supported fields: fullName, headline, summary, location, phone, skills, experience, education, certifications, links. Existing [profile validation](profiles.md) and `version` compare-and-set apply; a stale profile returns 409 `PROFILE_CONFLICT`, an unavailable draft ID returns 409 `DRAFT_CHANGED`. Import resolves the exact reviewed ID; a newer draft from another model does not invalidate it. Profile arrays replace the selected field; the UI includes existing rows and appends deduplicated suggestions before confirmation. Projects/email/languages/preferences/other unsupported imports are rejected. User corrections need not be verbatim source facts; they are explicit manual profile edits. No fields apply on generation or GET.

Internal routes use the dedicated service token, never user JWTs:

- `GET /internal/v1/capabilities` describes analysis configuration independently of ordinary parser readiness.
- `POST /internal/v1/resumes/analyze` receives raw PDF bytes and trusted headers `X-Owner-Id`, `X-Resume-Id`, `X-Resume-Version`, `X-Source-Sha256`, `X-LLM-Model`, optionally `X-LLM-Reasoning`. Python checks UUIDs, model options and the bytes' hash before analysis. Node derives this context; browser headers are not forwarded.
- `GET /internal/v1/resumes/:id/draft` receives the same owner/source/version/hash context and returns only that namespace's record. Node supplies `X-Analysis-Id` internally for exact-version viewing/import; otherwise GET returns the latest source draft.
- `GET /internal/v1/resumes/:id/drafts?beforeVersion=21` receives that same trusted context and returns a bounded history page; the optional cursor excludes versions at or above it.
- `DELETE /internal/v1/resumes/:id/draft` receives trusted owner/ID context, atomically deletes that source's drafts and adds a minimal deletion tombstone; repeat deletion is idempotent and returns `{ "status": "deleted" }`.

PostgreSQL stores only derived drafts. Records retain owner, source ID/version/hash, analyzer version, model and reasoning. Fresh successful analyses get unique consecutive versions under a per-owner/resume transaction lock. No failed/refused/partial outputs are persisted. Deletion first hides the source and queues durable MongoDB cleanup; retry every 30 seconds while Node runs. Downstream failure does not keep deleted PDFs publicly accessible; a late generation cannot recreate a tombstoned source. There is no cross-database transaction.

AI limits: 60,000 input bytes including instructions/schema, 16,384 output tokens, 90 seconds, one active generation/no queue. Node's analyze deadline is 140 seconds, response cap 2 MiB. Extraction retains its existing bounds. Analyze sends extracted text to OpenAI explicitly; GET/opening a draft never calls OpenAI. `store: false` is used but provider abuse-monitoring retention may still apply.

Additional safe errors: 413 `LLM_BUDGET_LIMIT` for configured input/output limits; 422 `NO_EXTRACTABLE_TEXT` or `LLM_REFUSED`; 429 `LLM_RATE_LIMITED`; 502 `LLM_RESPONSE_INVALID` for invalid evidence/schema or incomplete output; 503 `ANALYSIS_UNAVAILABLE` for storage/provider configuration/failure; 504 `LLM_TIMEOUT`. Browser response messages never contain raw provider/document errors. Model availability depends on the key's access; there is no silent fallback.

## Job-description analysis

Implemented in batch 3, 2026-10-05. See [ADR-012](../adr/012-job-description-analysis.md) and [local use/checks](../job-description-analysis.md).

| Browser endpoint | Contract |
| --- | --- |
| `GET /api/v1/intelligence/jobs/capabilities` | Same safe model/reasoning/default/limit fields as resume capabilities; availability depends on analysis storage/provider, independently of PDF parsing |
| `POST /api/v1/intelligence/jobs/:id/analyze` | JSON `{ model, reasoning }`; `{ analysis: JobAnalysisRecord, sourceStatus: { stale: false, expired: boolean } }` |
| `GET /api/v1/intelligence/jobs/:id/analysis` | Latest current-content analysis, or latest saved analysis explicitly marked stale; no generation |
| `GET /api/v1/intelligence/jobs/:id/analysis?analysisId=uuid` | One saved version for this account/job, including old content with `sourceStatus.stale: true` |
| `GET /api/v1/intelligence/jobs/:id/analyses?beforeVersion=N` | `{ versions: [{ id, version, model, reasoning, createdAt, sourceHash, stale }], nextBeforeVersion }`; newest first, twenty per page |

All routes require the existing JWT and USER/ADMIN role. Catalogue jobs are public, but saved analyses are private to each account; ADMIN does not read another user's analysis. IDs are lowercase 64-hex job IDs, not resume UUIDs. Unsupported IDs/model/settings, owner/text/URL payload fields and arbitrary/repeated query fields return 400. Analyze shares the existing combined ten-processing-attempts/user/fifteen-minutes allowance with PDF extraction and resume analysis. Generation starts only on explicit clicks and makes no profile/job changes.

Node builds `source = { jobId, normalizerVersion: "job-source-v1", sha256, sections }`, with sections in order: title, company, location, description. Sections are already plain text; normalize CRLF/nulls and trim edges without truncating. SHA-256 hashes the UTF-8 `JSON.stringify({ normalizerVersion, sections })` payload; Python uses equivalent compact Unicode JSON. Import timestamps are excluded. Analysis records contain source text, schema/analyzer/provider/model/reasoning, token usage, timestamp, UUID, sequential per-account/job version and the typed analysis. The [generated schema](../../backend/platform/src/intelligence/job-analysis.schema.json) is checked alongside the resume schema.

Known facts use `{ value, evidence: [{ section, quote, start, end }] }`, with exact quotes and copied values. Offsets are zero-based, end-exclusive Unicode code-point positions in that saved section. Python computes offsets from quotes; Node validates them. Unknown scalars use null/empty evidence and absent lists stay empty. Requirement rows additionally include `priority: required | preferred | unspecified` and `priorityEvidence`. Priority comes from conservative explicit English cues/headings, not an unrestricted model judgment. Fixed ambiguity/possible-conflict warning messages have verified evidence. Original date/experience/salary wording is retained.

After processing/reads, Node rechecks source existence/content. Changed content during a request returns 409 `JOB_CHANGED`; later reads of old results use `sourceStatus.stale: true`. Future matching must require a current source-bound result. Expired listings return 409 `JOB_EXPIRED` on Analyze, but saved GET/history remains available and the status is labelled expired. Empty descriptions return 422 `JOB_TEXT_EMPTY`. Missing catalogue records or foreign/unavailable analysis IDs return 404 `JOB_NOT_FOUND` / `JOB_ANALYSIS_NOT_FOUND`. Provider/storage/budget/busy errors keep the existing fixed mappings; UI failures retain the previous displayed record.

Private Python endpoints mirror analyze/analysis/analyses/capabilities under `/internal/v1/jobs/`. They require the service Bearer token and validated `X-Owner-Id`; GET uses trusted `X-Source-Sha256` and optionally `X-Analysis-Id`. Analyze receives the bounded source JSON and compatible `X-LLM-Model` / optional `X-LLM-Reasoning`. No user JWT, CV/profile content or arbitrary fetch URL is forwarded. `DELETE /internal/v1/jobs/:id/analysis` performs idempotent account/job cleanup and adds a minimal deletion tombstone. It has no public delete route.

Saved rows live in PostgreSQL `job_analyses`, with private owner/job versions assigned under the same lock as deletion. Node tracks cleanup references in MongoDB `job_analysis_sources` before generation; scans up to twenty-five references every thirty seconds while running, retaining failed cleanup work for restart/retry. Hard removal blocks access immediately; expiry retains analyses. Resume/job generation shares one active slot with no queue, and PDF extraction retains its separate worker bound. Normal reads never call OpenAI; automatic provider refreshes never analyze job descriptions.

## CV-to-job matching

`POST /api/v1/intelligence/jobs/:id/match` requires a current USER/ADMIN JWT and JSON:

```json
{
  "resumeId": "owned-pdf-uuid",
  "draftId": "owned-saved-cv-analysis-uuid",
  "jobAnalysisId": "owned-saved-job-analysis-uuid",
  "includeProfileSkills": false
}
```

All four fields are required; UUIDs must be valid. Extra fields/query parameters,
browser owner IDs, source text, skills, profile revisions and URLs are rejected.
Node resolves authoritative context; ADMIN cannot use another account's CV or analyses.

The response is `{ match: MatchResult, sourceStatus: { expired: boolean } }`. The
[generated schema](../../backend/platform/src/intelligence/matching.schema.json)
defines source IDs/hashes/versions, `matcherVersion: skill-coverage-v1`, nullable
integer `score`, `matchedWeight`, `totalWeight`, comparison `items` and `notStated`.
Each item contains a quoted/priority-backed job requirement, category, status
(`matched`, `not_found`, `needs_review`), score weight and optional candidate value
with resume page evidence or an explicit self-reported profile source.

Scoring covers deduplicated exact/curated-alias skills and technologies only:
required=3, unspecified=2, preferred=1; matched points/total points × 100 rounded
half up. Unknown, ambiguous and other requirement categories remain visible for
review outside the score; no scorable requirements gives null. See the complete
[formula and limits](../cv-job-matching.md). This is not a hiring probability or
employer ATS score. Matching makes no provider call and persists no new record.

Foreign/missing/deleting resumes and missing analyses return the existing 404
codes. Stale job analyses return 409 `JOB_ANALYSIS_STALE`. Job edits during work
return 409 `JOB_CHANGED`; included profile revision changes return 409
`MATCH_SOURCE_CHANGED`. Expired unchanged jobs return a labelled comparison for
reference. Other failures use existing private-service/storage mappings. Matching
has its own sixty-attempts/user/fifteen-minute throttle with Retry-After; the paid
processing allowance is unchanged. Response cap is 2 MiB; the upstream deadline
is fifteen seconds. No automatic retry or regeneration occurs.

`POST /internal/v1/matching/compare` is service-token authenticated and receives
trusted `X-Owner-Id`, JSON `{ resume: { resumeId, resumeVersion, sha256 }, draftId,
jobId, jobHash, jobAnalysisId, profile: null | { version, skills } }` (maximum 16 KB).
Python reads exact IDs in that owner/source namespace from its PostgreSQL
repositories and rejects changed inputs. It receives no user JWT, MongoDB
connection, original PDF, external URL or OpenAI credential for this request.
Node independently validates result schema, identity, evidence and arithmetic,
then rechecks source availability/current content and optional profile revision.

## Resume checks and preparation

Batch 5 baseline, 2026-10-06. See [ADR-014](../adr/014-resume-checks.md) and
[use/rules/limits](../resume-checks.md). No new AI call or saved report.

`POST /api/v1/intelligence/resumes/:id/review` requires a CareerOS USER/ADMIN session
and JSON with exactly these keys:

```json
{
  "draftId": "owned-saved-cv-analysis-uuid",
  "job": null
}
```

For a job-specific report, replace `job: null` with:

```json
{
  "jobId": "catalogue-job-64-character-hex-id",
  "jobAnalysisId": "owned-saved-job-analysis-uuid",
  "includeProfileSkills": false
}
```

No query parameters or caller-supplied owner, source text, profile skills/revisions,
hashes, model settings or URLs are accepted. Node resolves the exact owned PDF and
saved analyses plus an optional authoritative profile snapshot.

Response: `{ report: ReviewReport, sourceStatus: { expired: boolean } }`.
The [generated schema](../../backend/platform/src/intelligence/resume-review.schema.json)
defines `schemaVersion: 1`, `reviewerVersion: resume-checks-v1`, PDF identity/hash,
selected CV ID/version, six recognized-section checks, findings, optional existing
`MatchResult`, preparation references and keyword checks. Standalone reports return
`match: null`, empty preparation/keywords and `expired: false`.

Findings contain code, warning/suggestion severity, title, message, action, checked
draft fields and exact observed-CV evidence. Absence findings have no invented
quotes; parser warnings refer to saved extraction metadata. Preparation contains
`matchIndex`, `kind: not_found | profile_only | review` and a bounded action. Keywords
contain the saved job fact, `found | not_found` status and at most one exact CV page
quote. Phrases are case-insensitive/whitespace-tolerant literal mentions, not skill
proficiency; neither keywords nor findings modify the existing skill score.

Missing/foreign/deleting sources use existing 404 codes. Stale job analyses return
409 `JOB_ANALYSIS_STALE`; source edits during work return `JOB_CHANGED` or
`MATCH_SOURCE_CHANGED`. Expired unchanged jobs remain reference-only. Oversized
reviews return 413 `REVIEW_LIMIT`; invalid upstream source/evidence/schema returns
502 `INTELLIGENCE_RESPONSE_INVALID`. Storage/unavailable/timeout mappings remain
unchanged. Reviews have their own sixty/user/fifteen-minute throttle, with
`Retry-After: 900`, independent of paid processing/comparisons. Maximum output is
2 MiB and each Node upstream call has a fifteen-second deadline.

`POST /internal/v1/resumes/review` authenticates the service token and canonical
`X-Owner-Id` before reading up to 16 KB JSON:
`{ resume: Source, draftId, job: null | { jobId, jobHash, jobAnalysisId, profile: null | { version, skills } } }`.
Python resolves exact owner-scoped PostgreSQL records, checks the supplied job hash,
reuses `skill-coverage-v1` and returns the bounded report. Node validates evidence,
keyword and preparation provenance plus source binding/arithmetic, then rechecks
current source lifetime/content/profile revision. No report persistence, automatic
retry, external-model call or original-data mutation occurs.

## Saved-job ranking

Batch 6 saved-job baseline, 2026-10-06. See [ADR-015](../adr/015-saved-job-ranking.md)
and [ordering/use/limits](../job-ranking.md). Authenticated `USER` / `ADMIN` have
identical owner restrictions. Ranking makes no new AI call and stores no report.

`POST /api/v1/intelligence/saved-jobs/rank`, JSON only, no query parameters:

```json
{
  "resumeId": "owned-pdf-uuid",
  "draftId": "saved-cv-analysis-uuid",
  "includeProfileSkills": false,
  "usePreferences": true,
  "filters": { "status": "", "priority": "" }
}
```

All fields are required and unknown fields are rejected. Status/priority accept
the same choices as saved-job listing, with empty strings for all. No browser
owner ID, source hash, profile facts, job list, model or analysis text is accepted.
Node resolves up to 50 jobs across **all pages** of these filters, one owned CV
analysis, optional profile revision and each current owner-private job analysis.
Larger filtered sets return 413 `RANKING_LIMIT`; there is no silent truncation.

The typed [response contract](../../backend/platform/src/intelligence/ranking.ts)
contains `rankingVersion: saved-skill-coverage-v1`, `createdAt`, `total`, `filters`,
source CV identity/hash and draft version, included `profileVersion`, plus:

- `ranked`: numbered jobs with compact catalogue identity, saved priority/date,
  existing skill percentage/weighted totals, selected JD ID/version, matched and
  missing skills with priority, profile-only labels, manual-review count, and
  explicit preference reasons (`matched`, `not_matched`, `unknown`).
- `unranked`: jobs with reason `analysis_required`, `stale_analysis`, `expired`,
  `unavailable`, `not_interested` or `no_scorable_skills`. They receive no rank/score.

Ordering is coverage descending, then matching preference-category count, saved
priority, saved date and stable ID. Role/location use normalized literal phrases,
work mode uses the catalogue enum. Salary/experience and other requirements remain
manual review. Preferences never change the existing skill percentage.

No new private route is needed: Node reuses owner-scoped draft/job reads and the
verified `/internal/v1/matching/compare` contract, at most four jobs concurrently.
Each full match is validated before projection. CV availability, shortlist and
profile revisions, catalogue summaries, description hashes and ranked-job expiration
are checked again before returning. Changed inputs return 409
`RANKING_SOURCE_CHANGED` / `JOB_CHANGED`; deleted sources retain their 404 errors.
Missing/foreign selected CV analyses remain 404. Upstream failures reject the
whole request rather than returning partially ranked results.

The whole request has a 60-second deadline (504 `RANKING_TIMEOUT`), per-private-call
15-second / 2 MiB bounds, final response 2 MiB cap (413 `RANKING_LIMIT`), and a
separate ten rankings/user/fifteen-minute limiter (`Retry-After: 900`). Disconnect
or failure cancels pending/queued work. There is no automatic retry.

Personalized AI preparation has a [separate proposed contract](../personalized-preparation-plan.md)
and is not exposed by the current API.

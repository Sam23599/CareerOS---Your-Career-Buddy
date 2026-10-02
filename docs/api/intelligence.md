# Intelligence API — PDF extraction and structured drafts

Status: Batches 1–2 implemented locally, 2026-10-03. Extraction is transient; saved structured drafts require explicit review before profile updates. See [ADR-010](../adr/010-resume-intelligence-foundation.md) and the [Phase 2 backlog](../phase-2-backlog.md).

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

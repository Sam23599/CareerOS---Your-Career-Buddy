# Intelligence API — PDF text extraction

Status: Implemented locally, 2026-10-02. Extraction is transient and does not update profiles. See [ADR-010](../adr/010-resume-intelligence-foundation.md) and the [Phase 2 backlog](../phase-2-backlog.md).

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

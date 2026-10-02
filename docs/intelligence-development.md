# Resume text extraction — local development

Implemented: 2026-10-02. Open `/resumes`, upload a PDF and choose **Extract text** on any version. The dialog shows text per page, loading/errors, Retry and Close/Escape. Closing/navigation cancels work and discards the result. Extraction does not store analysis or update your profile.

The parser is Python 3.14 / FastAPI / pypdf with fontTools for embedded CFF Type1 font encodings and exact runtime/test dependency pins. Readiness verifies that font support imports under the worker memory cap. It runs separately from Node and MongoDB. Node authenticates the account, reads the owned private PDF, sends bytes to the internal parser and validates its response. See [ADR-010](adr/010-resume-intelligence-foundation.md) and [the API](api/intelligence.md).

## Docker stack

Run from the repository root:

```bash
npm run setup
docker compose up --build -d --wait
```

Setup preserves existing settings, GitHub/Google credentials and JWT signing keys. It adds a separate random `INTELLIGENCE_SERVICE_TOKEN` if missing. The token stays in the ignored, private root `.env`; it is never a frontend variable. Compose sets Node's service URL to `http://intelligence:8000`.

The default intelligence service has **no published port** or original-resume storage mount. Batch 2 adds its own private PostgreSQL connection for drafts; extraction itself remains stateless. It runs as a non-root user with a read-only filesystem, a 512 MiB memory budget and one active parser job. Each disposable Linux worker has a 256 MiB address-space limit and ten-second deadline. Node has a fifteen-second upstream budget. Rebuild intelligence after Python/dependency changes; web/API source changes still reload automatically.

Liveness checks whether the service is running. Authenticated readiness also checks the parser and enforceable worker bounds. Unconfigured/unavailable intelligence does not fail ordinary Node/MongoDB readiness; extraction returns a feature-specific error. `GET /api/v1/intelligence/status` requires a CareerOS access token and reveals only configured/available flags.

## Host Node with the Linux parser

Keep the parser in Docker on macOS; host-only macOS parsing deliberately fails readiness because the selected address-space limits require Linux. To run Node/React on your host:

```bash
npm run setup
docker compose stop api web
docker compose -f docker-compose.yml -f docker-compose.intelligence-host.yml up --build -d --wait mongodb intelligence
npm ci
npm run dev
```

The override publishes the parser on loopback port 8000 only. Root `.env` uses `INTELLIGENCE_SERVICE_URL=http://127.0.0.1:8000`; match it if you change that override. MongoDB's host URI must match your configured `MONGO_PORT`, as in the existing [local guide](local-development.md). Return to the ordinary stack with the base Compose command above to remove the parser's published port.

## Checks

```bash
npm run test:intelligence
npm run lint
npm run typecheck
npm test
npm run build
docker compose exec -T -e TEST_MONGODB_URI=mongodb://mongodb:27017 api node --import tsx --test backend/platform/test/intelligence.integration.ts backend/platform/test/resumes.integration.ts
npx playwright test frontend/web/e2e/intelligence.spec.ts frontend/web/e2e/resumes.spec.ts
```

Python tests use an isolated Docker test image with the same memory budget and temporary test storage; test packages are absent from the runtime image. Gateway integration tests create and delete a temporary database and PDF directory. Browser checks use random test accounts and delete their uploaded PDFs on completion. The new extraction flow also cleans its files after a failed run.

## Limits and failures

- PDF input: 5 MiB; pages: 50; combined text including page separators: 200,000 Unicode characters; serialized output: 2 MiB. Library decompression limits also apply. Oversized output is rejected rather than truncated.
- The Node gateway allows ten extraction attempts per user per fifteen minutes. A busy parser or exhausted allowance includes a retry delay. Requests are never retried automatically.
- Password-protected and unreadable PDFs fail clearly. Unknown parser warnings or skipped/damaged content reject the entire result. Known nonzero xref indexing and extra object-header whitespace return one deduplicated `PDF_STRUCTURE_REPAIRED` warning above the preview text, with a fixed message and no document values. No original bytes are changed.
- A valid blank/image-only PDF returns `no_text` with a warning. OCR is not implemented. Complex layouts can have imperfect reading order even when extraction succeeds; compare the preview with the original PDF.
- Timeout, cancellation and service shutdown stop/reap parser workers. Deleting a source during extraction prevents returning its stale result. PDF/text/service tokens/raw parser exceptions are excluded from logs.

## Verification

Verified on 2026-10-02:

- All 20 Python tests passed in Linux Docker: real multi-page/Unicode/blank/image PDFs, embedded CFF font encoding, known structural repairs with preserved text, warning deduplication without formatting document values, unknown/damaged warnings, byte/page/text/decompression/output limits, address-space enforcement, hard timeout, busy state and cancellation/disconnect cleanup. Parser workers are reaped and the slot becomes usable again.
- Lint, both workspace type checks/builds and all 42 Node unit/API tests passed. The gateway accepts fixed repair warnings alongside required empty-text warnings and rejects duplicates, unknown codes and raw repair messages. The 12 focused gateway/resume integration tests passed against temporary databases/directories, including owner isolation for ADMIN, revoked sessions, throttling, safe upstream errors, deletion during extraction, cancellation and exact original downloads.
- Both extraction and existing resume Chromium flows passed. Real PDF text travels browser → Node → Python; coverage includes a structural-repair warning visible above the page text, page boundaries/Unicode, empty extraction, error/retry, Close/Escape, cancellation and existing preview/download/delete behavior. Development StrictMode no longer starts a duplicate extraction POST.
- The previously rejected local 10-page PDF was retried through the rebuilt parser and Node response validator: extraction completed in about one second with one safe structural-repair warning. Original bytes were unchanged, confirmed by hashes before and after. Only counts and fixed warnings were printed; the original file was retained.
- All four local services are healthy; authenticated parser readiness returns 200. The parser has no published host port in the ordinary Docker stack, and existing application data/settings were retained. Generated browser PDFs and temporary integration data were removed.

Structured resume drafts, persisted analysis and reviewed profile import are implemented in batch 2; see [setup/review](resume-drafts.md) and [ADR-011](adr/011-structured-resume-drafts.md). JD analysis, job matching and Cady remain later batches in [the Phase 2 backlog](phase-2-backlog.md).

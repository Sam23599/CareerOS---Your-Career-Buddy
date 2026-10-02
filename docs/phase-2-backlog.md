# Phase 2 — Resume intelligence and job matching

Updated: 2026-10-03, Asia/Kolkata. **Batches 1–2 implemented locally; later batches remain planned.**

This follows the planning step agreed after Phase 1. The original [Phase 2 roadmap](development-plan.md#5-phase-2--intelligence--ai) remains the product scope. [ADR-010](adr/010-resume-intelligence-foundation.md) defines the first batch; the [API contract](api/intelligence.md) makes it implementable. Later milestones below are a sequence, not a claim that they are built.

## First usable outcome

`Upload PDF → Extract text → Review text → Generate structured draft → Approve profile changes → Compare with a job`

Start with extraction so incorrect reading order, missing text and unsupported PDFs are visible before they affect profile data or matching. The first batch uses local processing and needs no model-provider credentials.

## Current foundation

- Node owns users, JWT sessions, profiles/preferences, jobs, saved jobs and resume metadata/bytes.
- PDFs are immutable versions, limited to 5 MiB. Reuse the existing owner-checked [resume read](../backend/platform/src/resumes/store.ts#L36), rather than adding a public file URL or giving Python access to MongoDB/filesystem volumes.
- Current upload checks validate signatures only; a successfully uploaded file may still fail parsing. The [resume contract](api/resumes.md) documents this limit.
- The original architecture gives Python ownership of derived intelligence data. Batch 1 is stateless; batch 2 persists derived drafts in Python-owned PostgreSQL.

## Implementation order

| Batch | Scope | Done when |
| --- | --- | --- |
| 1. PDF text extraction — implemented | Python/FastAPI service, private parser endpoint, Node gateway and resume text preview | An owned PDF produces reviewable page text; failures are clear; original files/profile remain unchanged |
| 2. Structured resume draft — implemented | Section/skill/experience/education extraction, evidence and Python-owned numbered draft history | Results reference source pages; unknown values stay unknown; a user can review and explicitly apply supported profile fields |
| 3. Job-description analysis | Normalize existing job descriptions and extract requirements with evidence | Job analysis preserves source identity and does not invent missing skills, experience or dates |
| 4. Explainable matching | Compare profile/resume and a selected job using a documented baseline | Show matched/missing skills, unknown requirements and the score calculation; fixtures demonstrate predictable results |
| 5. Resume checks and skill gaps | Keyword/structure checks and preparation suggestions | Findings link back to resume/JD evidence; clearly label CareerOS heuristics rather than claiming an actual employer ATS score |
| 6. Job ranking | Rank available/saved jobs using matching and user preferences | Explain why a job ranks higher; handle incomplete/stale source data explicitly |
| 7. Initial Cady | Answer career questions from the authenticated user's profile, resume and selected/saved jobs | Answers use authorized context and evidence; Cady requests confirmation before any profile mutation |

The next authorized planning output is the [detailed batch 3 job-description analysis plan](job-description-analysis-plan.md). Its implementation and external AI calls remain pending the user's next instruction.

## Batch 1 — Concrete work

### Python service

- [x] Add `backend/intelligence/` with FastAPI, typed response models, pypdf, a locked dependency set and focused tests. Verify supported runtime/package versions when coding.
- [x] Add liveness/readiness endpoints and the service-authenticated `POST /internal/v1/resumes/extract` endpoint.
- [x] Accept a bounded raw PDF body; validate service credentials before reading or parsing it.
- [x] Extract text per page in a disposable subprocess, with the bounds in ADR-010. Terminate/reap the worker on timeout or cancellation; keep parser logs from exposing document content.
- [x] Return parser/schema versions, page text, combined text, status and warnings. Reject encrypted/malformed/over-limit input; a valid PDF with no extractable text returns an explicit `no_text` result.
- [x] Add a private Docker Compose service with an enforced memory budget. Python receives no MongoDB URI, original-resume volume or CareerOS JWT signing secret.

### Node integration

- [x] Add a small `backend/platform/src/intelligence/` client/router; keep the browser on the existing `/api/v1` gateway.
- [x] Add `GET /api/v1/intelligence/status` and `POST /api/v1/intelligence/resumes/:id/extract` as specified in the contract.
- [x] Authenticate and resolve the owned version through `ResumeStore.download`; forward only those bytes to the configured service.
- [x] Validate bounded Python responses and attach the server-derived resume ID, version and SHA-256. Recheck that the same owned version is still available before returning a result.
- [x] Apply per-user throttling, a bounded upstream timeout and cancellation. Do not retry extraction automatically after an uncertain result.
- [x] Keep ordinary Phase 1 routes/readiness usable when intelligence is unconfigured or unavailable; return a clear extraction-specific error.
- [x] Extend ignored environment configuration/setup with a separate service token and URL, preserving existing secrets and data. Document host/Docker startup.

### UI

- [x] Offer **Extract text** on every owned resume version beside View/Download/Delete. Reserve **Analyze resume** for the later structured-analysis action.
- [x] Open a dialog with loading, page-by-page plain text, extraction warnings, failure/retry and close states. Render extracted strings as text, never HTML.
- [x] Explain that scanned PDFs may need OCR and complex layouts may need manual review. Empty extraction must not appear as a completed analysis.
- [x] Cancel a pending request on close/navigation. Keep results only in memory; clearing the dialog removes the preview.
- [x] Leave active selection, original PDF downloads and profile fields unchanged by extraction.

### Batch 1 acceptance

- [x] A real text PDF works through browser → Node → Python and retains its original downloaded bytes.
- [x] Multi-page, Unicode and blank-page fixtures preserve page boundaries; image-only/blank PDFs report no readable text.
- [x] Foreign/deleting/missing resume IDs fail before calling Python; ADMIN uses the same owner checks. Session revocation is respected.
- [x] Invalid service credentials, malformed/encrypted PDFs, size/page/text limits, parser timeout/memory failure, busy service and malformed upstream responses have tested outcomes.
- [x] Closing the dialog cancels work; deleting a version during extraction prevents returning its stale result. A failed parser does not take down normal CareerOS routes.
- [x] Request logs contain IDs, durations and safe codes, without raw PDF/text/tokens. No extracted content is persisted in batch 1.
- [x] Relevant Python, Node and browser checks pass; local setup docs demonstrate the new service without disturbing Phase 1 data.

## Storage and review in batch 2 — implemented

A Python-owned PostgreSQL database now stores immutable structured drafts. See [ADR-011](adr/011-structured-resume-drafts.md) and [setup/review/checks](resume-drafts.md). Node's MongoDB continues to own the authoritative career profile and original-resume library. PostgreSQL/pgvector is already anticipated in the [system overview](architecture/system-overview.md); vector indexing waits until a concrete retrieval use case.

Each successful explicit analysis saves a new immutable numbered version, including repeated settings. History is paginated and older IDs remain reviewable/importable while the owned source is available; opening them never calls AI. Failed analysis saves nothing.

An analysis record needs owner ID, resume ID/version/content hash, extractor/model version, status, page evidence, structured draft and timestamps. Node supplies ownership through the authenticated gateway; Python APIs enforce that namespace. Never accept a browser-supplied owner ID as authorization.

Applying a draft reuses existing profile validation and revision checks through an owner/source-checked draft-import endpoint. The user selects fields to import, sees changes and confirms them. Do not overwrite a manually edited profile or create unsupported fields silently. Projects can remain in the analysis draft until the profile schema explicitly supports them.

Source deletion suppresses access immediately and writes a durable MongoDB cleanup item. Node retries Python deletion every 30 seconds while running; PostgreSQL tombstones prevent late writes. Stale source/draft/profile versions are rejected. Any reuse of results must include owner, content hash and analyzer version; matching also includes profile version and job-content version.

## Decisions needed later

| Decision | When | Default direction |
| --- | --- | --- |
| Model provider and budget | Batch 2 settled | OpenAI Responses; requested three models and compatible reasoning; Luna/medium default; explicit text-only processing, fixed input/output/time limits, no retries; provider spending limits configured separately |
| Rules versus model extraction | Batch 2 settled | LLM creates rich typed drafts; deterministic source-quote/value verification and explicit user review guard profile imports |
| OCR and DOCX | After text-PDF extraction works | Separate extension; no promise of scanned-document support in batch 1 |
| Matching formula and ranking weights | Before batch 4 | Deterministic, documented baseline first; a match score is not a hiring probability |
| Analysis retention and deletion | Batch 2 settled | Owner-scoped PostgreSQL records tied to source lifetime; durable Node cleanup outbox; minimal deletion tombstones |

Google live sign-in and the UI/source/filter requests in [project notes](project-notes.md) remain separately prioritized work. Application tracking remains Phase 3, community Phase 5 and production deployment Phase 7. This extraction batch does not implement those requests.

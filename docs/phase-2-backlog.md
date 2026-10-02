# Phase 2 — Resume intelligence and job matching

Updated: 2026-10-02, Asia/Kolkata. **Planning complete; application implementation has not started.**

This implements the planning step agreed after Phase 1. The original [Phase 2 roadmap](development-plan.md#5-phase-2--intelligence--ai) remains the product scope. [ADR-010](adr/010-resume-intelligence-foundation.md) defines the first batch; the [planned API contract](api/intelligence.md) makes it implementable. Later milestones below are a sequence, not a claim that they are built.

## First usable outcome

`Upload PDF → Extract text → Review text → Later extract structured fields → Approve profile changes → Compare with a job`

Start with extraction so incorrect reading order, missing text and unsupported PDFs are visible before they affect profile data or matching. The first batch uses local processing and needs no model-provider credentials.

## Current foundation

- Node owns users, JWT sessions, profiles/preferences, jobs, saved jobs and resume metadata/bytes.
- PDFs are immutable versions, limited to 5 MiB. Reuse the existing owner-checked [resume read](../backend/platform/src/resumes/store.ts#L36), rather than adding a public file URL or giving Python access to MongoDB/filesystem volumes.
- Current upload checks validate signatures only; a successfully uploaded file may still fail parsing. The [resume contract](api/resumes.md) documents this limit.
- The original architecture gives Python ownership of derived intelligence data. Batch 1 is stateless; persisted analysis starts in a later batch with Python-owned storage.

## Implementation order

| Batch | Scope | Done when |
| --- | --- | --- |
| 1. PDF text extraction | Python/FastAPI service, private parser endpoint, Node gateway and resume text preview | An owned PDF produces reviewable page text; failures are clear; original files/profile remain unchanged |
| 2. Structured resume draft | Section/skill/experience/education extraction, evidence and Python-owned analysis storage | Results reference source pages; unknown values stay unknown; a user can review and explicitly apply supported profile fields |
| 3. Job-description analysis | Normalize existing job descriptions and extract requirements with evidence | Job analysis preserves source identity and does not invent missing skills, experience or dates |
| 4. Explainable matching | Compare profile/resume and a selected job using a documented baseline | Show matched/missing skills, unknown requirements and the score calculation; fixtures demonstrate predictable results |
| 5. Resume checks and skill gaps | Keyword/structure checks and preparation suggestions | Findings link back to resume/JD evidence; clearly label CareerOS heuristics rather than claiming an actual employer ATS score |
| 6. Job ranking | Rank available/saved jobs using matching and user preferences | Explain why a job ranks higher; handle incomplete/stale source data explicitly |
| 7. Initial Cady | Answer career questions from the authenticated user's profile, resume and selected/saved jobs | Answers use authorized context and evidence; Cady requests confirmation before any profile mutation |

## Batch 1 — Concrete work

### Python service

- [ ] Add `backend/intelligence/` with FastAPI, typed response models, pypdf, a locked dependency set and focused tests. Verify supported runtime/package versions when coding.
- [ ] Add liveness/readiness endpoints and the service-authenticated `POST /internal/v1/resumes/extract` endpoint.
- [ ] Accept a bounded raw PDF body; validate service credentials before reading or parsing it.
- [ ] Extract text per page in a disposable subprocess, with the bounds in ADR-010. Terminate/reap the worker on timeout or cancellation; keep parser logs from exposing document content.
- [ ] Return parser/schema versions, page text, combined text, status and warnings. Reject encrypted/malformed/over-limit input; a valid PDF with no extractable text returns an explicit `no_text` result.
- [ ] Add a private Docker Compose service with an enforced memory budget. Python receives no MongoDB URI, original-resume volume or CareerOS JWT signing secret.

### Node integration

- [ ] Add a small `backend/platform/src/intelligence/` client/router; keep the browser on the existing `/api/v1` gateway.
- [ ] Add `GET /api/v1/intelligence/status` and `POST /api/v1/intelligence/resumes/:id/extract` as specified in the contract.
- [ ] Authenticate and resolve the owned version through `ResumeStore.download`; forward only those bytes to the configured service.
- [ ] Validate bounded Python responses and attach the server-derived resume ID, version and SHA-256. Recheck that the same owned version is still available before returning a result.
- [ ] Apply per-user throttling, a bounded upstream timeout and cancellation. Do not retry extraction automatically after an uncertain result.
- [ ] Keep ordinary Phase 1 routes/readiness usable when intelligence is unconfigured or unavailable; return a clear extraction-specific error.
- [ ] Extend ignored environment configuration/setup with a separate service token and URL, preserving existing secrets and data. Document host/Docker startup.

### UI

- [ ] Offer **Extract text** on every owned resume version beside View/Download/Delete. Reserve **Analyze resume** for the later structured-analysis action.
- [ ] Open a dialog with loading, page-by-page plain text, extraction warnings, failure/retry and close states. Render extracted strings as text, never HTML.
- [ ] Explain that scanned PDFs may need OCR and complex layouts may need manual review. Empty extraction must not appear as a completed analysis.
- [ ] Cancel a pending request on close/navigation. Keep results only in memory; clearing the dialog removes the preview.
- [ ] Leave active selection, original PDF downloads and profile fields unchanged by extraction.

### Batch 1 acceptance

- [ ] A real text PDF works through browser → Node → Python and retains its original downloaded bytes.
- [ ] Multi-page, Unicode and blank-page fixtures preserve page boundaries; image-only/blank PDFs report no readable text.
- [ ] Foreign/deleting/missing resume IDs fail before calling Python; ADMIN uses the same owner checks. Session revocation is respected.
- [ ] Invalid service credentials, malformed/encrypted PDFs, size/page/text limits, parser timeout/memory failure, busy service and malformed upstream responses have tested outcomes.
- [ ] Closing the dialog cancels work; deleting a version during extraction prevents returning its stale result. A failed parser does not take down normal CareerOS routes.
- [ ] Request logs contain IDs, durations and safe codes, without raw PDF/text/tokens. No extracted content is persisted in batch 1.
- [ ] Relevant Python, Node and browser checks pass; local setup docs demonstrate the new service without disturbing Phase 1 data.

## Storage and review in batch 2

Introduce a Python-owned PostgreSQL database for durable analysis when structured drafts/history are needed. Node's MongoDB continues to own the authoritative career profile and original-resume library. PostgreSQL/pgvector is already anticipated in the [system overview](architecture/system-overview.md); vector indexing waits until a concrete retrieval use case.

An analysis record needs owner ID, resume ID/version/content hash, extractor/model version, status, page evidence, structured draft and timestamps. Node supplies ownership through the authenticated gateway; Python APIs enforce that namespace. Never accept a browser-supplied owner ID as authorization.

Applying a draft uses the existing profile API and revision checks. The user selects fields to import, sees changes and confirms them. Do not overwrite a manually edited profile or create unsupported fields silently. Projects can remain in the analysis draft until the profile schema explicitly supports them.

Define deletion/retry behavior before durable storage ships: remove analysis when its source is deleted, suppress access immediately, retry failed downstream cleanup, and reject stale drafts. Any reuse of results must include owner, content hash and analyzer version; matching also includes profile version and job-content version.

## Decisions needed later

| Decision | When | Default direction |
| --- | --- | --- |
| Model provider and budget | Before any external model call | Keep a provider interface; choose/configure a concrete provider and document what career data is sent |
| Rules versus model extraction | Batch 2 design | Evaluate fixtures first; preserve evidence and uncertainty with either approach |
| OCR and DOCX | After text-PDF extraction works | Separate extension; no promise of scanned-document support in batch 1 |
| Matching formula and ranking weights | Before batch 4 | Deterministic, documented baseline first; a match score is not a hiring probability |
| Analysis retention and deletion | Before durable storage | Owner-scoped results, source lifecycle and explicit cleanup/retry contract |

Google live sign-in and the UI/source/filter requests in [project notes](project-notes.md) remain separately prioritized work. Application tracking remains Phase 3, community Phase 5 and production deployment Phase 7. This planning step does not implement those requests.

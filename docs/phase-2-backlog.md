# Phase 2 — Resume intelligence and job matching

Updated: 2026-10-07, Asia/Kolkata. **Batches 1–4, the batch 5 baseline, batch 6 saved-job baseline and notebook follow-up, personalized AI preparation and initial Cady implemented locally; Celery migration remains planned.**

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
| 3. Job-description analysis — implemented | Existing descriptions, quoted requirements and private numbered versions | Results preserve source identity, label unknown priorities and stale/expired listings, and do not mutate jobs/profiles |
| 4. Explainable matching — implemented | Compare saved CV/job analyses and optional profile skills using `skill-coverage-v1` | Show quoted matched/not-found skills, unscored review requirements and weighted score calculation; source/owner checks and fixtures demonstrate predictable results |
| 5. Resume checks and skill gaps — baseline implemented | Recognized-section/PDF-warning checks, literal job terminology, prioritized evidence gaps and preparation actions | Findings link back to saved inputs; compact reports distinguish missing evidence from skill gaps and CareerOS heuristics from actual employer ATS behavior |
| 6. Job ranking — saved-job baseline implemented | Rank up to 50 saved jobs across applied filters using matching, then explicit preferences/priority/date | Expand reasons; separate unanalysed/stale/expired/unavailable/unscorable/not-interested jobs; wider discovery ranking remains an extension |
| Celery execution foundation — planned | Migrate the existing PostgreSQL-backed job worker to Celery/Redis, then resume AI drafts in a separate batch | Preserve task/history/version contracts, outbox delivery recovery, one shared generation across processes and no automatic uncertain paid retry |
| Personalized AI preparation — implemented | Confirm evidence-versus-learning gaps/time goals; explicitly generate, review and save a source-bound learning plan | Shared provider infrastructure, strict requirement links, versioning/cleanup and cost/consent controls; no silent CV/profile edits |
| 7. Initial Cady — implemented | Answer career questions from selected CV/job analyses and optional profile skills | Answers use authorized context and source references; no mutation tools or durable chat memory in this initial scope |

Batch 3 follows the approved [job-description analysis plan](job-description-analysis-plan.md); see [local use](job-description-analysis.md) and [ADR-012](adr/012-job-description-analysis.md). Batch 4 implements the [deterministic matching baseline](cv-job-matching.md) and [ADR-013](adr/013-cv-job-matching.md). Batch 5 adds [resume checks and preparation](resume-checks.md) in [ADR-014](adr/014-resume-checks.md). Batch 6 adds [saved-job ranking](job-ranking.md) in [ADR-015](adr/015-saved-job-ranking.md). These reuse saved analyses without new provider calls. The [personalized preparation plan](personalized-preparation-plan.md) records the optional AI extension now implemented before initial Cady in [ADR-017](adr/017-personalized-preparation-and-initial-cady.md). AI notices were delivered before implementation; mocked verification makes no paid calls. Notify again before future AI-dependent stages.

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

Source removal suppresses access immediately. The approved notebook batch now retains resumes and derived records in a default 30-day recovery window, then a support-only retained archive. Historical hard deletions still use the durable MongoDB cleanup outbox and PostgreSQL tombstones. Stale source/draft/profile versions are rejected. Any reuse of results must include owner, content hash and analyzer version; matching also includes profile version and job-content version.

## Decisions needed later

The [Celery migration plan](intelligence-background-processing-plan.md) records
the approved planning direction and current task inventory. Start implementation
with existing background job analysis when selected; keep matching/checks and
bounded ranking synchronous. Redis is proposed as the task broker in Phase 2,
independent of the later Phase 4 Kafka event roadmap. No worker/dependency change
is implemented by this planning update.

| Decision | When | Default direction |
| --- | --- | --- |
| Model provider and budget | Batch 2 settled | OpenAI Responses; requested three models and compatible reasoning; Luna/medium default; explicit text-only processing, fixed input/output/time limits, no retries; provider spending limits configured separately |
| Rules versus model extraction | Batch 2 settled | LLM creates rich typed drafts; deterministic source-quote/value verification and explicit user review guard profile imports |
| OCR and DOCX | After text-PDF extraction works | Separate extension; no promise of scanned-document support in batch 1 |
| Matching formula and ranking weights | Batches 4 and 6 saved-job baseline settled | Required/unspecified/preferred skill weights 3/2/1; coverage leads ranking, explicit preferences then saved priority/date break ties; other requirements reviewed; no hiring probability or employer ATS claim |
| Analysis retention and deletion | Notebook follow-up settled | Owner-scoped records; recoverable source removal and support-only recovery after bin expiry; historical hard-deletion outbox/tombstones retained |

The approved UI/source/filter/recovery/task-history requests have an implemented [notebook batch](notes-improvements.md). Google live sign-in verification and supported native LinkedIn/contact/review access remain pending prerequisites. Saved jobs now include manual application progress/history as a small foundation; the full application workflow remains Phase 3, community Phase 5 and production deployment Phase 7. Personalized preparation and initial Cady are now implemented; see [use and limits](personalized-preparation.md).

# Phase 2, batch 3 — Job-description analysis plan

Status: Approved and implemented locally, 2026-10-05 (Asia/Kolkata); original plan dated 2026-10-03. See [local use and verification](job-description-analysis.md) and [ADR-012](adr/012-job-description-analysis.md). Follows [the original roadmap](development-plan.md#52-job-description-intelligence) and [Phase 2 backlog](phase-2-backlog.md). Resume extraction, structured drafts and persisted draft versions are complete locally.

## Outcome

On an existing job detail page: **Analyze job → inspect structured requirements → expand the source evidence → reopen saved analysis**. The result explains what the listing asks for, preparing the inputs for batch 4's explainable resume/profile matching.

Use jobs already imported into CareerOS. Node remains authoritative for job content and access; Python owns derived analysis. Original descriptions, search filters, ingestion schedules and the user's profile remain unchanged. Importing arbitrary links, employer reviews, recruiter contacts and application tracking remain separate requests/stages.

## AI involvement — notify before implementation

This stage needs an LLM to organize free-text job requirements. The user approved this plan and was notified before implementation. It reuses OpenAI, `gpt-6-luna` with medium reasoning, and the same compatible GPT-4.1/GPT-6.1 Sol controls. Live synthetic provider verification remains separately authorized; regular checks mock AI.

Only an explicit **Analyze job** click calls the provider. Send the selected listing's title/company/location and normalized description as labelled source text, plus the analysis instructions/schema. Do not send the user's CV, profile, saved-job notes or credentials. Saved analysis reads make no AI call. No automatic analysis during browsing, ingestion or four-hour refresh.

Reuse the current 60,000-byte total input, 16,384-token output, 90-second provider deadline and 2 MiB response limits as initial proposed bounds. Check the new schema/prompt against that budget; reject oversized descriptions clearly instead of truncating. Existing listings can contain up to 100,000 description characters. Keep explicit provider charges, no retries/fallback and no currency-budget guarantee. Normal verification mocks AI; a paid synthetic check requires separate authorization.

## Data and review contract

| Group | Proposed saved fields |
| --- | --- |
| Listing context | Title, company, location, stated work mode, employment type, compensation and application constraints |
| Requirements | Skills, technologies/tools, experience, education, certifications, languages and explicit eligibility requirements |
| Role details | Responsibilities, deliverables, benefits, keywords and additional stated requirements |
| Traceability | Analysis ID/version, job ID/content hash, normalizer/analyzer/schema versions, provider/model/reasoning, usage and timestamp |

Every populated fact must retain its copied source value and a quote from a labelled input section. Use section IDs and character ranges rather than PDF page numbers. Verify section/range/quote and copied values in Python and Node. Source text is untrusted data, never instructions. Unknown values stay null; missing lists stay empty. Retain exact wording for salary ranges, dates and years of experience.

Tag requirements as **required / preferred / unspecified** only when supported by explicit wording or a source heading, with evidence for that tag. Avoid interpreting every mentioned skill as mandatory. Contradictory or ambiguous location/salary/experience statements stay visible with review warnings. Do not infer nationality, work permission, worldwide eligibility or unstated seniority.

The result is informational. The user reviews evidence on the job page; there is no profile apply step. Provider-supplied job metadata and extracted claims have separate labels so disagreements are visible. Batch 4 can later use these reviewed, source-bound requirements; a match score is not included here.

## Implementation sequence

1. **Source and contracts.** Add `JobAnalysisService` to Node, resolving an existing 64-hex job ID through `JobStore.get`. Reuse already plain-text descriptions; normalize line endings/null characters and preserve meaningful paragraphs. Define labelled context/description sections and canonical JSON hashing over exactly the content used by analysis. Include the normalizer version in identity. Exclude ingestion timestamps: a refresh updates `updatedAt` even when content is unchanged. Write synthetic fixtures and a generated JSON schema before wiring generation.
2. **Modular Python analysis.** Add `app/jobs/models.py`, `prompt.py`, `evidence.py` and `service.py`. Reuse `LLMService`, provider/model registries, safe errors and cancellation. Introduce a shared generation gate so resume and job analysis together retain one active generation per instance with no queue; preserve resume cancellation/shutdown behavior. Factor out only evidence helpers that both domains actually need. Keep controllers and application wiring thin.
3. **Saved analysis.** Add a job-specific repository interface and PostgreSQL adapter/table through migration 002. Store owner/job/content identity and immutable numbered analyses. Read latest/history/exact ID without generation, using the resume history pagination pattern. Save only validated successes. A source change marks old results stale; reject stale results as matching inputs. Recheck job existence/content after processing. Source removal blocks access immediately; settle cleanup/retention alongside this migration rather than introducing an unowned orphan store.
4. **Gateway endpoints.** Authenticate with existing JWT/USER/ADMIN rules and resolve available job content server-side. The browser supplies only job ID and model/reasoning; it cannot supply owner, description, remote URL or a filesystem path. Validate source identity, evidence and response limits in Node. Extend the combined per-user processing allowance to job analysis and retain cancellation/safe failure behavior. Python receives only a dedicated service token and trusted source context.
5. **Job detail UI.** Add an Analyze job action and review panel beside the existing description. Show requirement sections, mandatory/preferred/unknown labels, quoted evidence, warnings and saved versions. Show changed/expired listing status clearly and prevent accidental regeneration on open. A failed attempt keeps any existing saved analysis available; empty descriptions explain why analysis cannot start.
6. **Verification and docs.** Cover source hashing across identical refreshes/actual edits, blank/oversized text, prompt injection, invalid evidence, ambiguous requirements, shared concurrency/cancellation, owner isolation, history/restarts/migration and stale/deleted sources. Verify the browser's explicit generation and provider-free reopening. Update API contracts/ADR/status only from passing behavior. Restart local services with existing data volumes retained.

## Proposed endpoints

| Browser gateway | Purpose |
| --- | --- |
| `POST /api/v1/intelligence/jobs/:id/analyze` | Explicit generation with `{ model, reasoning }` |
| `GET /api/v1/intelligence/jobs/:id/analysis` | Latest saved analysis of current content |
| `GET /api/v1/intelligence/jobs/:id/analysis?analysisId=uuid` | One saved version, with explicit stale status when source content has changed |
| `GET /api/v1/intelligence/jobs/:id/analyses?beforeVersion=N` | Newest-first metadata history, at most twenty entries |

Private Python routes mirror these responsibilities under `/internal/v1/jobs/` with the service token and validated owner/job/content context. The new job ID contract must use 64-hex IDs; do not reuse the resume UUID validator. The implemented stale-response/error contract and removal cleanup mechanism are documented in [the API](api/intelligence.md#job-description-analysis) and ADR-012.

## Acceptance and next handoff

- Existing Remotive/Greenhouse/Google jobs show evidence-backed, readable requirements without changing the raw listing or existing search behavior.
- Unknown requirements stay unknown, and provider metadata disagreements appear explicitly.
- Identical ingestion refreshes keep saved results current; real content edits mark previous analysis stale.
- Successful explicit clicks save versions; failures save nothing; saved reads remain usable without an OpenAI key.
- Authentication, resume drafts and ordinary job browsing stay usable during intelligence/provider outages.
- No CV/profile mutation or automatic paid work occurs in this batch.

All six steps are implemented locally; see the implementation document for verification evidence. After it passes, batch 4 defines a deterministic matching formula for skill overlap, missing skills, experience and unknown requirements using job-analysis identity plus resume/profile versions. Embeddings, rankings, ATS heuristics and Cady keep their original later order.

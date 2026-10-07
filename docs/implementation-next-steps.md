# CareerOS — Review and Next Implementation Steps

Updated: 2026-10-02. Status: Phase 1 local core and hardening checks verified; interrupted restoration and GitHub issuer validation are fixed and standalone component tests are implemented. JWT authentication, profiles, resumes, jobs/ingestion, saved jobs, career sources/bookmarks and in-app notifications are implemented. Live GitHub sign-in/logout/returning-account checks pass. Google verification is deferred and community remains in Phase 5. See the [release verification report](phase-1-release-verification.md).

Phase 2 batch 1 is implemented: private PDF text extraction through Python/FastAPI, an owner-checked Node gateway and a transient page-text preview. See [the executable backlog](phase-2-backlog.md), [ADR-010](adr/010-resume-intelligence-foundation.md) and [API contract](api/intelligence.md). Structured drafts and reviewed profile import are also implemented in [ADR-011](adr/011-structured-resume-drafts.md). Job-description analysis is implemented in [ADR-012](adr/012-job-description-analysis.md); [CV-to-job matching](cv-job-matching.md) in [ADR-013](adr/013-cv-job-matching.md); the [resume-checks/preparation baseline](resume-checks.md) in [ADR-014](adr/014-resume-checks.md); [saved-job ranking](job-ranking.md) in [ADR-015](adr/015-saved-job-ranking.md). Personalized AI preparation and initial Cady are implemented in [ADR-017](adr/017-personalized-preparation-and-initial-cady.md).

## 1. Current position

CareerOS combines job discovery, career profiles, preparation, application tracking, and community. Cady connects these capabilities through personalized career intelligence. The project also deliberately develops engineering experience across Node.js, Python, Java, and distributed systems.

Before this review, the repository contained five planning documents and an empty `docker-compose.yml`. At that point there was no application code, dependency manifest, test suite, runnable environment, or recorded ADR. The tracked history contains one initial documentation commit. That review preceded the executable foundation.

The original incremental approach remains appropriate: establish useful profile and job data in Node first, add intelligence in Python, then application workflows in Java. Start with one Node application containing separate domain modules, as permitted by `architecture/service-boundaries.md`.

## 2. Review findings and resolutions

| Gap | Original evidence (commit `773e255`, before this review) | Resolution or next action |
| --- | --- | --- |
| Community release scope differs | `development-plan.md:743` places community in Phase 5; `phase-1-backlog.md:249` and `:413` require it in Phase 1 | Confirmed: release the core job workflow first; community belongs in Phase 5. |
| MVP spans several phases | `development-plan.md:1209` includes application tracking and AI, while `:320` defines a usable Phase 1 without them | Name the Phase 1 release separately from the broader product MVP across Phases 1–3. |
| Phase numbering differs | `README.md:548` calls production Phase 6; `development-plan.md:860` and `:905` separate automation and production into Phases 6 and 7 | Aligned the README to the detailed development plan phase numbering. |
| ADR numbers have conflicting meanings | `development-plan.md:121` and `phase-1-backlog.md:491` propose different initial ADR sets | Removed competing numbered examples; create one ADR index as decisions are recorded. |
| Progress checkboxes are stale | `phase-1-backlog.md:34` leaves existing repository and documentation tasks unchecked | Marked verified repository/documentation work complete; runnable setup remains incomplete. |
| Runtime foundation is not an explicit milestone | `phase-1-backlog.md:455` names a Node foundation, but the earlier milestone list does not detail it | Add backend startup, configuration, database connection, validation, errors, logging, and health checks to foundation acceptance. |
| Job-source and identity contracts are unspecified | `phase-1-backlog.md:173` lists a job model and adapter tasks without a selected source or ingestion contract | Define source identifiers, repeat-import behavior, missing fields, supported filters, and source failure handling before ingestion. |

## 3. Proposed release boundary

The first usable core release should support:

`Register → Maintain profile/preferences → Upload resume → Search jobs → View job → Save job`

Also include custom career-source configuration and basic in-app notifications, as specified in the original Phase 1 roadmap. Treat connected-profile URLs and actual authenticated imports as different features. Start with saved URLs; choose supported imports explicitly before implementing them.

Keep AI analysis/Cady in Phase 2, application state/history in Phase 3, Kafka in Phase 4, and production deployment in Phase 7. Saved-job interest states stay separate from application statuses. Community is confirmed for Phase 5.

## 4. Implementable sequence

Each step depends on the preceding foundation. Add relevant tests alongside behavior; the final step checks the combined journey.

| Step | Implementation scope | Completion evidence |
| --- | --- | --- |
| 0. Align the plan | Record initial architecture/repository decisions; release naming, community scope, and roadmap alignment are resolved by this review | One consistent release checklist and ADR index, with proposals distinguished from accepted decisions |
| 1. Runnable foundation — complete | Scaffold React and one Express application; configure MongoDB, environment examples, ignore rules, lint/build commands, Docker Compose, API prefix, structured errors, request IDs, and health/readiness checks | A clean checkout starts using documented commands; frontend reaches the API; readiness reflects database availability; data survives restart |
| 2. Authentication — implemented; live GitHub verified | Registration, email/optional username login, optional OAuth-account password setup, remembered-account continuation, JWT access/refresh handling, logout and USER/ADMIN enforcement | The same account works through password/provider sign-in; valid browser sessions restore; revoked tokens fail; Google live verification remains deferred |
| 3. Career profile — implemented | Skills, experience, education, preferences, and professional-profile links, with validated read/update APIs and UI | Profile changes persist; one user cannot read or edit another user's private profile |
| 4. Resume management — implemented | Upload, metadata, versions, active selection, authenticated download, and deletion; storage abstraction with a local implementation | Supported uploads work; invalid/oversized files fail; access is owner-only; active-resume and deletion behavior are defined and verified |
| 5. Jobs and ingestion — implemented | Normalized schema, fixture adapter, then one verified accessible external source; normalization, idempotent ingestion, search/filter/pagination, and job detail UI | Reimporting a source job updates it without duplication; filters match stored fields; failed fetches do not erase existing jobs; one real source works before aggregation is considered complete |
| 6. Saved jobs — implemented | Save/unsave, notes, priority, and SAVED/INTERESTED/NOT_INTERESTED states | Repeated saves do not duplicate records; data is private per user; the complete core journey works |
| 7. Complete Phase 1 scope — implemented | Private searchable job sources and career bookmarks, registry-based Greenhouse and limited Google checks, and in-app notifications with read/unread state and preferences | Coverage and bookmark intent are explicit; enabling bookmark tracking requires user setup; users see only their configuration and notifications; community remains in Phase 5 |
| 8. Release verification — local core and hardening verified | Critical API/UI journey checks, access-control checks, clean candidate setup, API documentation, and status updates | 35 unit/API tests, 47 integration tests, all 11 browser journeys and 10 component tests passed; interrupted restoration is fixed. Fresh setup, builds and persistence passed in the initial batch. GitHub's issuer mismatch is fixed and live sign-in/logout/returning-account checks pass. See the [report](phase-1-release-verification.md) |

## 5. First implementation batch

Step 1 is implemented and verified. It is limited to a running web app, API, and database; see [verification evidence](local-development.md#foundation-verification-previous-batch).

Proposed layout:

```text
frontend/web/
backend/platform/
docs/adr/
docker-compose.yml
.env.example
.gitignore
```

Use domain modules inside `backend/platform/` as features arrive. Preserve the original Node/Python/Java ownership boundaries; add Python and Java directories when their phases start. Redis remains optional in the current stack; the approved [Celery planning direction](intelligence-background-processing-plan.md) now proposes it as the intelligence task broker when that migration is selected.

Before scaffolding, record the language choice (the README currently allows JavaScript or TypeScript), package manager, supported runtime versions, local ports, and development commands. These are routine implementation choices, not changes to the product vision. Verify dependency versions at implementation time.

For authentication, write down token transport, refresh rotation/revocation, session expiry, password-management scope, and resource ownership before Step 2. For resumes, decide supported formats, size limits, active-version behavior, and local storage before Step 4. For jobs, choose the target geography/source and verify actual integration access before committing to a live adapter in Step 5.

## 6. Documentation approach

Google Careers and the provider registry were authorized before release verification. See [ADR-008](adr/008-career-source-registry.md) and the [source integration plan](architecture/career-source-integration.md). Further ATS adapters and company-page discovery are proposals. Release checks and authentication/component hardening have now run, including successful live GitHub sign-in/logout/returning-account checks. Google sign-in verification is deferred; remaining live OAuth scenarios are listed in the [report](phase-1-release-verification.md).

Separate career bookmarks and explicit tracking activation are implemented in [ADR-009](adr/009-career-bookmarks.md). On-demand browsing tools remain planned for a later release and are not implemented by this batch.

Keep `development-plan.md` as the overall roadmap, `phase-1-backlog.md` as the executable release checklist, and architecture documents as domain boundaries. This review is a proposed bridge into implementation, not a replacement roadmap.

Record decisions when needed rather than writing every future ADR up front. Add API contracts with each feature. Update status from working behavior and validation evidence, not from scaffolding alone.

The initial review changed documentation only. The subsequently authorized foundation batch now includes React, Express, MongoDB Compose configuration, API checks, and ADR-001. See [local development](local-development.md) for commands and [the foundation decision](adr/001-local-platform-foundation.md) for accepted choices. JWT authentication and configurable Google/GitHub OAuth flows are implemented. Career profiles are implemented; see [ADR-003](adr/003-career-profiles.md) and the [profile API](api/profiles.md). Resume management is implemented; see [ADR-004](adr/004-resume-storage.md). Jobs and ingestion are implemented with Remotive as the first live source; see [ADR-005](adr/005-jobs-ingestion.md). Saved jobs are implemented with private notes, priorities, and interest statuses; see [ADR-006](adr/006-saved-jobs.md). Custom career sources and in-app notifications are implemented; see [ADR-007](adr/007-career-sources-notifications.md). The [release report](phase-1-release-verification.md) records the passing checks and remaining sign-off work. See [ADR-002](adr/002-authentication.md) for session and provider decisions.

## 7. Phase 2 first batch — resume text extraction implemented

Completed batch 1 from [the Phase 2 backlog](phase-2-backlog.md#batch-1--concrete-work):

1. Add the private Python/FastAPI parser service and its bounded PDF worker.
2. Connect Node's authenticated gateway to the owned resume bytes and validate the parser response.
3. Add an Extract text action and page-text preview on the resume page.
4. Verify ownership, invalid/scanned PDFs, processing limits, cancellation and service outage behavior.

This establishes a reviewable text result before structured profile extraction, persisted analysis, job matching or Cady. Node remains the data/authentication owner; Python's first endpoint is stateless. Later derived analysis belongs to Python-owned storage. The complete later sequence and outstanding provider/retention choices are recorded in the backlog.

Batch 2 adds modular OOP services, shared OpenAI providers, rich evidence-backed drafts, Python-owned PostgreSQL, numbered saved analysis history and selected-field profile import. See [draft setup and review](resume-drafts.md). Batch 3 implements the approved [job-description analysis plan](job-description-analysis-plan.md), including requirements/evidence, private versions, shared AI limits, source freshness, APIs and the job-detail panel. See [local use](job-description-analysis.md). Batch 4 implements [deterministic CV-to-job matching](cv-job-matching.md) with optional profile skills and source-bound evidence. Batch 5 adds [resume checks/preparation](resume-checks.md) with compact section, terminology and evidence-gap checklists and no new AI calls. Batch 6 adds [saved-job ranking](job-ranking.md) using the same saved comparisons and preference tie-breakers. The [personalized AI preparation extension and initial Cady](personalized-preparation.md) are now implemented. The separately planned Celery executor migration remains future work.

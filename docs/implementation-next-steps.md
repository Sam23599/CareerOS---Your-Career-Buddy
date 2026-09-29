# CareerOS — Review and Next Implementation Steps

Review date: 2026-09-30. Status: local foundation implemented and verified; core workflow first and community in Phase 5 confirmed by the user.

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
| 2. Authentication | Registration, login, JWT access/refresh handling, logout, USER/ADMIN enforcement, protected UI routes, and current-user API | A user can register, log in, refresh, and log out; invalid/revoked refresh tokens fail; protected APIs reject unauthenticated access and unauthorized actions |
| 3. Career profile | Skills, experience, education, preferences, and professional-profile links, with validated read/update APIs and UI | Profile changes persist; one user cannot read or edit another user's private profile |
| 4. Resume management | Upload, metadata, versions, active selection, authenticated download, and deletion; storage abstraction with a local implementation | Supported uploads work; invalid/oversized files fail; access is owner-only; active-resume and deletion behavior are defined and verified |
| 5. Jobs and ingestion | Normalized schema, fixture adapter, then one verified accessible external source; normalization, idempotent ingestion, search/filter/pagination, and job detail UI | Reimporting a source job updates it without duplication; filters match stored fields; failed fetches do not erase existing jobs; one real source works before aggregation is considered complete |
| 6. Saved jobs | Save/unsave, notes, priority, and SAVED/INTERESTED/NOT_INTERESTED states | Repeated saves do not duplicate records; data is private per user; the complete core journey works |
| 7. Complete Phase 1 scope | Company/source configuration, manual refresh for supported adapters, and in-app notifications with read/unread state and preferences | Supported sources can be refreshed; unsupported URLs are clearly identified; users see only their notifications; community remains in Phase 5 |
| 8. Release verification | Critical API/UI journey checks, access-control checks, fresh-checkout setup, API documentation, and status updates | The agreed Phase 1 definition of done is demonstrated locally; future capabilities remain explicitly planned |

## 5. First implementation batch

Step 1 is implemented and verified. It is limited to a running web app, API, and database; see [verification evidence](local-development.md#verification-recorded-for-this-batch).

Proposed layout:

```text
frontend/web/
backend/platform/
docs/adr/
docker-compose.yml
.env.example
.gitignore
```

Use domain modules inside `backend/platform/` as features arrive. Preserve the original Node/Python/Java ownership boundaries; add Python and Java directories when their phases start. Redis remains optional until a concrete requirement justifies it.

Before scaffolding, record the language choice (the README currently allows JavaScript or TypeScript), package manager, supported runtime versions, local ports, and development commands. These are routine implementation choices, not changes to the product vision. Verify dependency versions at implementation time.

For authentication, write down token transport, refresh rotation/revocation, session expiry, password-management scope, and resource ownership before Step 2. For resumes, decide supported formats, size limits, active-version behavior, and local storage before Step 4. For jobs, choose the target geography/source and verify actual integration access before committing to a live adapter in Step 5.

## 6. Documentation approach

Keep `development-plan.md` as the overall roadmap, `phase-1-backlog.md` as the executable release checklist, and architecture documents as domain boundaries. This review is a proposed bridge into implementation, not a replacement roadmap.

Record decisions when needed rather than writing every future ADR up front. Add API contracts with each feature. Update status from working behavior and validation evidence, not from scaffolding alone.

The initial review changed documentation only. The subsequently authorized foundation batch now includes React, Express, MongoDB Compose configuration, API checks, and ADR-001. See [local development](local-development.md) for commands and [the foundation decision](adr/001-local-platform-foundation.md) for accepted choices. Authentication is the next feature batch.

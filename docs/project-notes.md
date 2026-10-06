# CareerOS — Observations and change requests

One ongoing notebook for the whole project: bugs, rough ideas, UX observations, feature requests, questions, and anything else. Write freely in **Your raw notes**; no special format is required. Original notes and refined notes stay together here.

## Working agreement

- Preserve your original wording. Add clarification separately; never silently rewrite or delete a raw note.
- On review, assign stable IDs (`N-001`, `N-002`, …) to new raw entries and link each refined item back to its source ID. Split compound requests into related items when helpful.
- Refine only new or changed notes; update the existing refined entry instead of duplicating it. Record unresolved questions and distinguish assumptions from confirmed decisions.
- Check relevant code/plans before claiming a root cause or that something is already implemented. Add exact file/line references where useful; otherwise label the finding unverified.
- Suggest a small, practical next step and timing. You choose **now / soon / end of phase / end of project / undecided**. Suggestions do not change the roadmap by themselves.
- Notes and scheduled reviews authorize refinement only. Implement a request when you explicitly approve it in conversation or record a clear approval for the named item. An approval for later is not permission to start now.
- Before starting any project stage that will use AI capabilities (LLMs, embeddings, AI-based OCR or similar), notify you first. Explain its purpose, whether it is required or optional, the proposed provider/model or local setup, what data is processed or sent externally, and expected cost/configuration. Provider and budget choices must be settled before external model calls.
- Keep completed/deferred items and decision history in this file. Do not commit, push, or modify application code during a notes-only review.

## Your raw notes

Add entries below. Dates, screenshots/paths, expected behavior, and examples help, but are optional. If you change your mind, append a follow-up referencing the earlier note.

<!-- Write freely below this line. The reviewer will add IDs without changing your words. -->
<!-- N-001 -->
- (just the ui/ux and frontend changes needed mainly) to give a modern fresh and user friendly look.
<!-- N-002 -->
- add support for dark mode so user can pick between the two.
<!-- N-003 -->
- implement a removed/deleted option as well for almost everywhere where the user has deleted anything. this allows them to restore in future in-case if they want to, with a custom (default 30 day) bin cleanup as well. bin cleanup will only soft delete it, allowing the data to persist in db even after delete and bin cleanup. so basically we would be needing 2 type deletes.
<!-- N-004 -->
- an additioanl section of settings should be added to app for some custom user related settings for dashboard/ui/app token/credit usages, recharge/autofil credit etc things. 
<!-- N-005 -->
- add a new window for user to track failure tasks or logs, that they can navigate or mail us, the careerOS developers for to debug and fix.

auth:
<!-- N-006 -->
- add cache for continued session scheck if security-vise applicable.
<!-- N-007 -->
- google auth proper addition still remains.
<!-- N-008 -->
- current card for 'continue as' still require password. we should be able to to sign-in directly in that case, like upto 7 days. in this case, user will be asked for password only when he hasnt logged in since last 7 days.

Jobs and ingestion:
<!-- N-009 -->
- proper separator in jobs section for different jobs platforms that'll be added in future, along with the user custom career pages. and note, user may be adding a lot of dream companies so we need a proper platform and interface for that. 
<!-- N-010 -->
- filters on main job page like skills, employment type, work mode, etc doesnt exactly work. or you may say, they cant filter properly because the original jobs fetched were parsed or structured improperly for filters to apply. maybe using llms to structure it properly would be better.(lets discuss it first with brain bombarding) 
<!-- N-011 -->
- improve job's detail properly with divided sections of like role, responsibility, skills, experience/education, company, employee reviews (use glassdoor, ambitionbox, 6figures, etc).
<!-- N-012 -->
- MAJOR: add a major feature to find emails of the HR or recuiters or of the people (may try linkedln and apollo extension feature) from those companies to show in the job-detail section. may require R&D here as where and how can we fetch those details.

Saved jobs:
<!-- N-013 -->
- more filters by location, date post range, new apply/already applied to that company (this checks and allow the user if he is applying for the first time or not: this is because, a person would be ok to apply casually and be added in company's data records (company he is applying to), and also he might would like to be prepared for some specific ones first then only apply so his record stays fresh and new the company.) 
<!-- N-014 -->
- job analysis should support backend processing once the 'analyze' button has been clicked. continue even if user change page.
<!-- N-015 -->
- one more filter for if the user has applied to the job, application in progress, being interviewed, etc status. this will then later help to track its appliation. (this can be in saved jobs as well or in a better suited place in future)

custom career sources and notifications:
<!-- N-016 -->
- functionality vise it works perfect. just some ui/ux improvements are needed for much cleaner ui and flow.
<!-- N-017 -->
- add linkedln jobs as well for common job sources. my R&D suggests linkedln supports public job search (for example: https://www.linkedin.com/jobs/jobs-in-pune-division?trk=homepage-jobseeker_brand-discovery_intent-module-secondBtn&position=1&pageNum=0), but for easy apply or more diverse search, a linkedln account sign-in is required.So we'll support both. default public search that linkedln allows, then for advance search ask user to sign-in to linkedln through our platform and allow the access to their linkedln, then use it for search and list available jobs. note, for sensitive platforms like this, we'll give user a specific guideline and prompt if they want a more faster scheduled search like every hour or every 30 mins with a warning that that particular platform might limit this feature or is against this type of heavy crawling. 
<!-- N-018 -->
- the newly added jobs should be at the top of the list on '/career-sources/{id}' page. there should be a samll ui separation between old jobs and new jobs so it easier to pinpoint the exact new jobs. also add sorting and filter on top as you type on that page.

nits:
<!-- N-019 -->
- "/status" currently ony have support for only 3 service's status. should track all services.
<!-- N-020 -->
- in docker or services, service name should be more defined for better understanding. intelligence-db-1 should be renamed to better service. 
<!-- N-021 -->
- add compress/expand button for the analyzed jobs/cv etc. currently it occupies the whole window, making the UI inconvinent.
<!-- N-022 -->
- make 'rank your shortlist' more ui friendly and redable. currently it looks like a copy pasted from text. 

## Refined notes

Review: **2026-10-06, Asia/Kolkata**, requested in conversation. All 22 submitted
observations have stable IDs in the raw section. Original wording is preserved.
This is a **notes-only review**, not approval to implement any proposed batch.
Code references below were inspected read-only; no new browser audit or tests ran.
Design proposals are general reviewer judgment using the existing design system;
the local UI skill search did not return a directly applicable compact-layout match.

### Suggested implementation order — awaiting your decision

| Batch | Raw IDs | Smallest useful scope | Suggested timing |
| --- | --- | --- | --- |
| A. Readability and source browsing | N-022, N-021, N-018; relevant N-016 | Clear ranking controls; collapsed analysis sections; source-page new/earlier groups, sorting and live filters | Now, after discussion |
| B. Job filter quality | N-010 | Reproduce failing searches; improve metadata coverage and explain unknown fields before introducing paid enrichment | Soon |
| C. Reliable analysis in the background | N-014, first part of N-005 | Durable owned task/status flow; navigation no longer cancels an accepted generation | Soon; separate backend batch |
| D. Authentication follow-up | N-006, N-008, N-007 | Reproduce the confirmed ordinary-return password prompt; preserve logout behavior; discuss inactivity expiry separately; live Google verification when selected | Soon; reproduce ordinary-return issue first |
| E. Preferences and basic status | N-002, basic N-004, N-019, N-020 | Minimal settings/theme choice and accurate dependency status labels | End of Phase 2 or separately selected |
| F. Storage, tracking and new data sources | N-003, billing N-004, remainder N-005, N-009, N-011, N-012, N-013, N-015, N-017 | Separate design/research per domain; application history stays Phase 3 | Later / undecided |

Batch A is a recommendation, not a commitment or approval. Personalized AI
preparation remains documented in [its plan](personalized-preparation-plan.md)
and held for a later explicit implementation choice; initial Cady follows it.
If the ordinary-return sign-in issue occurs in the same browser within the current
seven-day session, give its focused reproduction priority before the UI batch.

### N-001 — Continue focused UI refinement

- **Raw source / type:** N-001; improvement. Keep the workspace modern and readable.
- **Evidence:** The shared sidebar/navigation already exists in [WorkspaceShell.tsx](../frontend/web/src/ui/WorkspaceShell.tsx#L8); theme/components are defined in [workspace.css](../frontend/web/src/ui/workspace.css#L2). The earlier redesign is implemented; this raw note now calls for continued refinement. A new whole-product visual audit has not run.
- **Proposed change:** Target the concrete friction in N-022/N-021/N-016/N-018 first; preserve shared styling and all features. Avoid another broad redesign without named problems.
- **Dependencies / timing:** Choose affected screens; now only for specific items. **Decision: Pending. Status: Ready for discussion.**

### N-002 — Optional dark mode

- **Raw source / type:** N-002; feature. Let users choose a theme.
- **Evidence:** [workspace.css](../frontend/web/src/ui/workspace.css#L2) defines a single light palette; [styles.css](../frontend/web/src/styles.css#L1) also contains fixed colors. No theme preference appears in the current workspace navigation.
- **Proposed change:** Add Light / Dark / System using shared semantic tokens, a persisted browser preference initially, and a compact user-menu control. Audit remaining hard-coded colors, dialog surfaces and focus states in both themes.
- **Dependencies / timing:** Cross-device account preference can follow the settings API; no LLM. End of Phase 2 or a separately selected UI batch. **Decision: Pending. Status: Ready for discussion.**

### N-003 — Two-stage deletion with retained data

- **Raw source / type:** N-003; feature. Allow recovery from the visible bin for a default 30 days; after cleanup retain the data outside that bin.
- **Evidence:** Resume deletion currently removes file bytes and schedules derived-analysis deletion ([ResumeStore](../backend/platform/src/resumes/store.ts#L46), [analysis cleanup](../backend/platform/src/intelligence/cleanup.ts#L36)); saved jobs and career sources delete records ([saved store](../backend/platform/src/saved-jobs/store.ts#L64), [source store](../backend/platform/src/career-sources/store.ts#L124)). The temporary `deleting` flag/tombstones protect cleanup; they are not a recovery bin.
- **Confirmed requirement:** You selected **hide from the bin after cleanup, but retain stored data** on 2026-10-06. This confirms behavior only; implementation is not approved.
- **Proposed change:** Design `active → trash → retained archive` first for one resource, with separate state/time markers, owner-bound restore during the bin window, configurable cleanup and explicit retained-data handling. PDFs and derived results need compatible retention too, not just a database flag. Previously deleted data is not assumed recoverable.
- **Open question / timing:** Can users restore the retained archive after cleanup, or is access reserved for an explicit support/admin flow? Which resource comes first, and how should linked data behave? Separate storage/lifecycle batch later. **Decision: Requirement confirmed; scope pending. Status: Needs discussion.**

### N-004 — Settings and AI usage versus payments

- **Raw source / type:** N-004; feature, split into settings and monetization concerns.
- **Evidence:** Current [workspace destinations](../frontend/web/src/ui/WorkspaceShell.tsx#L8) have no settings page. Existing profile preferences, password/username settings and notification preferences are separate features. Provider processing limits exist in [IntelligenceClient](../backend/platform/src/intelligence/client.ts#L150); a CareerOS wallet/credit ledger is not established by them.
- **Proposed change:** N-004a: a small settings home linking account, theme and notification preferences. N-004b: truthful usage history only after server-side provider usage is captured. Treat recharge/auto-fill/payment credits as a separate billing-ledger design, not UI counters or an automatic charge toggle.
- **Open question / timing:** Are credits just personal usage visibility or a paid multi-user product? Basic settings sooner/end of phase; billing later. **Decision: Pending. Status: Needs discussion.**

### N-005 — Failure history and shareable diagnostics

- **Raw source / type:** N-005; feature. Give users a place to see failed work and provide useful debugging details.
- **Evidence:** Node produces safe request ID/status/error-code logs ([app.ts](../backend/platform/src/app.ts#L26)), but they are console logs, not a persisted user task history. Raw provider failures are already mapped to fixed messages.
- **Proposed change:** Start with Copy diagnostic details: request/task ID, action, time and safe error code. With N-014, add owned task history with failed/running/completed states. A share/download action should let the user review details; do not send mail automatically or include CV text, credentials or provider bodies.
- **Dependencies / timing:** N-014 task persistence is the useful foundation; full log viewer/email support can follow. Soon/later. **Decision: Pending. Status: Ready for discussion.**

### N-006 — Cache/session restoration investigation

- **Raw source / type:** N-006; question/improvement. Reduce repeated sign-in/session checks where appropriate; related N-008.
- **Evidence:** [session.ts](../frontend/web/src/auth/session.ts#L68) already coordinates restore/refresh, and [AuthService.restore](../backend/platform/src/auth/service.ts#L91) validates the server session. [AuthStore](../backend/platform/src/auth/store.ts#L48) checks active expiry/revocation. Remembered account data is display information, not authentication.
- **Proposed change:** Reproduce the unwanted prompt before adding a cache. Use existing refresh-cookie restoration for normal returns. Any future server cache needs a bounded lifetime plus logout/revocation handling; local remembered identity must never grant access.
- **Confirmed observation / timing:** On 2026-10-06 you reported the password prompt both after logout and on ordinary return. Investigate the latter through N-008; no verified cache bottleneck yet. Soon. **Decision: Observation confirmed; implementation pending. Status: Needs reproduction.**

### N-007 — Complete live Google sign-in verification

- **Raw source / type:** N-007; verification request.
- **Evidence:** Google start/callback and button configuration already exist ([authentication API](api/authentication.md#google-and-github-setup)); [release report](phase-1-release-verification.md#L5) says live Google consent is deferred. It is not a completely missing provider implementation.
- **Proposed change:** When selected, configure the Google app/redirect in the ignored environment, verify button/start/callback safeguards, then complete user-browser consent, return identity and logout/returning-account behavior. Fix observed failures rather than claiming mocks verify live consent.
- **Dependencies / timing:** User Google credentials and interactive consent; never paste secrets in notes. Soon if selected. **Decision: Pending. Status: Ready for setup discussion.**

### N-008 — Continue-as and seven-day behavior

- **Raw source / type:** N-008; improvement/question, related N-006.
- **Evidence:** [tokens.ts](../backend/platform/src/auth/tokens.ts#L6) already defines seven-day sessions. [AuthService](../backend/platform/src/auth/service.ts#L24) sets a fixed expiry, and [refresh](../backend/platform/src/auth/service.ts#L98) does not move it: **absolute lifetime**, not seven days of inactivity. [AuthPage](../frontend/web/src/auth/AuthPage.tsx#L35) opens the dashboard directly for an authenticated session, otherwise requires authentication. Explicit logout revokes it.
- **Proposed change:** Preserve the earlier agreed distinction: a valid session restores directly; an account remembered after logout is an identity shortcut only. Diagnose normal-return failures first. If you want a sliding inactivity policy, design it explicitly with a separate maximum lifetime and server-verified renewal.
- **Confirmed observation:** On 2026-10-06 you answered **both**: the prompt occurs after explicit logout and when returning without signing out. After logout this matches the previously agreed requirement to authenticate again; ordinary return should restore an unexpired valid session. This confirms the report, not the cause of the return failure.
- **Investigation / timing:** Reproduce in the same browser/origin within seven days. Check whether the refresh cookie is present and sent, the safe restore status/error code, and server expiry/revocation; never copy token values. The UI password branch runs when the session is not authenticated. Missing/expired/revoked cookies, restoration failure or session state need evidence before changing caching or duration. No live reproduction ran in this review. Soon, with priority if this occurs during a valid session. **Decision: Observation confirmed; implementation pending; earlier logout behavior remains authoritative. Status: Needs reproduction.**

### N-009 — Clear global sources and dream-company navigation

- **Raw source / type:** N-009; improvement. Distinguish common job platforms and custom company sources at scale.
- **Evidence:** The [job search](../frontend/web/src/jobs/JobsPage.tsx#L57) has a source filter; [workspace navigation](../frontend/web/src/ui/WorkspaceShell.tsx#L10) separates Opportunities and Company feeds. A stronger grouped browsing structure is not currently present.
- **Proposed change:** Keep the existing boundaries; add a clear common-source selector/group and an owner-specific company-source panel with friendly names, search and supported/bookmark/paused labels. Use independent pagination for each view; avoid dozens of company tabs or mixing private preferences into the public catalogue.
- **Dependencies / timing:** Coordinate with N-016/N-018; a focused source-navigation batch after immediate readability fixes. **Decision: Pending. Status: Ready for discussion.**

### N-010 — Diagnose filter quality before LLM enrichment

- **Raw source / type:** N-010; bug report/question. Skills, employment type and work-mode filters do not reflect some imported descriptions.
- **Verified boundary:** [JobStore.list](../backend/platform/src/jobs/store.ts#L66) filters structured `skills`, `employmentType` and `remoteType`, not all description text. [Greenhouse](../backend/platform/src/career-sources/greenhouse.ts#L24) and [Google](../backend/platform/src/career-sources/google.ts#L24) import empty skills and UNKNOWN modes/types. [Remotive](../backend/platform/src/jobs/sources.ts#L24) uses upstream tags/type and REMOTE. Private JD analyses do not automatically enrich global catalogue fields.
- **Understanding:** This is a demonstrated metadata-coverage gap, not proof that every filter is broken. A specific wrong result still needs the source, filter and sample listing to reproduce.
- **Proposed change:** Compare representative filtered searches and provider metadata; expose unknown coverage, improve deterministic mappings where the source states facts, and consider an explicitly labelled description-text skill search. Keep inferred/extracted fields separate from upstream facts. Discuss paid job enrichment only after scope, provenance, ownership/caching and cost are settled; no blanket LLM ingestion now.
- **Dependencies / timing:** User example(s) and model notice if AI enrichment is selected. Soon; priority correctness batch. **Decision: Pending. Status: Needs discussion.**

### N-011 — Structured job details and company reviews

- **Raw source / type:** N-011; improvement/feature, split into two scopes.
- **Evidence:** [JobDetail](../frontend/web/src/jobs/JobsPage.tsx#L82) shows listing metadata, optional skills and a single About the role description. [JobAnalysisPanel](../frontend/web/src/jobs/JobAnalysisPanel.tsx#L124) already renders saved structured analysis facts but exposes many sections at once. No external company-review integration was verified.
- **Proposed change:** N-011a: a compact role/responsibilities/skills/experience/education layout using already saved source-backed analyses, with the original description accessible and no automatic generation. N-011b: initially offer clearly labelled external company-review links; research supported data access, attribution and availability before aggregating reviews or ratings.
- **Dependencies / timing:** N-021 readability work can cover N-011a. Glassdoor/AmbitionBox/other review APIs are **not yet verified** here; do not promise aggregated review data. Structured details sooner; review integrations later research. **Decision: Pending. Status: Ready for discussion / research.**

### N-012 — Recruiter and company contact discovery

- **Raw source / type:** N-012; research feature. Find useful company/recruiter contact details for an opportunity.
- **Evidence:** No such integration exists in the reviewed job flow. Apollo's [people enrichment documentation](https://docs.apollo.io/docs/enrich-people-data) supports identifying a person from supplied information and says enrichment can consume credits. Its [API access documentation](https://docs.apollo.io/reference/apollo-api) makes access plan/account dependent. This is not proof of finding every company's HR or a specific job's recruiter.
- **Proposed change:** Research a small licensed enrichment pilot: job/company domain plus a known person, work contact only, source/lookup time and uncertainty, explicit paid lookup rather than bulk automatic calls. A minimal first feature can be user-entered/public job contact links. Keep unknown contact data unknown and messaging explicitly user-driven.
- **Dependencies / timing:** Provider credentials/access, permitted coverage, costs and scope. No paid queries or messages were sent during review. Later R&D. **Decision: Pending. Status: Research needed.**

### N-013 — Saved-job location/date filters and company history

- **Raw source / type:** N-013; feature, split into filters and application-history concepts.
- **Evidence:** [parseSavedQuery](../backend/platform/src/saved-jobs/store.ts#L26) supports status/priority/pages only. Saved [job summaries](../backend/platform/src/saved-jobs/store.ts#L8) include location but not postedAt; some provider dates are unknown. There is no authoritative company-application history in the saved-job interest state.
- **Proposed change:** N-013a: add location and explicitly named saved-date or posted-date range after choosing which you mean; retain unknown dates and missing-catalogue snapshots. N-013b: show “previously applied to this company” only from actual application records with stable company identity, not inferred from a save or preparation action.
- **Dependencies / timing:** Date meaning needs clarification when this batch is selected. Application-history filters depend on Phase 3/N-015. Location/date sooner; company history Phase 3. **Decision: Pending. Status: Needs discussion.**

### N-014 — Continue job analysis after leaving the page

- **Raw source / type:** N-014; behavior change. An explicitly started analysis should finish in the backend even when the user navigates away.
- **Root cause:** [JobAnalysisPanel](../frontend/web/src/jobs/JobAnalysisPanel.tsx#L53) aborts on unmount; [job-routes.ts](../backend/platform/src/intelligence/job-routes.ts#L19) cancels on disconnect. Generation is currently coupled to the request/browser lifetime. This was deliberate, not a missing spinner fix.
- **Proposed change:** Introduce an owned durable task: explicit start returns accepted task ID; a worker claims it; status/read endpoints expose queued/running/succeeded/failed/cancelled; the existing saved analysis remains the result. Resume the same task on return without resubmitting/charging again. Recheck source lifetime before saving; include bounded queue, lease/restart recovery, idempotent submission and explicit cancel semantics. Durable task data belongs with derived analysis in Python-owned storage; Node stays the authorization gateway.
- **Dependencies / timing:** Separate backend batch linked to N-005; preserve the shared generation limit. Changing disconnect behavior affects an existing paid AI action: notify data/cost/cancellation implications before implementation and settle live verification scope. No new AI calls in this review. Soon, separately from visual fixes. **Decision: Pending. Status: Needs discussion.**

### N-015 — Application states and interview tracking

- **Raw source / type:** N-015; feature. Track applied/in-progress/interviewed states and filter by them.
- **Evidence:** [saved statuses](../backend/platform/src/saved-jobs/store.ts#L6) are only SAVED / INTERESTED / NOT_INTERESTED. The [original roadmap](development-plan.md) places application/workflow tracking in Phase 3; saved interest is intentionally separate.
- **Proposed change:** Keep interest states intact. Add application records with dates/status history and job/company identity in Phase 3; show a compact linked application badge/filter on saved jobs once those records exist.
- **Dependencies / timing:** Application domain and company identity for N-013b. Phase 3. **Decision: Pending. Status: Ready for future planning.**

### N-016 — Cleaner career-source controls

- **Raw source / type:** N-016; improvement. The user reports functionality works; simplify presentation.
- **Evidence:** [CareerSourcesPage](../frontend/web/src/career-sources/CareerSourcesPage.tsx) contains existing add/edit/check/filter/reset/save flows. No new browser rendering audit ran; the reported friction is not treated as a backend failure.
- **Proposed change:** Keep Check now and optional search filters together; show saved versus temporary state clearly; collapse secondary edit/schedule/coverage details; preserve Reset to saved filters and Update saved filters. Improve the source-results page through N-018 before restructuring every source card.
- **Dependencies / timing:** Identify the most troublesome card/flow during batch A discussion. Now for targeted improvements. **Decision: Pending. Status: Ready for discussion.**

### N-017 — LinkedIn job-source feasibility

- **Raw source / type:** N-017; research feature. Add public job discovery, later account-based search/apply capabilities.
- **External verification:** LinkedIn's [API access documentation](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access) lists identity/email/sharing as open permissions and separate approval-based Talent integrations. **Inference:** ordinary LinkedIn OAuth is not evidence that CareerOS receives general job-search/Easy Apply access. The raw example job-search URL could not be fetched during this review, so its current behaviour was not verified.
- **Constraint relevant to the proposed scheduled fetching:** LinkedIn's [official automation guidance](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software?intendedLocale=en&lang=en-us) disallows unapproved scraping/automation; changing frequency or adding a user warning does not establish supported access.
- **Proposed change:** Start with an external LinkedIn search link/bookmark if selected; investigate an official approved integration or licensed feed before promising native import or account-driven search/apply. Reuse the provider registry only when data access is established; do not collect provider passwords/browser cookies.
- **Dependencies / timing:** Supported API/partner access and verified scope/limits. Not an implementation-ready adapter. Later R&D. **Decision: Pending. Status: Research needed.**

### N-018 — New/earlier source jobs, sorting and live filtering

- **Raw source / type:** N-018; improvement. Surface genuinely new jobs above earlier listings and make scanning easier.
- **Root cause:** [matchingJobs](../backend/platform/src/career-sources/store.ts#L148) sorts `updatedAt`; [import](../backend/platform/src/jobs/store.ts#L50) updates that timestamp for every incoming listing. Therefore import recency is not first discovery. Current [SourceJobsPage](../frontend/web/src/career-sources/SourceJobsPage.tsx#L25) renders a flat paginated list without local search/sort controls. [seenIds](../backend/platform/src/career-sources/store.ts#L192) tracks scan matches, not what the user viewed.
- **Confirmed requirement:** On 2026-10-06 you chose **jobs added since I last viewed that source**. This is not “posted recently” or “latest scan”; implementation is not approved.
- **Proposed change:** Track an owner-specific source view marker; classify newly discovered listings against the previous view, pin that boundary for the current visit, and acknowledge only after the page is actually displayed. Reuse immutable job discovery time where suitable; never use mutable import time as the new marker. Show compact New / Earlier groups, preserve pagination, and add a debounced filter/search plus sort controls that work across all matching jobs. Separate in-page query refinements from saved source filters; typing must not silently update saved settings or trigger paid/remote source checks.
- **Open question / timing:** Define first-visit labelling and view acknowledgement in the concrete design; no extra user setup is needed for the main requirement. Now, proposed batch A. **Decision: Meaning of new confirmed; scope pending. Status: Ready for discussion.**

### N-019 — Accurate status for all current dependencies

- **Raw source / type:** N-019; improvement. Extend `/status` beyond frontend/API/MongoDB.
- **Evidence:** [ConnectionStatus](../frontend/web/src/ConnectionStatus.tsx#L28) probes API health/readiness and lists three components. Node [readiness](../backend/platform/src/app.ts#L48) checks MongoDB. Python [ready](../backend/intelligence/app/api/controller.py#L44) checks extraction; capabilities combine parser, derived storage and LLM configuration, so they cannot isolate PostgreSQL health or prove provider network connectivity.
- **Proposed change:** Add a safe authenticated aggregate with frontend/API/MongoDB/intelligence/PostgreSQL and separate AI configured/available labels. Keep checks cheap/bounded; no paid provider probe and no Docker socket in application code. Preserve core readiness during an optional intelligence outage. The frontend rendering is evidence only that this page loaded.
- **Dependencies / timing:** A small private Python dependency-status contract and Node projection; no secrets/connection strings returned. Soon or end of Phase 2. **Decision: Pending. Status: Ready for discussion.**

### N-020 — Friendly service names

- **Raw source / type:** N-020; naming improvement.
- **Evidence:** [docker-compose.yml](../docker-compose.yml) uses `intelligence-db` for PostgreSQL; Compose adds project/service/instance names automatically. Renaming the service can change internal DNS/dependencies and documented startup commands; a display-label change does not.
- **Proposed change:** First show “Intelligence PostgreSQL” / “CareerOS API” in status/docs-facing UI. If a real Compose rename is desired, update all URL/dependency/override references in one separate change and retain the existing named data volume. No database recreation or destructive volume command.
- **Dependencies / timing:** Decide display labels versus actual service keys when selected. With N-019 or later housekeeping. **Decision: Pending. Status: Ready for discussion.**

### N-021 — Collapse/expand CV and job analyses

- **Raw source / type:** N-021; improvement. Stop long analysis content from dominating the page.
- **Evidence:** CV extracted details already have a [collapsed wrapper](../frontend/web/src/resumes/ResumeDraftReview.tsx#L182), and matching/check reports have collapsible groups. However [job analysis](../frontend/web/src/jobs/JobAnalysisPanel.tsx#L124) renders all main categories and CV [profile import](../frontend/web/src/resumes/ResumeDraftReview.tsx#L190) renders review sections. The request is partially addressed, not complete everywhere.
- **Proposed change:** Compact heading/counts and per-section expanders where the body is still long; offer Expand all / Collapse all when useful. Keep source/version/model controls, warnings and the explicit import confirmation visible; preserve edited field state when collapsing.
- **Dependencies / timing:** No new AI calls; coordinate with N-011a and shared design rules. Now, proposed batch A. **Decision: Pending. Status: Ready for discussion.**

### N-022 — Make shortlist ranking readable

- **Raw source / type:** N-022; improvement. Ranking currently feels like pasted text.
- **Evidence:** [SavedJobRanking](../frontend/web/src/saved-jobs/SavedJobRanking.tsx#L63) presents multiple explanatory paragraphs around controls and [results](../frontend/web/src/saved-jobs/SavedJobRanking.tsx#L97) before the compact rows. Rankings themselves already have top-five defaults and expandable reasons. This is a presentation/readability observation, not a verified scoring defect.
- **Proposed change:** One short intro; a clear CV/version selector row; concise preference/profile toggle labels with help text; primary Rank action and secondary refresh. Group result counts and source metadata in a compact header; put method/limits in an expander. Use consistent badges/chips for matched/missing/profile-only items and aligned result rows. Preserve the scoring, exclusions, ownership checks and dirty-note protection.
- **Dependencies / timing:** Follow existing forest-green tokens and mobile/keyboard behaviours; design judgment rather than a new visual audit. No new provider calls. Now, proposed batch A. **Decision: Pending. Status: Ready for discussion.**

### Review decisions and open questions

- **Confirmed:** N-003 cleanup hides from the bin while retaining stored data; N-018 new jobs means added since the user's previous view of that source.
- **Confirmed observation:** N-008 password prompt occurs both after logout and on ordinary return. Investigate the ordinary-return case; the precise cookie/restore failure is not established. Existing seven-day absolute sessions and logout revocation remain unchanged.
- **Pending when selected:** N-003 archive restore access/resource order; N-004 billing intent; N-010 exact failed-search examples; N-013 date meaning; N-017 supported data access. Do not ask all of these at once during unrelated work.
- **Not approved:** None of the proposed implementation batches. Review findings do not authorize code changes, paid calls, external messages, commit or push.
- **Memory:** Personalized AI plan/context is saved separately at the user's explicit request; defer its implementation while reviewing these observations. The repo change for this turn is this notebook only.
- **Updated:** 2026-10-06, Asia/Kolkata. The desired daily 03:00 review is still not a verified background schedule.

## Review log

| Review date (IST) | Notes reviewed | Outcome / decisions |
| --- | --- | --- |
| 2026-10-01 | Notebook setup | Raw and refined sections created. No feature requests or approvals inferred. |
| 2026-10-06 | N-001–N-022 | First submitted-notes review: raw wording preserved and IDs assigned; code and supported-source research checked read-only; minimal scopes/timing proposed. Confirmed: bin cleanup retains data; new jobs means added since last source view; Continue-as prompts both after logout and ordinary return. Normal-return cause needs reproduction. Personalized AI plan saved in memory and held. No implementation, commit or push approved. |

## Daily review setup

Desired time: **03:00 every day, Asia/Kolkata (IST)**. Review everything new or edited since the last recorded review. You can also ask for a review at any time.

**Automation status: Not enabled.** This session has no task-scheduling tool; a file alone cannot trigger a background review. Until a scheduled task is configured, reviews happen when requested in an active session. Do not log scheduled reviews as completed unless they actually ran.

Ready-to-use scheduled-task prompt (run against this local project so it sees uncommitted notes):

> Review docs/project-notes.md in the CareerOS repository. Read its working agreement. Preserve all raw notes verbatim; assign stable IDs and refine new or changed entries in the same file. Consult relevant code and plans read-only, identify the underlying issue where evidence permits, suggest a minimal solution and timing, and record open questions. Preserve the user's decisions and distinguish suggested timing from approved timing. Do not implement, commit, push, or modify any other file. Re-read the file before saving to preserve concurrent user edits. Append a dated review-log entry with IDs reviewed and a short summary; if nothing changed, record one short no-change entry for that date without duplicating refined items. Report items needing the user's decision. Never treat this review as permission to implement.

Scheduling reference: [Scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app).

# Personalized AI preparation — next implementation plan

Status: **Initial implementation complete locally**. Prepared 2026-10-06; selected and implemented 2026-10-07 (IST). See [current use and limits](personalized-preparation.md) and [ADR-017](adr/017-personalized-preparation-and-initial-cady.md).
Follows saved-job ranking and extends [resume checks](resume-checks.md), before
the original roadmap's initial Cady. No endpoint, background generation or paid
provider call was enabled by the original planning document. Implementation now enables explicit generation, verified with mocks only.

## Implementation decisions (2026-10-07)

The user resumed the original preparation → Cady sequence. Extend the existing
PostgreSQL worker now; defer the separate Celery migration. The proposed contracts
below are implemented; [the guide](personalized-preparation.md) describes current
limits. Output caps are 8,192 preparation / 4,096 Cady tokens. Keep twenty selected
requirements, immutable generated content and revisioned reviewed actions.
Cady is a read-only context assistant with bounded account-persisted conversation shared by widget/full page. Earlier Celery
wording below describes future executor replacement, not a current prerequisite.

## First outcome and review flow

`Choose job + CV versions → Review gaps → Confirm learning goals/time → Generate
roadmap explicitly → Follow weekly sessions → Track progress/customize → Save reviewed plan`

Keep one compact action in the job's preparation report. Open a dialog with the
selected versions, prioritized requirements and optional profile skills. Ask the
user to distinguish **already know it / need CV evidence / want to learn / unsure**
for relevant gaps, choose hours per week and target weeks, and optionally add a
short goal. Do not mistake absence from a CV analysis for a proven learning gap.

Generate a brief overview with expandable detailed steps: requirement-linked
goals, practice tasks, a small project when useful, checkpoints, interview prompts
and evidence improvements. Separate learning work from truthful CV improvements.
Show observed source facts separately from AI advice and user-reported context.
Users can edit/skip advice and explicitly save a reviewed plan. Suggestions never
automatically modify resumes/profiles, claim completion, apply to a job or schedule
notifications. Opening an existing plan never calls AI again.

## AI notice, model and data boundaries

Before implementation reaches AI generation, notify the user of its purpose,
optional nature, provider/model, data leaving CareerOS and cost. Notify again
before a new AI-dependent feature/stage; existing credentials are not blanket
permission for paid verification. Keep UI generation explicit and show the selected
provider/model and processing notice before submission.

- **AI required for this optional action:** personalized explanations/tasks.
  Ranking, existing deterministic checks and quoted matching remain usable without it.
- **Provider:** existing shared OpenAI adapter and `LLMService`. Use configured
  model/reasoning capabilities: current project choices `gpt-4.1`, `gpt-6-luna`,
  `gpt-6.1-sol`; proposed default Luna/medium. Resolve only from server capabilities.
  Availability/compatibility and pricing must be verified before live testing;
  these names describe project configuration, not a new availability guarantee.
- **External payload:** only selected requirement text/evidence, relevant CV
  skill/work/project facts, explicit profile skills when opted in, confirmed
  gap classifications, time budget and goal. Remove contact details and unrelated
  employment content. No original PDF, password/token, private saved-job notes,
  unrelated CV/job history or entire profile. Contacts are not needed for this task.
- **Controls:** reuse the shared generation gate, strict structured output,
  `store:false`, fixed input/output/deadline limits and safe error mapping. The
  current PostgreSQL worker executes this optional long-running action with
  durable status/results. The [Celery execution plan](intelligence-background-processing-plan.md)
  later preserves these contracts and the shared generation limit across processes.
  A separate per-user preparation limiter and input bounds fail before provider
  calls on missing/stale/foreign inputs. No automatic generation or retries.
  The task cap is 8,192 output tokens, within current
  60 KB input / 16,384 global output token / 90-second shared ceilings.
- Exact monetary cost is model/usage dependent. Show that generation may incur
  cost; expose safe token usage metadata only if available. Configure provider
  project spending limits before live verification. Do not invent dollar estimates.

## Modular OOP foundation

Reuse infrastructure instead of creating a Cady-only AI subsystem:

| Responsibility | Implemented location |
| --- | --- |
| Typed request/result, source refs, user context, milestones | `backend/intelligence/app/preparation/models.py` |
| Owner-scoped CV/JD loading, matcher/check reuse, orchestration | `app/preparation/service.py` (`PreparationService`) |
| Minimal context projection and prompt construction | `app/preparation/context.py`, `prompt.py` |
| Requirement-reference/source validation and budget checks | `app/preparation/validation.py` |
| Shared provider execution and configurable reasoning | Existing `app/llm/service.py` and `providers/` |
| Versioned derived plan repository | `app/storage/preparation_base.py`, `preparation_postgres.py` |
| Thin service-authenticated route | `app/api/preparation.py` |
| Authoritative ownership/profile/job resolution and output checks | Node `src/intelligence/preparation-service.ts` / verifier |
| Thin authenticated routes and compact review dialog | Node preparation routes; React preparation components |

Future Gemini/Grok providers implement the existing provider interface/capability
contract. No feature may hard-code a provider SDK. Initial Cady shares context
projection and the LLM service; future tools may call preparation through authorized context, preserving ownership,
processing notice, cost controls or confirmation for user-data changes.

## Proposed contracts and storage

Public paths below are implemented; see the [API contract](api/intelligence.md#personalized-preparation-and-initial-cady):

- `POST /api/v1/intelligence/jobs/:id/preparation-plans`: explicit owned resume/CV
  and current job-analysis IDs, profile opt-in, capability-backed model/reasoning,
  confirmed per-requirement classifications, hours/week, weeks and bounded goal.
  Node derives owner/hash/profile facts; the browser supplies the compared profile
  revision for validation. Browser-supplied facts/owner are rejected.
  Return HTTP 202 and an owned task ID; task polling exposes the generated plan ID.
  The accepted generation continues after navigation; review/save remains explicit.
- `GET .../preparation-plans` and `GET .../preparation-plans/:planId`: private
  paginated history and a saved plan; no provider call. Label outdated sources.
- `PATCH .../preparation-plans/:planId/review`: bounded reviewed suggestions/status
  with an optimistic revision. Preserve the immutable generated content; store
  the user's reviewed overlay separately. Review never changes the profile/CV.
- A private service route accepts Node-resolved references and limited opted-in
  user context. Python reads its own source repositories and generates/saves plans.

Strict result shape: `schemaVersion`, `plannerVersion`, source CV/JD hashes and
analysis IDs/versions, optional profile revision, confirmed user context, overview,
prioritized goals/actions with **stable requirement references**, week allocation,
checkpoints, cautions and provider/model/reasoning/createdAt metadata. Source refs
are server-generated; the model returns only bounded advice fields.

Require every job-specific action to reference a real selected requirement.
Validate time allocations and classification membership, reject unknown source
references and instruct the model to avoid invented credentials/results. This
cannot prove every prose suggestion truthful; user review is required. New practice ideas
are explicitly advice, not claims about the user's past. Do not generate resource
URLs or claim courses have been verified; resource discovery is a later feature.

Python-owned PostgreSQL stores private immutable generated versions, with a
revisioned reviewed overlay. Failed/refused/invalid generation stores no plan.
Reusing an old result requires exact source/planner identity and remains a read,
not implicit regeneration. Resume/job removal must suppress access immediately
and follow the [current recovery lifecycle](notes-improvements.md#recovery-and-manual-tracking)
for retained derived plans; historical hard erasure retains cleanup/tombstones.
Profile-only changes label old context rather than silently rewriting plans.
No vectors are needed. The current shared PostgreSQL worker executes preparation;
the planned Celery/Redis foundation can replace that executor later.

## Completed batches and acceptance

1. **Contract/context first:** settle typed action/time/source models and generated
   Node schema; build deterministic minimal context projection. Validate with
   synthetic CV/JD fixtures, including foreign/stale sources and ambiguous gaps.
2. **Generation/storage:** OOP service using shared LLM infrastructure, source
   reference/output validation, numbered versions/review overlay and cleanup.
   Mock providers for success, refusal, malformed output, budget, timeout and
   cancellation. Source changes during generation must not return a current plan.
3. **Gateway/UI:** strict authenticated routes, independent limiter, opt-in model
   selection and readable notice, compact preview/edit/save/history and mobile
   keyboard-accessible dialog. Changes/errors clear previews; closing stops polling
   without cancelling an accepted generation. Queued cancellation is explicit;
   running provider work may still incur its charge. Confirm this notice at implementation.
4. **Verification:** unit, isolated PostgreSQL/Mongo integration and browser tests;
   prove no generation on reads and no silent profile mutation. With explicit
   authorization, run one small synthetic live call after model/key/budget checks.

Initial Cady is now implemented as batch 7 using this reusable context foundation. Tracking
applications remains Phase 3; arbitrary company-page browsing and notebook requests
stay separately prioritized. This plan does not authorize implementing those items.


## Selected refinement (2026-10-08)

Implemented after the user selected flexible weekly study sessions and conversation
persistence across refresh/browser restarts. New roadmaps cover 1–8 ordered weeks,
with objectives, tangible session outcomes and terminal weekly checkpoints validated
before saving. Legacy plans remain readable. One **Review fit & gaps** action combines
existing deterministic results; compact setup retains all user fields. Cady gains
an app-wide launcher, full conversation layout and one account-persisted conversation
with revision conflicts and bounded server-derived history. No Celery migration,
new provider, paid verification, browsing or mutation tools in this batch.
See [ADR-018](adr/018-weekly-roadmaps-and-shared-cady-conversation.md).

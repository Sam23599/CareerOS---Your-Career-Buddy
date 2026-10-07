# Personalized preparation and initial Cady

Implemented locally: 2026-10-07, Asia/Kolkata. The user selected the original
preparation → Cady sequence. AI purpose, inputs, models and charges were disclosed
before implementation. Verification uses synthetic mocked providers, without paid calls.

## Use preparation

1. Open a job with a saved current job analysis. Choose a saved CV analysis and
   run **Review resume & gaps** or **Compare CV to job**.
2. Choose **Create AI preparation plan**. Review up to twenty requirements ordered
   required → unspecified → preferred. Classify them as already known, needing CV
   evidence, worth learning or unsure. Leave irrelevant requirements out. Missing
   CV evidence does not establish a missing skill.
3. Set 1–40 hours/week, 1–12 weeks and an optional goal (1,000 characters). Choose
   server-provided model/reasoning, read the notice and explicitly generate. Allow
   at least one hour for every selected requirement.
4. The accepted task continues after navigation, refresh or closing the dialog.
   Follow it here or at `/tasks`. Queued tasks can be cancelled; running work may
   incur its charge. Interrupted/failed generations are not automatically retried.
5. Expand weekly actions to edit titles/details or mark them planned, skipped or
   done (self-reported). **Save reviewed plan** preserves original AI suggestions.
   Closing with unsaved edits prompts for discard. An old review revision returns
   409; reopen before saving. Saving never changes a CV/profile.

Successful generation saves a numbered version per owner/job in Python-owned
PostgreSQL. Every chosen requirement needs an action; summed integer hours per week
cannot exceed the budget. Unsure choices permit verification/checkpoints; already-known/
evidence-only choices cannot prescribe learning from scratch. Learning cannot become
unearned CV evidence. Failure/refusal/invalid output saves no plan or version.

History loads twenty versions per page. Reads/reviews make no AI call. Changed
job/profile context is labelled and old plans become read-only. Expired listings
are labelled for reference. Removed CVs suppress access immediately; recovery
restores retained plans. Default thirty-day/support-only archive rules apply.
Historical hard erasure removes derived plans, cancels queued work and prevents
late writes with tombstones.

## Use Cady

Open `/cady` from the workspace or **Discuss with Cady** on a job. That link carries
the job and available comparison CV/analysis selection. Choose one CV analysis and
optionally up to three job analyses. Saved jobs populate the selector; the current
job does not need saving. Only current active job analyses are accepted. Profile
skills are optional and labelled self-reported.

Explicit questions return brief paragraphs with expandable source references.
Follow-up buttons fill the question without sending it. Changing context clears
the conversation. Conversation stays in page memory and clears on refresh/navigation/
sign-out; at most six recent messages (2,000 characters each) are sent per question.
There is no server chat history in this initial version. **Stop waiting** cancels
where possible; provider work may already have incurred cost.

Cady uses authorized saved facts and deterministic comparisons. It cannot edit
data, apply, schedule, browse, generate plans through chat or claim completed actions.
Mutation tools require later contracts and explicit user confirmation. LangGraph,
vectors, durable memory, resource discovery and autonomous workflows remain extensions.

## AI inputs and limits

Both reuse `LLMService`, OpenAI structured Responses, `store:false`, no SDK automatic
retry and the existing model/reasoning registry. Configured choices are `gpt-4.1`,
`gpt-6-luna`, `gpt-6.1-sol`; Luna/medium remains the default. Configuration does not
guarantee model access or live availability.

Preparation sends selected requirement text/evidence, corresponding CV/profile
evidence, at most six relevant work/project facts and confirmed classifications/
time/goal. Cady sends up to thirty CV skill/technology facts, ten optional profile
skills and twelve prioritized requirements/comparison facts per job, plus bounded
question/history. Relevant opted-in profile matches can also appear beside requirements.
Contact fields, original PDFs, private job notes and unrelated histories are excluded.
Contact-like strings/URLs in projected text are redacted. This is field minimization
and basic redaction; free-form career excerpts may contain other personal details.

The whole prompt/schema/input retains the 60 KB ceiling; oversize input is rejected
without silent truncation. Output caps are 8,192 preparation / 4,096 Cady tokens.
Both keep the 90-second generation deadline and one shared in-process generation
slot with existing CV/JD services. Each has a separate five requests/owner/fifteen
minutes limiter. Tasks retain twenty active globally/two per owner. No automatic
uncertain paid retry. Actual prices depend on provider/model/usage; no credit ledger
or dollar estimate is invented. Live synthetic verification needs separate approval.

Generated links/contact details and unknown requirement/reference IDs are rejected.
Structured/reference/time validation cannot prove every prose suggestion correct;
review remains necessary. Usage metadata is returned, without changing demo billing.

## Execution and local setup

The existing PostgreSQL task worker now handles `preparation`; successful task
`analysisId` is the plan ID for that kind. Legacy job task shapes/IDs stay compatible.
Request keys deduplicate the same preparation intent; changed input with a reused
key is rejected. Private queued payloads contain references/context, never original files.

A service-token-protected Node source check validates current CV bytes/version,
job hash/expiry and opted-in profile revision before provider execution and before
saving. Unavailable/changed sources fail safely. Node owner-checks every read,
review and Cady response. These cross-service checks are not an atomic MongoDB/
PostgreSQL transaction; the gateway suppresses a source removed just after the last
worker check. Plan save and task finish are separate transactions: interruption
between them can leave a saved version and failed task. Inspect history before retrying.

Migration `004_preparation_plans.sql` adds task kind and `preparation_plans` with
immutable generated JSON and separately revisioned review JSON. Source versions,
goals, usage and model/reasoning are retained. Celery/Redis migration remains planned;
no broker/new SDK is added. See [ADR-017](adr/017-personalized-preparation-and-initial-cady.md).

Compose sets `INTELLIGENCE_PLATFORM_URL=http://api:3000`. Host Python needs that
variable pointing at Node using your `API_PORT`; keep token/key in ignored env.
Rebuild Python with `docker compose up -d --build intelligence`. API/web source
mounts pick up code changes; existing data volumes stay. Pydantic contracts remain
authoritative; regenerate schemas with `scripts/export-draft-schema.py`.

Mocked checks cover source/privacy/citation/time/refusal/cancellation failures,
isolated PostgreSQL history/review conflicts/restarts/cleanup, MongoDB ownership
and browser generation/recovery/review/Cady/mobile flows. Live model quality/access
and paid usage are not verified by those checks.

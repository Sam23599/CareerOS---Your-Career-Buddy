# Intelligence expansion — Cady, retrieval and tools

Status: **E0 usability/source/evaluation foundation implemented locally; E1 is next.** Updated 2026-10-08, Asia/Kolkata, from planning baseline HEAD `5b6f3aa`. [Implementation and checks](intelligence-foundation.md) distinguish the synthetic evaluation starter from pending human-reviewed/live benchmarks. E1–E9 are not implemented by E0.

## Scope and relationship to Phase 2

The user requested a separate plan for the remaining intelligence capabilities, prioritizing Cady's smartness and accuracy even where a better solution costs more. This is an **intelligence expansion track**, not a renumbering of Phase 3, which continues to mean application management. Shared capabilities serve analysis, matching, preparation, recommendations and Cady; they do not belong only to chat.

The original [Phase 2 scope](development-plan.md#5-phase-2--intelligence--ai) included broader ambitions than the implemented baselines. Retrieval, deeper experience/role assessment, resource recommendations and wider ranking are carried forward explicitly below. This separation does **not** declare Phase 2 fully complete or release-verified. Its baseline verification and existing defects stay visible in the [backlog](phase-2-backlog.md). Celery is an earlier planned migration shared with this track, not proof that the current release requires Redis.

The raw notebook's earlier request to put RAG in Phase 2 remains unchanged. The user's latest direction is to finish the selected expansion below, finalize the Phase 2 release, then move to Phase 3. This separate track organizes that remaining work without renumbering the original phases. Planning authorizes documentation only; implementation batches are selected separately.

## Verified starting point

| Capability | What exists | Remaining limitation |
| --- | --- | --- |
| CV/JD analysis | Evidence-validated, immutable numbered analyses; explicit profile import | Resume AI generation still runs inline; original evidence is richer than Cady's projection |
| Matching/checks | Exact/curated-alias skill coverage, literal terminology and section checks | Non-skill requirements stay `needs_review`; no semantic role/experience assessment |
| Preparation | Source-bound AI plans, flexible 1–8-week sessions, saved review/progress; E0 separates week browsing from continuing an unfinished session | No discovered learning resources |
| Ranking | Up to 50 saved jobs; skills, explicit role/location/work-mode preferences and priority | No wider job discovery or broader experience/company/career-goal ranking |
| Cady | Shared page/widget; one account conversation; ten saved pairs, last six messages in prompt | Selected CV required; limited skill/requirement facts; no retrieval or tools; citation IDs do not prove claim support |
| Execution | PostgreSQL tasks for jobs/preparation; in-process executor and generation gate | No Celery/Redis; capacity must become shared before worker cutover |

Evidence: [Cady projection](../backend/intelligence/app/cady/service.py#L42), [citation validation](../backend/intelligence/app/cady/service.py#L70), [conversation storage](../backend/intelligence/app/storage/cady_postgres.py#L47), [matching](../backend/intelligence/app/matching/baseline.py#L90), [ranking preferences](../backend/platform/src/intelligence/ranking.ts#L57), [resume generation](../backend/intelligence/app/resumes/service.py#L27) and [current worker](../backend/intelligence/app/main.py#L61).

## Product behavior to aim for

Cady should find the relevant facts, get fresh information when necessary, explain its reasoning with evidence, and recognize when it needs clarification. Examples:

- “Which of my projects supports this requirement?” retrieves the project's actual evidence, rather than inferring experience from a skills list.
- “What should I practice this week?” reads the current plan and recorded progress, and recommends a verified resource matched to the remaining session.
- “Which saved job fits my goals?” uses declared preferences and explainable comparisons; it keeps missing information separate from disqualification.
- “Find current material for this skill” researches official sources, returns clickable references and states access/cost information where known.
- “Save this preparation plan” shows the proposed action and later reports the owning service's execution result. Fluent text alone is never an execution receipt.

Full saved history, retrieval and memory have different jobs. Keep all retained conversations; recent chats and application activity use sliding windows. Profile, CV and confirmed preferences stay consistent across sessions and update with their source revisions. Assemble about 4,000 tokens of relevant memory/knowledge instead of sending the entire archive. A previous assistant answer is historical advice, not a new fact about the user.

## Independently deliverable batches

E0's initial implementation is recorded below; remaining rows are planned batches. Each new AI-dependent batch needs its AI/data/cost notice before implementation; paid verification needs a separately agreed scope.

| ID | Batch and concrete work | Depends on | Acceptance before moving on |
| --- | --- | --- | --- |
| E0 — initial foundation implemented | Typed source/evidence contracts, offline evaluator and 16 synthetic draft cases; corrected session wording/focus, widget scrolling, disclosures, naming and guarded dismissal (N-035/N-038a/N-041/N-042/N-044/N-034/N-032) | Current baseline | Mocked behavior/contract checks pass; expected evidence still needs human review and expansion before live model/retrieval benchmarking. [Results and limits](intelligence-foundation.md) |
| E1 | Central account AI preferences, default-off per-feature overrides; durable threads/messages; stable account context, sliding windows and ~4,000-token assembly; shared per-call usage instrumentation and rate catalog (N-036/N-037/N-045/N-047) | E0 contracts | Model changes preserve chats; retained threads survive restarts; context is token-bounded and revisioned; every provider attempt has a usage record, including failures/unknown usage |
| E2 | Shared capacity and Celery foundation; migrate jobs **and preparation** from the existing worker, then queue resume generation (N-023/N-043) | Existing [execution plan](intelligence-background-processing-plan.md); E0 source contracts | One executor per attempt; compatible task/version history; broker/restart/duplicate/source-change checks; no automatic uncertain paid retry |
| E3 | Four OOP stages: chunking, indexing, retrieval, generation; selectable pgvector/FAISS, optional hybrid BM25, S3 artifacts/cloud factories and Redis login warming (N-040/N-045/N-048) | E0; E2 for durable indexing/warming; E1 for conversation retrieval and usage | Held-out retrieval/support checks beat baseline; removed/foreign/obsolete content excluded; rebuildable indexes, cold-cache database fallback and safe backend switching |
| E4 | Grounded Cady with Read, Write and Agent/action tools; `get_recommendation_context()` plus bounded drill-down; curated public search/fetch, confirmed profile/interest/plan actions through owning APIs (N-050/N-051/N-053) | E3; E1; provider tool-capability contract; each action's existing domain API | Evidence supports answers; tools have approved scope; writes show reviewed changes; post-action reads verify receipts; no invented execution or unavailable Phase 3 actions |
| E5 | Verified learning-resource discovery and preparation-session recommendations | E4 | Real fetched URLs and relevant topics; access/cost unknowns visible; no invented course links or unauthorised plan changes |
| E6 | Rich role/experience alignment and resume-improvement advice, separately labelled from current skill coverage | E3/E4 | Date overlap and ambiguous relevance handled; each assessment cites CV/JD evidence; unknown remains unknown; original score stays reproducible |
| E7 | Wider job recommendations and bounded reranking using confirmed preferences, E6 assessments and current source state | E6; required preference fields in Node | Explain component reasons/exclusions; missing salary/eligibility is not guessed; wider discovery demonstrably improves useful results |
| E8 | Extend E4's tool contracts to curated API/MCP/plugin integrations, signed webhooks and multi-step approved actions; LangGraph-backed resumable workflows when needed | E4/E2; explicit integration/action scope | Permissions enforced outside prompts; revocation works; events deduplicated; approved commands/restarts return reliable receipts |
| E9 | Friendly Cady persona/icon and optional page-aware Smart Cady (N-039/N-038b) | E4 plus measured usage/budgets | Context-aware suggestions only while open and opted in; bounded calls, caching and stale-result rejection; warmth preserves factual honesty |

E1 and E2 can be developed independently once contracts settle. E3 private retrieval is independently useful before web research; E4's private tools can ship before external access is configured. E5 and E6 can then proceed independently. Batch analysis (N-029) follows E2 using per-item tasks; it does not need a new execution system. Broader theme/list/dashboard requests (N-030–N-033) remain their own UI work.

The [retrieval, memory and tool design](cady-retrieval-and-tools-design.md), [four-stage RAG/storage plan](rag-pipeline-and-storage-plan.md) and [usage/credits plan](ai-usage-and-credits-plan.md) define the contracts behind these batches. Graph-memory and browser options have a separate [research note](graph-memory-and-browser-tools-research.md). Avoid starting all batches together.

## Accuracy and cost policy

Choose quality through evidence, not a larger model name or extra calls alone. Compare the configured OpenAI models on the same reviewed cases. Keep existing model IDs until capability/access checks justify an explicit configuration change. Embeddings, generation, verification and web/API calls have separate usage records.

Invest first in missing source facts, hybrid retrieval and reranking. For complex or consequential answers, evaluate a stronger generation model and an independent support-checking pass. Allow one targeted retrieval repair within a declared budget; otherwise ask a question or explain the missing evidence. Do not use an unrestricted agent loop or retry ambiguous paid work automatically.

Record every provider attempt through the shared usage service: input/output/total tokens, reported cache/reasoning details, effective model/rate version, tool fees, latency and result status, including rejected results and unknown usage. Separate model charges in Settings; actual measured usage replaces demo figures only after instrumentation ships. Credits/payments remain demo/unavailable until their future stage. Store evidence privately; avoid personal content in routine logs. Per-run token/tool/time ceilings and owner budgets must be real server controls.

Evaluation starts with a proposed 50–100 reviewed cases covering exact personal facts, paraphrased requirements, projects, conflicting CV versions, older chats, missing experience, outdated jobs, current web facts and failed tools. Maintain a held-out set and compare each stage with today's Cady. Track retrieval recall, relevance, supported factual claims, abstention, source freshness, correct tool selection, latency and usage separately. Permission/execution violations block release; answer-quality thresholds are agreed from this initial benchmark rather than invented as achieved percentages. Continuous task-specific evaluation follows [official evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

## Confirmed requirements and proposed defaults

The user supplied the knowledge/memory/tool direction and the requirements below on 2026-10-08. Detailed limits and adapter defaults remain reviewable proposals; neither this confirmation nor research authorizes implementation or paid calls.

| Choice | Planning direction |
| --- | --- |
| Knowledge | All authorized career-relevant user/job/company/application/status data; current manual events first, Phase 3 records through owning APIs later |
| Memory | Stable revisioned profile/CV/preferences; sliding chat/application windows; relevant older history; approximately 4,000-token memory/knowledge bundle |
| RAG structure | Separate chunking/indexing/retrieval/generation classes; backend factory for pgvector/FAISS and optional BM25 hybrid search |
| FAISS lifecycle | Private immutable S3 artifacts; cloud provider/service factory methods; async login/session Redis warming, local search RAM and database fallback |
| Tools | Read, Write, Agent/action categories; aggregated live context and targeted drill-down; bounded observe → reason → act → observe loop, with approved tool plans and explicit writes |
| Framework | OOP retrieval and typed tools directly; introduce LangGraph for resumable branches/approval workflows; no mandatory LangChain layer |
| Quality spend | Prefer measured accuracy gains; set embedding/model/tool budgets and stronger-model routing before live calls |
| Usage | Shared provider-boundary accounting for every LLM/embedding call; official fields and model-specific rates exposed separately in Settings |
| Later research | Graph memory after product stages; public search/fetch in E4, bounded browser rendering when needed; authenticated browser actions separately scoped |
| Payments | Discuss wallet/third-party payment integration and optional auto-refill after all product-development stages |

## First implementation scope to select

The user accepted the first implementation direction, and E0 is implemented in [the foundation batch](intelligence-foundation.md). **E1 is the next batch**, including shared usage accounting, central account AI settings, durable threads and bounded context; then E2 execution, E3's four-stage private RAG and selectable backends, and E4's grounded tools/public research. This preserves history and gives retrieval stable inputs. Current application-control tools use existing APIs; full application/interview lifecycle actions wait for Phase 3's owning service. No paid benchmark was run in E0.

## Release closure and later work

After E0–E9, finalize the Phase 2 release: record feature/evaluation results, ownership/recovery/usage checks, provider/setup prerequisites and any explicitly agreed deferrals. Update the original backlog against those results, then proceed to **Phase 3 — application management**. This document does not mark Phase 2 done.

Graph-memory experiments and payments/auto-refill are future work after the product-development stages. They are not Phase 2 release gates. If an integration depends on Phase 3 or supported third-party access, record that dependency/deferral instead of holding Phase 2 open for a capability whose domain does not exist yet.

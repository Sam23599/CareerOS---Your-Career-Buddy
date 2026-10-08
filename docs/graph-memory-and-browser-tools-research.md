# Future graph memory and browser research

Status: **Independent research and future plan, 2026-10-08 IST.** Primary product documentation reviewed; no library/service installed, paid API call or live quality benchmark performed. Graph-memory implementation is proposed **after the planned intelligence/product stages**, not a prerequisite for Phase 2 closure or Phase 3.

## Where graph memory might help

Connected career questions can require relations beyond similar text: user → project → demonstrated skill → job requirement, or user → application → company → status event. A graph may help identify relationships, contradictions and temporal changes. It does not automatically establish facts or solve retrieval accuracy. Use the four-stage RAG baseline as the measured comparator; relational domain IDs and source evidence already supply many useful connections without another database.

| Candidate | What official documentation establishes | CareerOS fit and trade-off — assessment |
| --- | --- | --- |
| Supermemory | Managed memory with graph relationships, temporal updates and static/dynamic user profiles | Useful managed-context candidate; additional vendor processing/cost and export/deletion/control requirements. Inferred memories need our confirmation/trust layer |
| Cognee | Graph/vector ingestion and permanent/session memory; background bridging/enrichment | Candidate for self-managed memory pipelines; requires integration/runtime/permission checks and control of extra generation/embedding calls |
| Neo4j + GraphRAG | Explicit graph database, vector retrieval and graph-building/retriever library | Strong candidate for inspectable career relationships; adds a graph runtime, schema/ingestion work and operational cost |
| LangMem | Semantic, episodic and procedural memory extraction; integration with LangGraph storage | Useful optional extraction/consolidation layer for our confirmed memories; not itself a graph database or a replacement for our source ownership |

Primary sources: [Supermemory graph memory](https://supermemory.ai/docs/concepts/graph-memory), [static/dynamic profiles](https://supermemory.ai/docs/concepts/user-profiles), [Cognee remember](https://docs.cognee.ai/core-concepts/main-operations/remember), [Neo4j GraphRAG](https://neo4j.com/docs/neo4j-graphrag-python/current/) and [LangMem concepts](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/). Claims above describe documented capabilities, not independently measured performance, tenancy safety, current prices or suitability for our users.

Important current-doc findings:

- Supermemory can derive/update facts and maintain temporal relationships; derived inference must not silently become verified CareerOS profile/experience data.
- Cognee's current docs distinguish permanent graph ingestion from session cache with optional background bridging. Its older `add/cognify/memify` examples are legacy; verify the selected release/API rather than copying stale tutorials.
- LangMem offers memory-management patterns; adopting it does not require choosing Neo4j, and graph storage alone does not provide those confirmation policies.
- Neo4j's GraphRAG docs currently flag a Python 3.14 limitation for its optional spaCy NLP extra. Verify runtime compatibility if later selected; do not downgrade the current intelligence runtime solely for this research.

## Proposed experiment after stage completion

Keep `MemoryProvider` / `RelationshipRetriever` interfaces separate from generation and vector storage. First compare the existing PostgreSQL relationship model and hybrid retrieval with one graph candidate on a synthetic, owner-scoped dataset. Do not integrate all four systems together. Neo4j is the initial candidate when explicit auditable relationships are the main gap; LangMem is a separate candidate when extraction/consolidation is the main gap. Evaluate Cognee or Supermemory when their managed pipeline/hosting trade-offs match the selected product requirements.

Proposed graph nodes: UserScope, ResumeVersion, Project, Skill, JobVersion, Company, Application, PreparationSession, Conversation and ConfirmedMemory. Edges such as `DEMONSTRATES`, `REQUIRES`, `APPLIED_TO`, `HAS_STATUS`, `PREPARES_FOR` and `SUPPORTED_BY` carry owner/visibility, source/version/span, valid-from/to, observed time and trust/confirmation status. Extracted or inferred edges are proposals until validated. Prefer direct domain facts over unconstrained model-generated entity links.

Compare relationship recall, claim support, temporal contradictions, cross-owner isolation, source deletion propagation, export/rebuild, token/tool spend and latency. Success means a material improvement on questions the baseline fails, without weaker privacy/source contracts. Provider claims about “better memory” are not our acceptance benchmark. Keep full evidence in canonical storage and enforce current access before graph traversal/context generation. No secrets or raw credentials enter this experiment.

## Internal browser/search as a Cady tool

Feasible, but split the capability into levels:

| Level | Concrete capability | Proposed timing |
| --- | --- | --- |
| Public search | Search API/Responses web search; retrieve recent official career/learning/company sources with clickable citations | E4 read/research tools, with the user's tool-plan confirmation |
| Public page reader | Fetch static pages; an isolated browser worker renders JavaScript-only pages and returns visible text/metadata/evidence | E4 extension when source research needs it |
| Browser navigation | Bounded page navigation/search controls through typed Playwright tools or a supported computer-use model | Later selected browser-tool batch, with checkpoints/run diagnostics |
| Authenticated external actions | Sign-in/session handling, forms/submissions/messages | Separate integration/action scope after supported access and review; never inferred from public-search permission |

OpenAI documents [web search with live/cached access and citations](https://developers.openai.com/api/docs/guides/tools-web-search) and [computer use](https://developers.openai.com/api/docs/guides/tools-computer-use), including application-supplied isolated browser execution. Model tool support must be verified for our configured choices; do not silently switch models or assume every provider offers the same browser tool. Ordinary search/fetch requires less orchestration than full screenshot-driven computer use.

Recommendation: begin with public search plus bounded fetch; add a sandboxed Playwright rendering adapter only for pages that need it. Cady controls CareerOS through typed internal APIs, which provide revision checks and receipts; browser automation is for external research/UI access, not a substitute for our own APIs.

Browser workers need isolated sessions, no application/admin cookies by default, network/redirect restrictions, source byte/time/action limits, navigation budget, cancellation, typed observations and provenance. Treat page instructions as untrusted content. Account/login/CAPTCHA or unsupported sources produce a clear handoff rather than speculative success. Verify a page/result before citing it. Public research can refresh a bookmarked source, but it does not silently promote that site to a reliable native ingestion connector or schedule crawling.

Every model/tool/browser attempt flows into the [usage plan](ai-usage-and-credits-plan.md). Useful progress is visible in Cady/task history; uncertain external mutations use receipt reconciliation. Page-aware suggestions remain opt-in and bounded.

## Placement in the roadmap

Finish E0–E9 and the agreed Phase 2 release verification, then move to Phase 3 application management. Graph memory remains a future experiment after the planned product stages; initial browser research can ship as part of E4, while autonomous/authenticated browser actions stay separately selected. Payment/refill discussion also remains at the end of product development, as the user requested. Future experiments do not hold Phase 2 open indefinitely.

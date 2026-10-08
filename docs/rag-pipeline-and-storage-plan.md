# RAG pipeline, search backends and cloud storage

Status: **Planning requirements confirmed in conversation, 2026-10-08 IST.** Implementation has not started. This extends the [Cady design](cady-retrieval-and-tools-design.md) and [expansion sequence](intelligence-evolution-plan.md); shared RAG serves all intelligence features, with Cady as one consumer.

## Four explicit stages

Each stage owns its classes, public functions, typed inputs/results and focused checks. The pipeline composes them; controllers, Celery adapters and startup only validate/route/wire. Storage/provider factories are injected, not selected inside prompts or domain methods.

| Stage | Proposed module/classes | Public functions | Responsibility/result |
| --- | --- | --- | --- |
| Chunking | `rag/chunking/`: `ChunkingService`, `SectionChunker`, `TokenWindowChunker` | `chunk(source, policy) -> ChunkBatch` | Complete CV/project/JD/session units first, bounded narrative windows second; original quotes, spans, source/version/owner metadata and stable chunk hashes |
| Indexing | `rag/indexing/`: `IndexingService`, `EmbeddingService`, `IndexRepository` | `index(batch, config) -> IndexManifest`; `invalidate(source)`; `rebuild(scope)` | Persist canonical chunks, create embeddings and optional sparse indexes, publish a coherent generation; source changes/deletions cannot reactivate old indexes |
| Retrieval | `rag/retrieval/`: `RetrievalService`, `HybridRetriever`, `RankFusion`, `Reranker` | `retrieve(query, scope, policy) -> EvidenceBundle` | Authorized structured lookup and dense/optional sparse search, rank fusion, reranking, exact evidence/freshness checks and labelled fallback |
| Generation | `rag/generation/`: `GenerationService`, `ContextAssembler`, `ClaimVerifier` | `generate(question, evidence, memory, options) -> GroundedAnswer` | Assemble the bounded context, call shared LLM infrastructure, verify citations/claims and return answer/usage/source metadata |

`RagPipeline.index_source()` runs chunking → indexing; `RagPipeline.answer()` runs retrieval → generation. Indexing is durable/background work; retrieval/generation is the interactive query path. Do not rechunk/reindex the full corpus per turn. Tool orchestration surrounds these stages and invokes owning domain APIs; tools do not become a fifth hidden RAG stage. Existing parsing/analysis remains reusable.

## Selectable dense and optional sparse search

`VectorBackend` exposes `build`, `publish`, `search`, `invalidate` and `health`; `VectorBackendFactory.create(config)` returns `PgVectorBackend` or `FaissBackend`. Both return canonical chunk IDs/scores through the same contract. PostgreSQL owns source/chunk/manifests regardless of the dense backend. FAISS is a search library, not the canonical document database or an authorization service.

Proposed settings: `vectorBackend=pgvector|faiss`, `hybridEnabled`, `lexicalBackend=postgres_fts|bm25`. Keep pgvector and lexical/vector fusion as the recommended first delivery. BM25 is optional and capability-gated; do not label PostgreSQL `ts_rank` as BM25. When hybrid is enabled, combine dense and lexical **ranks** using reciprocal rank fusion rather than adding incomparable raw scores.

`LexicalSearchBackend` has PostgreSQL full-text and optional BM25 implementations. For small private corpora, evaluate an owner-scoped Python BM25 implementation shared by both dense backends. Persist versioned tokenization/corpus metadata; derive it from the same active chunk generation. For larger collections evaluate a SQL BM25 extension behind that interface. Do not silently install another search server. Relevant primary references: [rank_bm25](https://github.com/dorianbrown/rank_bm25) and [ParadeDB text search](https://www.paradedb.com/docs/concepts/full-text/overview). These are candidate adapters; dependencies/runtime compatibility remain to verify.

Apply owner/scope/active-source predicates to every search path, including BM25 corpus construction. Public jobs and private career data use separate authorized scopes; private matches never leak through shared scores, snippets or caches. For small FAISS corpora use isolated owner indexes; current source checks also exclude removed/outdated IDs. Mixed private indexes with only a final post-filter are not an acceptable first implementation. Exact structured facts/scores still come from owning APIs, independently of retrieval mode.

### Compact Settings UI

Offer only server-configured backends in advanced AI Settings; disabled options explain missing setup. A small labelled info button opens a short keyboard-accessible popover on focus/click; Escape dismisses it. Suggested user-facing copy:

| Option | Info text |
| --- | --- |
| pgvector | “Searches in the database. Easier updates and filters; uses database capacity.” |
| FAISS | “Searches an index in memory. Needs RAM and warm-up; S3 stores its index files, db stores original data.” |
| Hybrid / BM25 | “Combine meaning with exact words. BM25 can help with skill and company names; it needs an extra keyword index.” |

The user's preference requests a backend; server capabilities determine availability. Changing it schedules a rebuild, exposes pending/ready/failed state and keeps the previous ready backend until the new index passes checks. No rewrite of original data or destructive database/image change. This is not a promise that FAISS is always faster/cheaper or that pgvector is always more accurate; benchmark both.

## FAISS files in S3, Redis warming and database fallback

Storage roles:

- **PostgreSQL:** authoritative chunks, source state, document ID mapping and ready manifest/generation pointers. Node remains authoritative for its original data.
- **S3:** private immutable FAISS artifacts, ID maps and optional sparse artifacts, keyed by opaque owner/scope/index version. No personal names in object keys.
- **Redis cache:** index/document IDs, manifest pointers, bounded hot authorized document/context projections and readiness metadata; TTL/version-based cache.
- **Search process:** verified FAISS index loaded into bounded local RAM, optionally a bounded local file cache. Redis is not required to hold every binary index.

1. Worker builds from a validated chunk generation and uploads immutable artifacts plus dimensions/model/chunker/index version, checksums and row counts.
2. Read/verify artifacts before publishing the PostgreSQL ready-manifest pointer with expected revision. Interrupted uploads remain unpublished; reconcile orphan objects later. S3 and PostgreSQL are not one atomic transaction. Use appropriate conditional object writes where applicable, per [S3 PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html).
3. Successful local/OAuth login or authenticated session restoration sends a deduplicated owner-scoped warm request **after** session establishment. Login never waits for S3, embeddings or index loading and never initiates a new LLM call. Restore/warm hooks use the same owner checks; repeated refreshes do not enqueue unlimited work.
4. `IndexWarmupService.warm(owner, revision)` warms Redis IDs/manifests/hot context and schedules that owner's index into the serving search worker. Warm each process on demand as needed; warming one instance does not warm every replica. Use leases, TTLs, quotas and bounded LRU eviction.
5. Redis miss/outage reads PostgreSQL; FAISS cold/missing/invalid artifact immediately uses bounded structured/lexical database retrieval while warming continues. Show “using database search” when the answer depends on this fallback. A database fallback preserves availability; **instant full semantic equivalence is not guaranteed**. Pgvector fallback exists only if a compatible index is configured.
6. Source changes invalidate versioned cache access; authoritative availability checks still run before model context/delivery. Explicit logout may evict hot private entries; revocation/removal suppression cannot depend on TTL alone.

Load only our verified artifacts. FAISS documents that `read_index` does not validate untrusted data; validate checksums/size/type and limit memory before loading. [FAISS index IO](https://github.com/facebookresearch/faiss/wiki/Index-IO,-cloning-and-hyper-parameter-tuning) describes persistence; the S3/Redis lifecycle above is a CareerOS design proposal. Cache-aside miss/invalidation behavior follows [Redis documentation](https://redis.io/docs/latest/develop/use-cases/cache-aside/).

Keep broker durability separate from cache eviction. Prefer a separately configured Redis cache when adding FAISS; separate logical databases do not isolate a Redis instance's memory/eviction policy. No Redis/S3/FAISS service is started by this plan.

## Cloud provider factory structure

Proposed `app/cloud/` layout:

```text
cloud/
  contracts.py             CloudProvider, ObjectStorage, SecretStore capabilities
  factory.py               CloudProviderFactory.create(name, config)
  providers/aws.py         AwsCloudProvider factory methods
  services/s3.py           S3ObjectStorage adapter
  services/local.py        LocalObjectStorage for development/testing
  models.py                ObjectRef, ObjectMetadata, CloudCapabilities
```

`CloudProviderFactory` chooses a registered provider. Provider factory methods `create_object_storage()` / later `create_secret_store()` produce its service family. `ObjectStorage` provides typed `put/get/head/delete` operations, checksums, timeouts and private object references. The indexer depends on this interface, not boto3 or a vendor bucket URL. Test through an injected local/fake adapter. Implement AWS/S3 first for the selected FAISS path; GCP/Azure adapters are extension points, not pretend-supported services. Unsupported capabilities fail clearly. Redis caching and Celery execution keep their own interfaces instead of being misrepresented as generic cloud object storage.

Credentials/configuration stay server-side with scoped access; UI selects available capabilities, not cloud keys. Do not create buckets, enable charges or migrate original resume files under a planning request. Set up cloud/local fallback only when the FAISS implementation batch is explicitly selected.

## Approximately 4,000-token context bundle

`ContextAssembler` builds one labelled bundle from separate versioned parts. The target is **about 4,000 tokens for memory + knowledge**, not 4,000 stored-history tokens or the model's total context window. System instructions, current question, tool schemas and output/reasoning allowance are additional; count the complete provider request against model limits and for usage/cost. This interpretation is the proposed concrete budget for the user's approximate limit.

| Part | Initial allocation | Update/lifetime |
| --- | ---: | --- |
| Account identity, goals and confirmed preferences | 400 | Consistent across sessions; revisioned when changed |
| Career profile, active CV and relevant project/experience facts | 900 | Stable knowledge, selected/retrieved projection; change on source revision |
| Recent conversation | 900 | Sliding window, up to the last six messages bounded by tokens |
| Recent applied jobs/company/activity/status | 400 | Sliding recency/event window plus relevant ongoing work; current status from owning service |
| Relevant older conversations/confirmed memories | 500 | Retrieve by relevance/date; distinguish user statement from assistant advice |
| Job/resource/analysis/tool evidence | 700 | Query-dependent, refreshed and source-bound |
| Source labels/locators and formatting allowance | 200 | Count actual serialized tokens |
| **Target** | **4,000** | Soft allocations with a firm configured input cap |

Reallocate within the total: evidence-heavy questions can borrow from chat/older history; do not inject six long messages plus ten full chunks unconditionally. Use the model-compatible tokenizer, preserve complete supported facts/quotes and trim irrelevant/duplicate material first. Historical summaries are derived and linked back to messages; optional AI summarization is a separately metered task. Missing essential evidence requires retrieval/clarification, not invented context.

Retain full history in storage while the prompt window slides. Proposed first application window is last 20 relevant events/30 days, with ongoing applications kept relevant even when older; tune these limits in E1. Sliding context is not deletion or automatic status changes. Stable profile/CV memory is consistent across sessions but never frozen against edits/deletions. Versioned Redis context keys include owner, source revisions, conversation/event window and settings revision.

Knowledge covers **all authorized career-relevant user and job/company data**: profiles/CVs/projects, chats, saved/applied jobs, declared interest, status/events, plans/progress and related analyses. Retrieval selects what fits the question and budget. Existing manual application events are available now; authoritative Phase 3 application/interview records will arrive through their owning APIs later. Do not claim real external applications/interviews are known merely from a saved listing.

## Delivery and acceptance

E1 settles persistent context/window/settings contracts; E2 supplies indexing and warming tasks. Split E3 into four reviewable deliveries: chunking contracts and canonical chunks; indexing with pgvector; retrieval/generation and evidence budget; then FAISS/S3/Redis/BM25 alternatives. The user can choose either ready backend; the default first implementation remains pgvector for the current local stack.

Check stage isolation, chunk/evidence integrity, embedding identity/dimensions, index publish/rebuild interruption, per-owner search/cache access, duplicate login warming, cold/invalid S3 indexes, Redis/database outages, source revocation, backend-switch rollback, optional BM25 ranking and actual serialized context bounds. Compare retrieval support/recall and latency across ready backends, not only speed. All provider/embedding verification starts mocked; settle costs before live calls.

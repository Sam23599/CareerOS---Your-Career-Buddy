# E0 — Usability and evidence foundation

Implemented locally on 2026-10-08, Asia/Kolkata, after the user selected the first intelligence implementation batch. This delivers the E0 usability fixes, reusable source/evidence contracts and an offline evaluation starter. It makes no new AI calls and does not yet connect retrieval or tools to Cady. [E1](intelligence-evolution-plan.md#independently-deliverable-batches) remains next: account AI defaults, durable conversations/context and shared usage accounting.

## What changed in the UI

| Area | Current behavior | Notebook IDs |
| --- | --- | --- |
| Preparation roadmap | **Previous week** and **Next week** browse sequentially. **Continue preparation** goes to and focuses the first globally unfinished session; its week is named explicitly. Browsing never marks sessions done/skipped or saves a review. | N-035 |
| Cady | Context starts collapsed; welcome text is smaller. The widget keeps its header/composer available while messages scroll. Reading older replies preserves the scroll position when an answer arrives; **Jump to latest** resumes following. New questions follow the latest messages, including when the existing ten-pair history window rotates. | N-038a |
| Analysis history | Display labels include the resume filename or job title/company, analysis version, model, reasoning when applicable and creation date. IDs, source names and stored version numbering are unchanged. | N-034 |
| Job analysis | **Analysis versions & settings** and the selected analysis both start collapsed. Generation, history pagination, comparisons and field expanders remain available inside; processing, failure, stale and expired notices remain outside. | N-041 |
| CV/job comparison | **Resumes** and **Resume analysis** share a group with an explanation linking the uploaded PDF to its saved analyses. Changing inputs still clears previous comparison results. | N-042 |
| Dialogs | Escape and genuine backdrop clicks use the existing close function for Cady, PDF/text previews, CV draft/checks, preparation and the optional password prompt. Content clicks and inside-to-outside drags do not close a dialog. Existing discard confirmation, busy guards, cancellation and focus recovery remain. Closing preparation does not cancel accepted background execution. | N-044 |
| Navigation | Sidebar, breadcrumb and list-page destination names consistently use **Jobs**, **Saved jobs**, **Resumes**, **Career sources** and **Notifications**. Dashboard/profile exceptions and routes remain. | N-032 |

Use a job's **Preparation roadmap** for the week controls, `/cady` or **Ask Cady** for scrolling/context, and a job's **Job analysis** panel for the disclosures. Resume history labels appear under `/resumes` → **Resume draft**, and in comparison, checks, ranking and Cady selectors.

## Shared source and evidence contract

[Python models](../backend/intelligence/app/knowledge/models.py) are the source of truth. `SourceRef` records private/public scope, owning account, source type/ID/version, SHA-256 content hash and visibility revision. `KnowledgeSource` adds lifecycle, trust kind and canonical text. `EvidenceSpan` names an exact quote with start/end offsets and at least one page, section or field-path locator. `EvidenceBundle` has schema version 1 and bounded source/passage lists. The generated [JSON schema](../backend/platform/src/intelligence/knowledge-evidence.schema.json) prepares the platform boundary; no new endpoint consumes it yet.

`contentHash` hashes the canonical projection's UTF-8 text, not the original PDF bytes. Existing PDF hashes remain separate source identity checks. Span offsets are zero-based Python string/code-point positions, end-exclusive, within that same canonical text. Future JavaScript consumers must preserve this convention when handling non-BMP characters. Source adapters must produce deterministic text and retain revision/provenance rather than silently reusing offsets after edits.

[EvidenceContractValidator](../backend/intelligence/app/knowledge/validation.py) rejects foreign private owners, inactive/trash/support-only archived/obsolete sources, mismatched hashes, duplicate sources/evidence IDs, unknown source revisions and quotes that differ from their exact text span. Public scope is limited to jobs, companies and resources; private CV/profile/chat data cannot be relabelled public through this contract. Trust kinds distinguish original text, self-reported facts, assistant advice and derived assessments.

This validates trusted snapshots, not live authorization or claim truth. Owning APIs must check current access, content/visibility revisions and lifecycle before supplying snapshots and before returning results; callers cannot make a removed source active merely by posting these fields. An exact quote still requires a separate check that it supports the final claim. These models are a foundation for E1/E3, not a replacement for existing CV/JD validation or an active RAG pipeline.

## Offline evaluation starter

[The fixture](../backend/intelligence/tests/fixtures/cady-evaluation.json) contains 16 explicitly synthetic draft cases with expected/forbidden evidence and a review rubric. They cover exact facts, projects, negation, ambiguous dates, profile-versus-CV evidence, manual application status versus submission proof, current status/preferences, CV revisions, ownership, removed/support-only archived sources, public resources, tool failure, embedded instructions and assistant advice versus confirmed experience.

[EvidenceEvaluator](../backend/intelligence/app/evaluation/service.py) checks reviewed observations for retrieval recall, required citations, forbidden evidence, references absent from retrieved evidence, abstention and independently labelled unsupported claims. It requires exactly one result per case and rejects unknown evidence IDs, duplicate cases, omissions and extras. `unsupportedClaims` must be filled by a reviewer or independent verifier; it is not inferred from citation membership or accepted as the answer model's self-assessment.

Validate definitions without any model call:

```sh
backend/intelligence/.venv/bin/python scripts/evaluate-cady.py
```

Score a JSON array of reviewed observations containing `caseId`, `retrieved`, `cited`, `abstained` and `unsupportedClaims`:

```sh
backend/intelligence/.venv/bin/python scripts/evaluate-cady.py --results /tmp/cady-reviewed-observations.json
```

Definitions-only output explicitly says **No answers evaluated**. Passing the synthetic control tests proves the evaluator detects configured conditions; it is not a measured Cady accuracy score. The fixture remains `synthetic_draft`. Before live retrieval/model comparisons, review the expected answers/evidence with a human, expand to the planned 50–100 representative cases, reserve held-out cases and agree meaningful quality thresholds. Live provider verification still needs a separately agreed scope.

Results mode prints the report and exits 1 if any case fails; malformed/incomplete observations also fail the command. A passing exit code reflects only the supplied reviewed observations and contract checks, not independent semantic verification.

## Verification recorded

- Node 24.21.0: typecheck, ESLint and production build pass; generated schemas match Python.
- Linux Docker intelligence suite: **155 passed, 8 skipped**. Skips require an explicitly configured isolated PostgreSQL integration database. A native macOS full-suite attempt returned 15 parser readiness failures because `WorkerMemoryBudget` deliberately requires Linux; the supported Docker run passes those checks.
- Playwright component gallery: **11 passed**, including content-click/drag protection, genuine backdrop dismissal, Escape and PDF object-URL cleanup.
- Mocked preparation/Cady/job-analysis/draft-dismissal/comparison/resume-check browser flows: **11 passed**, including unchanged generation counts, saved versions, dirty-edit protection, the ten-pair scroll limit and mobile overflow checks. No real account writes or paid provider calls were made by these tests.
- Offline fixture validation: **16 valid definitions; no answers evaluated**. Human benchmark review and real RAG/tool accuracy remain future checks.

No infrastructure migration, Redis/Celery/vector dependency, paid AI call, commit or push is included. This is not Phase 2 release verification. Existing account history is still bounded to ten pairs; centralized AI preferences, complete retained threads, real usage totals and token-budgeted account context belong to E1. Smart Cady, resource research, tool writes and the FAISS/S3 pipeline remain later batches; S3 will store FAISS index artifacts while actual content remains in database/Redis.

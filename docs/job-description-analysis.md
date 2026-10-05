# Job-description analysis — local development

Phase 2 batch 3, implemented locally on 2026-10-05 (Asia/Kolkata). See [ADR-012](adr/012-job-description-analysis.md) and the [approved plan](job-description-analysis-plan.md).

## Try it

1. Use the existing root `.env` OpenAI key and model defaults. Run `docker compose up -d --build --wait`; migration 002 preserves resume drafts and existing volumes.
2. Sign in, open a job from `/jobs` or your saved jobs, and find **Job analysis** on its detail page.
3. Choose model/reasoning and click **Analyze job**. This sends only listing text to OpenAI and incurs provider charges. No automatic analysis occurs when browsing or refreshing sources.
4. Review sections, source quotes, priority evidence and warnings. Compare listing details with extracted details. Original text stays below the panel.
5. Each successful analysis saves a version. Open older versions using **Saved analysis version**; **Load older analyses** pages beyond twenty results without another AI call.

Changed source text labels saved results as outdated. Import timestamps alone do not. Expired listings keep saved analysis readable but cannot generate again. Failed generation keeps any earlier saved result visible. Saved records remain readable without an OpenAI key. Navigation/sign-out or Cancel processing aborts the request; a completed result may already have been saved before a late disconnect.

No resume/profile information is sent in this stage. It does not fix original provider search metadata, apply profile changes, score candidates or implement arbitrary career-site browsing.

## Code and storage

| Location | Responsibility |
| --- | --- |
| `backend/intelligence/app/jobs` | Schema/prompt, quote offsets, evidence/priority policy and generation service |
| `backend/intelligence/app/llm/gate.py` | Shared resume/job generation concurrency and shutdown |
| `backend/intelligence/app/api/jobs.py` | Service-authenticated job controller |
| `backend/intelligence/app/storage/jobs_*` | PostgreSQL repository using the existing private database/pool |
| `backend/platform/src/intelligence/jobs.ts` | Canonical source hashing and independent result verification |
| `backend/platform/src/intelligence/job-service.ts` | Authenticated job context, source rechecks and read freshness |
| `backend/platform/src/intelligence/job-cleanup.ts` | Durable reference tracking and eventual hard-removal cleanup |
| `frontend/web/src/jobs/JobAnalysisPanel.tsx` | Explicit analysis, evidence/warnings, metadata comparison and history |

Derived records live in `job_analyses` in the existing `intelligence_db_data` PostgreSQL volume; originals remain in MongoDB `jobs`. `deleted_job_sources` stores only owner/job IDs and a deletion timestamp. MongoDB `job_analysis_sources` retains cleanup references across service/database outages. Scans inspect up to twenty-five references per thirty-second interval; large sets and outages extend cleanup time. Expired records are retained. No new port, provider key, package or separate database is required.

The requested models and compatible reasoning controls are unchanged; Luna/medium remains the default. Initial bounds remain 60 KB total input, 16,384 output tokens, a ninety-second provider deadline, one shared generation/no queue, a 140-second Node deadline and a 2 MiB response bound. Long descriptions fail clearly rather than being truncated. Priority labels use explicit English cues; non-English/ambiguous priority can remain unspecified. Exact quotes and schema validation do not prove every interpretation correct; inspect the evidence.

## Validation recovery

Quotes that differ only in whitespace can be recovered when they identify one source
span. Stored evidence always uses the exact original text and character offsets. Changed
words, punctuation, ambiguous spans, oversized quotes and unsupported claims still fail.
The OpenAI adapter ignores intermediate `commentary` messages and validates one final
result, consistent with [OpenAI message phases](https://developers.openai.com/api/docs/guides/reasoning).
Multiple final results still fail.
An explicit output-token-limit response reports the budget error and does not retry.

Job analysis retries invalid AI output once with the failed field and reason in its
instructions. Both attempts share one ninety-second generation deadline and one
concurrency slot. Refusals, provider outages, rate limits, input-budget failures and
timeouts do not retry. The retry can incur one extra provider charge. Only a verified
result saves a version; failed attempts retain earlier versions. Usage includes both
completed provider results when evidence fails on the first attempt; usage is unavailable
when the SDK raises a parsing error before returning a result.

Internal diagnostics include the validation stage, a fixed reason and schema field path;
retry logs also include the model and attempt. Extra-property names, quotes, source
content, credentials and raw provider exceptions are excluded. The public error remains
the existing safe message. Implementation: `app/jobs/evidence.py`, `app/jobs/service.py`
and shared `app/llm/validation.py` / `app/llm/providers/openai.py`.

## Verification commands

```bash
docker compose --profile test run --rm --build intelligence-tests
npm run lint
npm run typecheck
npm test
npm run build
backend/intelligence/.venv/bin/python scripts/export-draft-schema.py --check
# In the API container; tests create and remove their own MongoDB database:
docker compose exec -T -w /app -e TEST_MONGODB_URI=mongodb://mongodb:27017 api node --import tsx --test backend/platform/test/job-analysis.integration.ts backend/platform/test/drafts.integration.ts backend/platform/test/intelligence.integration.ts backend/platform/test/resumes.integration.ts
npx playwright test frontend/web/e2e/job-analysis.spec.ts frontend/web/e2e/jobs.spec.ts frontend/web/e2e/drafts.spec.ts
```

The schema export script checks both resume and job contracts. Regular tests mock AI and do not use the root OpenAI key. Live access/model availability for this new stage is not inferred from mocked success.

## Verified locally — 2026-10-05

- 59 Python checks passed, including PostgreSQL migration, concurrent versioning, owner isolation and deletion safeguards.
- 55 Node checks and 27 MongoDB integration checks passed, including existing resume/extraction regressions.
- Four Chromium flows passed across job browsing, saved jobs, resume drafts and job analysis. The new flow covers explicit generation, quoted evidence, saved versions, stale results, recoverable failures and mobile layout.
- Lint, both TypeScript checks, backend/frontend builds, both generated schema checks and whitespace checks passed.
- MongoDB, PostgreSQL, intelligence, API and web restarted successfully with existing volumes retained and report healthy.

The initial implementation checks above mocked provider calls. Repeated source quotes
leave priority unspecified when their location is ambiguous.

## Validation recovery verified — 2026-10-05

- 79 Python checks passed in the isolated Linux test container. Three PostgreSQL
  integration checks were skipped because that container had no database credentials.
- Seven existing Node job-analysis checks passed. The independent Node verifier also
  accepted a synthetic repaired quote and the real-model result with exact source hashes,
  Unicode offsets and requirement-priority evidence.
- ESLint, Python compilation, both generated schema checks and whitespace checks for
  the changed files passed. Existing JSON/API contracts were preserved.
- A live `gpt-6-luna` / `medium` check of job
  `d7a14e134a96abf1bff5cec3dfd7fd4ce0140c9d0814da79c3fef123ac918cc5`
  reproduced `value_not_in_quote` at `responsibilities.1`. The single automatic retry
  corrected the result and passed both Python and Node validation. Verification used an
  in-memory repository and did not create an analysis version in any user account.
- Only intelligence was rebuilt/restarted; all five normal services report healthy.
  The Git index and staged diff remain unchanged. Existing UI work and raw project
  notes were preserved; the fix and this documentation remain unstaged.

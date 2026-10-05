# Structured resume drafts — development and review

Batch 2, 2026-10-03. See [ADR-011](adr/011-structured-resume-drafts.md) and the [API](api/intelligence.md#structured-resume-drafts).

## Use locally

1. Run `npm run setup` to add the private analysis database password without replacing existing credentials.
2. Set `OPENAI_API_KEY` in the ignored root `.env`. Default settings are `LLM_MODEL=gpt-6-luna`, `LLM_REASONING_EFFORT=medium`. Never use a `VITE_` variable for a key.
3. Run `docker compose up -d --build --wait`. Existing MongoDB and PDF volumes are retained. `intelligence-db` stores derived drafts in `intelligence_db_data`; it publishes no host port.
4. At `/resumes`, choose **Resume draft**, select model/reasoning, then **Analyze resume**. Opening a saved draft makes no AI call. The action explains external processing and provider charges.
5. Inspect **All extracted details and source evidence** and parser warnings. Choose fields, correct suggestions/dates, preview the changes and confirm. Existing list entries are included. A profile conflict retains edits and asks you to reload and compare again.
6. Each successful analysis saves **Version 1, Version 2, …** for that uploaded resume. Use **Saved draft version** to reopen earlier results; **Load older versions** retrieves history beyond the newest twenty. Reopening makes no AI call. Switching versions asks before discarding selected review edits.

Generated drafts are saved; review edits remain in the dialog until applied. Profiles currently support full name, headline, summary, location, phone, skills, experience, education, certifications and links. Email/projects/languages/other details remain in the draft. The PDF stays authoritative. Year-only dates are visible in the evidence but cannot import into month-based profile fields without your correction. Lists over profile limits and invalid/incomplete rows must be corrected; content is never silently shortened to pass validation.

Remove the temporary key from `.env` and recreate intelligence when done. New generation becomes unavailable; saved drafts still open. Core authentication/profile/job/resume functionality and Node readiness do not depend on the AI provider or analysis database.

## Code ownership

| Directory | Responsibility |
| --- | --- |
| `backend/intelligence/app/core` | Configuration, service authentication, errors, limits, cancellation |
| `backend/intelligence/app/parsing` | Original isolated PDF extraction and recoverable warnings |
| `backend/intelligence/app/llm` | Shared provider/model interfaces and structured generation |
| `backend/intelligence/app/resumes` | Rich draft schema, prompt, evidence checks and orchestration |
| `backend/intelligence/app/storage` | Python-owned PostgreSQL repository, schema and deletion tombstones |
| `backend/intelligence/app/api` | Private HTTP controller; `main.py` composes the services |
| `backend/platform/src/intelligence` | Owned source resolution, bounded/schema-validated gateway, profile import and cleanup outbox |
| `frontend/web/src/resumes` | Resume library, evidence display, edits, selected-field preview/confirmation |

A future Gemini/Grok adapter implements `LLMProvider`; register provider-specific capabilities alongside it. Job analysis now reuses the shared LLM service. [Matching](cv-job-matching.md) compares saved analyses deterministically without a model call; future AI features/Cady reuse the shared provider layer rather than putting domain logic inside the OpenAI adapter. Notify the user before each future AI-dependent stage.

## Checks

```bash
npm run test:intelligence
# Full Python suite including an isolated temporary PostgreSQL database; no OpenAI key:
docker compose --profile test run --rm --build intelligence-tests
npm run lint
npm run typecheck
npm test
npm run build
# Run from /app in the API container, against a suite-owned temporary MongoDB database:
docker compose exec -T -w /app -e TEST_MONGODB_URI=mongodb://mongodb:27017 api node --import tsx --test backend/platform/test/drafts.integration.ts backend/platform/test/intelligence.integration.ts backend/platform/test/resumes.integration.ts
npx playwright test frontend/web/e2e/drafts.spec.ts frontend/web/e2e/intelligence.spec.ts frontend/web/e2e/resumes.spec.ts
```

The checked-in JSON schema is generated from Python's `DraftRecord`; regenerate it after contract changes with `scripts/export-draft-schema.py`, then run both services' checks. Do not hand-edit it; `backend/intelligence/.venv/bin/python scripts/export-draft-schema.py --check` detects drift. Normal tests mock AI and never load the root key into test containers. Live checks require separate explicit authorization and synthetic data; test success alone does not prove access to every configured model.

## Lifecycle and limits

- Analyze accepts a trusted owned PDF and checks its SHA-256 in Python. No browser owner IDs, text, URLs or filesystem paths are accepted.
- Every explicit Analyze action generates a fresh immutable draft, including repeated model/settings. PostgreSQL assigns consecutive versions per owner/resume under a transaction lock; only validated successful results are saved. Failed or cancelled generation creates no new version; a completed result may already be stored when a late disconnect occurs. Retrying storage with the same draft ID is idempotent. PDF `source.resumeVersion` and analysis `version` are separate counters. GET returns the newest matching-source draft or the requested saved ID; history returns metadata in pages of twenty.
- Initial AI limits: 60 KB including text/instructions/schema, 16,384 output tokens, 90 seconds. Generation gets one slot, no queue/retries/fallback. Input or output excess fails clearly. These limits do not represent a guaranteed dollar ceiling or monthly budget.
- Refusal, malformed/incomplete output, unsupported evidence, timeout and provider throttling have fixed safe messages. Unknown values remain unknown. Closing the dialog cancels the request; cancellation cannot promise a provider refund.
- Deletion immediately suppresses reads/imports. `intelligence_cleanup` in MongoDB retains cleanup work during outages/restarts; Node retries every 30 seconds while running. PostgreSQL deletion and tombstones prevent late writes. Review/import has a source recheck followed by the existing profile CAS; there is no cross-database transaction.
- `schema.sql` and numbered `storage/migrations/*.sql` run under a startup transaction lock; a ledger applies each migration once. Migration 001 preserves existing draft IDs/content, assigns chronological versions and removes the old model/settings uniqueness constraint. Future migrations must preserve stored records. Back up PostgreSQL separately from MongoDB/original files. `docker compose down -v` deletes all project data volumes.

## Verification

Verified on 2026-10-03 (Asia/Kolkata):

- All 42 Python parsing/draft/provider/cancellation/storage checks passed in Linux Docker. Temporary PostgreSQL databases verified owner isolation, consecutive/concurrent versions, paginated history, restart persistence, legacy migration without data loss, idempotent deletion and prevention of late writes. Shared provider registration was also checked with a synthetic adapter, without adding an unimplemented provider to the UI.
- All 48 Node unit/API tests passed. The 19 focused MongoDB integration cases passed (7 draft, 6 extraction, 6 resume), with temporary databases/directories deleted. Additional boundary checks reject invented fact values even when their quote is real. Exact-ID import remains usable after another model creates a newer draft.
- Lint, both workspace type checks/builds, schema consistency and whitespace checks passed. Existing raw notebook edits were preserved and excluded from whitespace cleanup.
- All three targeted Chromium flows passed again after versioning. Draft coverage includes no generation on open, repeated analysis creating versions 1/2, provider-free switching to version 1, reopening latest version 2, compatible model/reasoning controls, evidence, field selection, preview/confirmation and retained edits after a conflict. Browser AI responses are mocked; extraction still exercises the real parser.
- Before versioning was added, one live synthetic CV used `gpt-6-luna` with low reasoning: a validated draft returned in approximately six seconds, with 1,221 input and 387 output tokens. A repeat exercised the former cache behavior; explicit Analyze now generates a fresh version instead. Generation left the synthetic profile untouched; explicit selected-field confirmation updated it. The test PDF, draft, profile, account and session data were removed; only the designed minimal source-deletion tombstone remains. No original user resume was sent externally. GPT-4.1 and GPT-6.1 Sol were checked with mocks, not paid live generations. Versioning checks use mocked AI without additional paid calls.
- Five ordinary Compose services are healthy; test-only services are excluded from default startup. Original MongoDB/resume volumes, OAuth credentials and browser-account data were retained. The temporary OpenAI key is still configured for the user to try the feature.

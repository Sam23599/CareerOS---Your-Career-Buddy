# ADR-011: Structured resume drafts and shared LLM infrastructure

Status: Accepted. Date: 2026-10-03. Extends [ADR-010](010-resume-intelligence-foundation.md).

## Decision

- Keep Node authoritative for authentication, career profiles and original resumes. Python owns derived drafts in a separate PostgreSQL 17 database and volume. Python receives no MongoDB connection, user JWT, signing secret or original-file mount. pgvector, Kafka and Cady wait for their planned stages.
- Organize Python by responsibility: `core` (configuration/security/errors/cancellation), `parsing` (bounded PDF worker and parser), `llm` (provider contracts, model capabilities and generation), `resumes` (schema/prompt/evidence/orchestration), `storage` (repository/SQL) and `api` (private controllers). Use OOP services and adapters with thin routing/startup. Keep the shared LLM layer independent of Cady and resume schemas.
- Use OpenAI's async Responses API with strict structured outputs and `store: false`. No tools, arbitrary provider URLs, automatic retries, model substitution or temperature overrides. Other providers can implement `LLMProvider` and register their own capabilities later; Gemini/Grok are not advertised as implemented.
- Support the requested API IDs: `gpt-4.1`, `gpt-6-luna`, `gpt-6.1-sol`. GPT-4.1 omits reasoning entirely. Luna supports none/low/medium/high/xhigh/max; Sol supports low/medium/high/xhigh/max. Default: Luna/medium. The UI allows only compatible options.
- External calls happen only through an explicit **Analyze resume** action. Send extracted page text plus the extraction instructions/schema; do not send original bytes, account sessions, existing profile content or jobs. Warn about external processing and charges. Resume text is untrusted data, never instructions.
- Bound one request to 60,000 UTF-8 input bytes including prompt/schema, 16,384 output tokens and 90 seconds of AI processing. Bound saved/forwarded records to 2 MiB. One active generation per instance, no queue; Node allows ten combined extraction/analysis attempts per user per fifteen minutes and a 140-second analysis deadline. Existing parser limits remain intact. These are token/size/time controls, not an account-wide currency budget; configure provider spending limits separately.
- Retain relevant explicit resume details: identity/contact, summary, skills, technologies, roles, work history/achievements, education, certifications, projects, links, languages, keywords, career preferences and additional sections (e.g. awards/publications/volunteering). Unknown scalar values remain null; absent lists remain empty. Dates preserve their original precision.
- Every known fact requires an exact page quote. Verify the page and quote against extraction and require the copied value to occur in a quote, with whitespace normalization and word boundaries. This prevents unsupported text from entering a validated draft; it does not prove that every semantic interpretation or PDF reading order is correct. Human review remains required.
- Store immutable ready records with owner/source ID/version/hash, parser version/pages/warnings, analyzer version, provider/model/reasoning, usage, schema version and timestamp. Every successful explicit analysis creates a numbered version per owner/resume, including identical settings. Saved reads/history never call a provider. History returns paginated metadata; exact-ID reads retrieve old versions. Transaction-locked migration 001 preserves existing drafts and numbers them chronologically; storage retries with the same ID are idempotent. Failed/refused/incomplete/invalid results do not become saved drafts.
- Review flow: generate → inspect evidence → edit/select supported fields → compare current/proposed values → confirm apply. All selections start unchecked. Preserve existing list entries and append suggestions with identity deduplication. Manual review edits are local to the dialog until applied; the generated source draft remains immutable.
- Apply through an owner/source-checked Node endpoint reusing existing profile validation and `ProfileStore` version checks. Import resolves the exact reviewed draft ID within its owner/source namespace, so an earlier model draft remains usable after a newer model draft exists. A conflict retains edits and requires reloading/reviewing the new profile. Only currently supported profile fields can be imported; email, projects, languages and other details stay in the draft. Year-only dates need an explicit user-supplied month; never assume January.
- Deletion hides the source immediately, durably queues analysis cleanup in Node's MongoDB before deleting the PDF, and retries downstream deletion every 30 seconds while Node runs. Python atomically deletes drafts and retains a minimal owner/resume tombstone under the same transaction lock used by saves. A late generation cannot resurrect a deleted source. No distributed transaction is claimed; downstream deletion is eventual during outages. Tombstones contain IDs and a deletion timestamp, no resume text.

## Configuration and privacy

`npm run setup` preserves existing secrets and adds a separate `INTELLIGENCE_DB_PASSWORD`. Compose gives only Python the OpenAI key and its database URL; PostgreSQL and Python have no public ports. Originals and authoritative profiles remain in their existing volumes/database.

Set `OPENAI_API_KEY` in ignored root `.env`, then recreate intelligence. Remove the temporary key and recreate intelligence when finished. Existing drafts remain readable without a key. Keys and raw document/provider exceptions must not appear in logs. `store: false` disables Responses application storage; it does not promise that all provider retention is disabled. OpenAI's abuse-monitoring retention policy still applies.

Current rates and supported model settings were verified against official documentation on 2026-10-03. Token charges vary by selected model and reasoning. Do not promise a fixed cost or provider/model access for every key.

## References

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Official PostgreSQL container](https://hub.docker.com/_/postgres)

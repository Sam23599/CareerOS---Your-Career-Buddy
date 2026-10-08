# Shared AI usage accounting and future credits

Status: **Planning only, 2026-10-08 IST.** The user selected proper per-call usage planning now; billing/recharge/payment implementation waits until the end of the product development stages and a separate discussion. Current Settings figures remain demo until the real accounting batch ships.

## Current gap and ownership

[OpenAIProvider](../backend/intelligence/app/llm/providers/openai.py#L44) returns only input/output counts after successful parsing; absent usage becomes zero. [StructuredResult](../backend/intelligence/app/llm/models.py#L45) and saved feature records lack full call accounting. Failed/refused/invalid results can therefore consume provider usage without a saved successful analysis. [Settings](../frontend/web/src/settings/SettingsPage.tsx#L11) explicitly shows sample credits and no actual usage.

Add reusable `app/usage/`: `UsageTrackingService`, `UsageRepository`, `ProviderUsageNormalizer`, `RateCatalog` and `CostCalculator`. Instrument **the provider call boundary**, including async workers/tools, before domain parsing or validation. Analysis, embedding, Cady, summaries, reranking, claim verification, repair calls and research all use the same accounting interface. One user action may produce several provider calls, each recorded separately and grouped by run.

Python owns private call/usage/cost records; Node exposes authenticated owner-scoped summaries to Settings. An eventual wallet/payment service owns purchased credits; the usage ledger is not a payment ledger. No raw prompt/CV/chat text in usage logs.

## OpenAI usage fields

Preserve provider-reported fields, not character-based estimates as actual usage:

```text
usage.input_tokens
usage.output_tokens
usage.total_tokens
usage.input_tokens_details.cached_tokens
usage.input_tokens_details.cache_write_tokens       when supplied
usage.output_tokens_details.reasoning_tokens
```

Reasoning tokens are part of output billing; cached/write tokens are input subcategories, not extra additions to total token counts. Official examples show the usage shape in the [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) and [prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching). Keep `total_tokens` as supplied; optionally verify input + output consistency and flag anomalies without rewriting provider evidence. Optional unknown fields stay nullable; a missing usage object is **unknown**, not zero-cost work.

Store request/response ID, provider/requested/resolved model, feature, owner, run/task/attempt/tool-call ID, settings, start/end, state, usage source/completeness, token details, service tier/region/context pricing class where available, currency, rate snapshot/version, estimated cost and reconciliation state. Internal admission ID and provider response ID prevent duplicate ingestion of the same completed call. Separate real repeated calls from repeated processing of one response.

Record response usage before schema/evidence checks reject output. Include refusals, incomplete output, validation-repair calls and failed generations when usage exists. For streamed output, finalize from the terminal usage event exactly once; never add text-delta counts to final totals. Missing terminal events/timeouts retain an unknown/pending-reconciliation attempt; do not retry paid work to obtain statistics. Embeddings have their own input/total schema and price category; image/audio/browser or tool charges need their appropriate units rather than invented text token counts.

## Model-specific cost calculation

Maintain an effective-dated, server-side `RateCatalog` keyed by provider, exact resolved model, service tier, context band, region and modality. Snapshot the rate with each attempt so future catalog changes do not silently rewrite historical cost. Use official pricing as a maintained input, not a live web scrape per user request. No hard-coded prices or invented model rates are introduced by this planning update.

For a supported non-overlapping text-input pricing scheme:

```text
ordinary_input = input_tokens - cached_input_tokens - cache_write_tokens
estimated_text_cost = (ordinary_input * input_rate
                     + cached_input_tokens * cached_rate
                     + cache_write_tokens * write_rate
                     + output_tokens * output_rate) / 1,000,000
```

Use a model-specific adapter when the provider's billing categories differ; never subtract overlapping categories or assume every model charges for cache writes. Absent optional fields/rates require a documented applicable pricing policy or an “estimate incomplete” state, not a made-up discount. Do not charge reasoning tokens twice. Calculate with decimal currency arithmetic and round only display/settlement.

Hosted tools can have call/storage/runtime fees **and** token charges; add separate fee line items only when not already included in token usage. For example, web research may carry tool fees and search-content input costs. Preserve the applicable tool/version billing rule and avoid guessing units from result length. The [official pricing page](https://developers.openai.com/api/docs/pricing) distinguishes model/input/cache/output and built-in-tool charges. Estimates are not invoices.

Record which account/project funds the call. In the current shared deployment, provider spending belongs to the configured server account; attribution to a user does not create their own provider bill. Reconcile aggregate usage/cost against provider reports where available, preserving adjustments separately. Account-wide reports may not establish an exact per-user invoice; label that limitation.

## AI usage and credits Settings UI

Replace sample usage with actual summaries only once server accounting exists:

- Date/feature/model filters; overall input/output/total tokens and known/unknown cost.
- Separate model rows, e.g. configured `gpt-4.1`, `gpt-6-luna`, `gpt-6.1-sol`, with provider, call count, input/cached/write/output/reasoning breakdown and cost status.
- Embedding and external tool/API/browser fees shown separately; expandable run details explain why one chat answer caused multiple calls.
- Clear timezone/currency, rate-effective date, successful/failed calls and incomplete usage. Existing old records provide historical partial counts only; do not fabricate failed-call history or precise retrospective charges.
- Real usage and optional budget alerts can ship before purchasable credits. Keep “credits”, recharge and auto-refill explicitly unavailable/demo until a wallet ships.

Proposed Node endpoints: `GET /api/v1/settings/ai/usage` and paginated owner-bound run/call detail reads; private service APIs supply normalized summaries. Avoid requesting broad provider-admin credentials from the browser. Retention/export and privacy checks follow account boundaries; no prompt contents needed for accounting.

## Budget controls and implementation order

1. E0/E1: define schemas/rates and instrument the current shared provider boundary; persist each attempt independently of a successful feature result. Add owner summaries/model Settings views once accounting exists.
2. E2: wire the same tracker into separated API/worker processes, preserving call identity and compatible response fields without duplicate totals.
3. Before E3/E4 live execution: add embedding/tool/verifier usage categories, effective rates and per-run limits. Log failed/unknown outcomes and prevent duplicate totals.
4. Enable actual Settings summaries, with nullable historical data and mocked cases for streaming, refusals, validation failures, multi-call runs and rate changes.

Before starting a run, reserve a conservative owner/run token or estimated-spend budget where enabled; reconcile from reported usage and release unused reservation. Cross-process reservations are atomic, not a browser counter. Uncertain calls keep an explicitly bounded pending reservation until reconciliation/policy resolves it. Budget controls and provider spending caps complement each other; neither guarantees an immediate stop of an already running external request.

## Future payments and auto-recharge — after product stages

Hold a dedicated discussion **after the product development stages**: account/key ownership, what one credit buys, model-specific conversion/margins, currency, recharge limits, refunds, failed calls, recurring authorization, low-balance thresholds, notifications and geographic/provider requirements. Do not choose a payment vendor or enable automatic charging now. Evaluate supported providers (e.g. Stripe/Razorpay where applicable) then against the actual launch requirements.

Future payment architecture: hosted payment flow → verified/deduplicated payment webhook → durable wallet ledger → usage reservation/settlement. Keep payment event IDs/idempotency, pending/settled/failed/refunded states and audit history separate from model usage. Auto-refill requires explicit opt-in, threshold, per-charge/monthly caps and revocation. A chat instruction or browser callback alone cannot mint credits or charge a stored payment method. No real recharge is part of Phase 2 closure.

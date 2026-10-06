# ADR-015: Explainable saved-job ranking

Status: Accepted. Date: 2026-10-06 (Asia/Kolkata).

- Start Phase 2 batch 6 with the private saved shortlist. Rank the full filtered
  set across pages, bounded to 50; reject larger sets instead of truncating.
- Reuse existing verified Python `skill-coverage-v1` comparisons. Node owns OOP
  shortlist/preference orchestration and projects compact explainable summaries.
  No new AI call, duplicated matcher, Python contract, persistence or migration.
- Preserve coverage weights/formula. Order by coverage, then explicit preference
  category matches, saved priority, saved date and stable job ID. Label preferences
  as tie-breakers, not an additional score. Do not invent company/salary inference.
- Compare literal normalized role/location phrases and exact catalogue work mode;
  missing values are unknown. Optional profile skills remain self-reported.
- Separate unanalysed/stale, expired/unavailable, unscorable and not-interested jobs
  from ranked results. Operational failures reject the whole request.
- Resolve owner-bound records, validate each upstream match, recheck CV lifetime,
  profile and shortlist revisions plus job summaries/content/expiration. ADMIN has
  the same ownership boundary. Cancel queued/in-flight work on disconnect/failure.
- Limit concurrency to four, total request to 60 seconds, private requests to the
  existing 15 seconds/2 MiB, and ten batches/user/fifteen minutes. No retries.
  Cap the final compact response at 2 MiB as well.
- Add a collapsed read-only ranking panel beside existing saved-job editing. Show
  top five first, expandable reasons/all results and deferred-job actions. Keep
  dirty-note protection, keyboard operation and mobile wrapping.

Broader job discovery ranking and semantic ranking remain extensions. Personalized
AI guidance is planned separately in [the next-step plan](../personalized-preparation-plan.md).

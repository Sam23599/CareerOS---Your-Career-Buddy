# ADR-018: Weekly roadmaps and shared Cady conversation

Status: Accepted. Date: 2026-10-08 (Asia/Kolkata).

The user selected preparation/Cady refinement, flexible weekly study sessions,
and persistence across refresh/browser restarts. AI purpose/data/charges were
disclosed before work; live provider verification remains separately authorized.

- Combine the existing deterministic comparison and resume checks into one
  **Review fit & gaps** action. Preserve their APIs and result explanations.
- Generate `preparation-v2`: 1–8 weeks, objectives/milestones, ordered sessions,
  tangible outcomes and final weekly checkpoints. Validate the complete timeline,
  requirement classifications and hours. Keep v1 reads and review overlays compatible.
  Follow sessions and track progress first; customization stays optional.
- One shared authenticated React provider serves the full page and quick native
  dialog. Lazy initialization avoids fetching chat on every page visit. Closing
  the widget or navigating does not discard shared conversation or accepted answers.
- Python-owned PostgreSQL stores one active conversation per account, at most ten
  pairs, with an atomic integer revision. Send only the last three server-derived
  pairs to OpenAI. Context changes/reset clear history; account sign-out clears
  browser state. This is continuity, not long-term memory or a multi-thread archive.
- Reject stale revisions/context before generation and compare revision again on
  save. Preserve source ownership/citation checks; suppress unavailable sources,
  label changed historical context, and follow retained recovery/hard-erasure rules.
  A conflict or uncertain timeout never automatically retries a paid call.
- Reuse existing provider/model limits, service authentication and task execution.
  Defer Celery, batch analysis, theme overhaul, dashboard statistics, autonomous
  tools and unrelated notebook requests. Mocked checks make no paid calls.

See [use, storage and limits](../personalized-preparation.md) and
[API contracts](../api/intelligence.md#weekly-roadmaps-and-saved-cady-conversation).

# ADR-008: Career-source registry and explicit coverage

Status: Accepted. Date: 2026-10-02. Extends ADR-007's initial Greenhouse integration.

Replace the Greenhouse-only watchlist connection with a private provider definition produced by a backend adapter registry. Use the same registry for save validation and the authenticated URL-support endpoint. Each adapter supplies canonical identity, normalization, cooldown and missing-job behavior through the existing job-ingestion contract. The jobs UI, matching, saved jobs, scheduling and notifications remain shared.

Expose `complete`, `limited` or `link` coverage alongside provider name and refresh support. Google Careers initially imports only its first 20 unfiltered public results: its robots rules disallow pagination. Never expire missing jobs from that partial snapshot. Reject provider format changes before writes and keep missing fields unknown. The public embedded HTML contract can change; this does not provide complete Google vacancy coverage.

Version recognition and reassess saved sources during initialization. Upgrade existing Google links without recreating records or changing filters, ownership or check preferences. Preserve Greenhouse identity and check history. Keep legacy URL aliases to avoid migration collisions; newly added aliases share a canonical identity and duplicate check.

Future arbitrary company links require verified ATS adapters, bounded board discovery, structured job-detail parsing or explicit site readers. Unknown sites remain clearly labeled references. Adding those readers is separate work. See the [integration plan](../architecture/career-source-integration.md) and [source API](../api/career-sources.md).

[ADR-009](009-career-bookmarks.md) subsequently separates bookmarks from job sources: recognition can offer support, but bookmark activation requires an explicit tracking setup.

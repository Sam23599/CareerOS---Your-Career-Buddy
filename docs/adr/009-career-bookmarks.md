# ADR-009: Separate career bookmarks from job sources

Status: Accepted. Date: 2026-10-02. Extends ADR-008.

Keep two views on `/career-sources`: Job sources and Career bookmarks, with separate add actions. Bookmarks need only a company label and HTTPS URL; unsupported URLs entered through the job-source form offer an explicit Save as bookmark action. Bookmark cards show Open, Edit and Remove actions without matching filters, schedules or check controls.

Reuse `career_sources` with an explicit `kind: "bookmark" | "job-source"`. Intent is independent of native support: a supported page can remain a bookmark. Bookmarks cannot be refreshed, read matching jobs, run scheduled checks or publish pending source notices. API validation rejects tracking settings on bookmark requests.

Backfill entries that already had a provider connection/Greenhouse board as job sources, preserving their check history and settings. Old unsupported references become bookmarks; retain their labels, URLs and stored filters for later tracking setup. Future registry recognition updates capabilities but never activates a bookmark. Show Enable job tracking when support exists, then require the user to save filters/check settings through the existing revision-protected edit API. Reuse the entry's ID and creation date; default bookmark activation to manual checks with tracking enabled.

Browsing tools remain future work: an on-demand public-page reader could preview candidate listings for user review, then validate selected jobs through the common ingestion contract. This batch does not add browsing, arbitrary fetching or automated scraping. See the [source integration plan](../architecture/career-source-integration.md).

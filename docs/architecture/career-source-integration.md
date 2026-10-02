# Consistent career-source integration

Updated: 2026-10-02. The registry, Google adapter, coverage UI and separate bookmark flow are implemented. The additional adapters, discovery and browsing tools below are proposed work, not implementation approval.

## One pipeline, many adapters

`Job-source URL → registry detection → provider adapter → validated JobInput → shared job store → private filters → saved jobs and notifications`

The job-source form asks the backend registry about support before saving. It does not maintain its own provider detection rules. Each adapter owns URL recognition, public fetch endpoints, normalization, import cooldown and missing-job behavior. All providers use the existing `JobSource`/`JobInput` contract and common import service. Adding a provider does not require a separate jobs page, scheduler, notification service or saved-job implementation.

Career bookmarks have their own view and company/URL form, using the same private collection with `kind: "bookmark"`. They do not import jobs, schedule checks or deliver source alerts. Native support and user intent are separate: recognized bookmarks offer Enable job tracking, but stay bookmarks until the user saves a tracking setup. Existing working connections remain job sources; old unsupported links become bookmarks. Recognition upgrades never activate bookmarks automatically. See [ADR-009](../adr/009-career-bookmarks.md).

Public listings are shared by provider source identity; watchlist labels, settings and matching filters remain private. Jobs retain their provider ID, original link and import time. Reimports preserve deterministic job IDs and saved-job notes. Cross-provider deduplication is not implemented: two providers can carry the same vacancy.

## Coverage must be explicit

| Coverage | Meaning | Current support | Missing jobs |
| --- | --- | --- | --- |
| `complete` | A validated complete published feed for that board | Greenhouse board roots | Expire missing records only after a complete successful response |
| `limited` | A partial public listing snapshot | Google Careers, first 20 unfiltered results per check | Keep missing records; absence does not establish closure |
| `link` | A saved reference with no supported reader | Other HTTPS career links | No import or scheduled check |

Google's [public listings page](https://www.google.com/about/careers/applications/jobs/results/) embeds listing data. Its [robots rules](https://www.google.com/robots.txt), checked on 2026-10-01, disallow paginated results URLs. The adapter requests only the unpaginated root. It does not call private APIs, evaluate downloaded scripts, fetch sign-in links or paginate. The HTML data contract is undocumented; format changes produce a failed check and retain existing jobs.

Google filters apply locally to collected jobs, not to all vacancies on Google's site. Each check reads at most 20 results, but stored jobs can accumulate across checks. Collected jobs may become stale because this partial reader cannot confirm removal. The UI shows limited coverage and directs users to the original page for availability. Unavailable posted dates, work mode, employment type and skills remain null/unknown/empty.

## How to expand to random company links

Implement in this order, selecting concrete providers from actual user demand:

1. **Reuse hiring-system adapters.** Add public feeds for systems such as Lever, Ashby and SmartRecruiters after verifying current access and contracts. One adapter should serve many company boards. Custom systems such as Workday need separate feasibility checks.
2. **Discover the underlying board from a company career page.** A company homepage may link to or embed a supported hiring system. Resolve to that canonical board, then use its adapter. Keep detection read-only until the user saves it, and show the detected provider and coverage.
3. **Use structured job detail data where available.** Read `JobPosting` JSON-LD from verified public job detail pages; listing discovery and complete pagination still require a site contract. Google's [JobPosting documentation](https://developers.google.com/search/docs/appearance/structured-data/job-posting) distinguishes individual job pages from search/list pages. JSON-LD alone does not guarantee a complete company feed.
4. **Add a company-specific reader only when necessary.** Check public access, site rules and maintainability first. If browser rendering is necessary, evaluate a separate bounded worker at that point. Blocked, login-only or unsupported pages remain saved references with a clear explanation.

Do not promise automatic support for every URL. Consistency means the same job format and user workflow, with truthful support and coverage. A generic HTML scraper must not turn an unknown page or consent screen into a successful empty feed.

## Acceptance for each new adapter

- Define canonical board identity, accepted URL aliases, endpoint allowlist, coverage and cooldown before importing. Map only known fields and retain original listing links.
- Validate the entire provider response before job writes. Test malformed/partial responses, genuine empty feeds, repeated IDs, stable reimports and failure retention.
- Use bounded responses, timeouts and explicit redirect policy. Current adapters fetch fixed public provider hosts; saved arbitrary URLs are never fetched. Future discovery must validate DNS/IP destinations and every redirect to prevent access to local/private services.
- Verify current site access rules and provider contracts during onboarding. Recheck rules when maintaining an adapter; a change can require reduced coverage or disabling imports.
- Exercise common ownership, matching, cache, scheduling, saved-job and notification behavior. Never infer closure from a partial result or a fetch failure.
- Register URL recognition and increment `registryVersion` so old saved references are reassessed at startup. Preserve ownership, labels, filters, check preferences, intent and existing URLs; preserve job identity/history when the provider identity stays the same. A bookmark with newly discovered support remains idle until explicit activation. Existing alias records are retained, while new duplicate job-source connections are rejected.

## Next proposed batch

After Phase 1 release verification, choose the next ATS from links users actually add. Add that adapter and its detection tests first. Then implement bounded company-page discovery for that ATS. Keep the rest as separate requests in the project notebook, subject to the user's timing decision. No queue, browser fleet or broad scraping infrastructure is needed for the current adapters.

A later release can offer Read jobs from this page on bookmarks. A bounded browsing tool would attempt to read a public page, show a preview of extracted jobs and accept validated user selections through the same job contract. Failure to read a site leaves the bookmark intact. This one-off action would not enable scheduled tracking; reliable native readers and their coverage rules remain separate from that feature.

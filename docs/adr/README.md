# Architecture decisions

Record meaningful decisions as implementation reaches them. Assign each new decision the next available number.

| ID | Decision | Status |
| --- | --- | --- |
| [001](001-local-platform-foundation.md) | Local React, Express, and MongoDB foundation | Accepted |
| [002](002-authentication.md) | JWT sessions and Google/GitHub OAuth sign-in | Accepted |
| [003](003-career-profiles.md) | Private career profiles and concurrent-edit protection | Accepted |
| [004](004-resume-storage.md) | Private resume versions and persistent local file storage | Accepted |
| [005](005-jobs-ingestion.md) | Normalized jobs, source imports, and public job browsing | Accepted |
| [006](006-saved-jobs.md) | Private saved jobs, notes, and interest tracking | Accepted |
| [007](007-career-sources-notifications.md) | Custom career sources and in-app notifications | Accepted |
| [008](008-career-source-registry.md) | Provider registry, Google Careers and explicit source coverage | Accepted |
| [009](009-career-bookmarks.md) | Explicit career bookmarks and opt-in job tracking | Accepted |
| [010](010-resume-intelligence-foundation.md) | Private resume text extraction through a Python service | Accepted; batch 1 implemented |
| [011](011-structured-resume-drafts.md) | Structured resume drafts and shared provider infrastructure | Accepted; batch 2 implemented |
| [012](012-job-description-analysis.md) | Job requirements, quoted evidence, private versions and freshness | Accepted; batch 3 implemented |
| [013](013-cv-job-matching.md) | Source-bound deterministic CV/job skill coverage and review | Accepted; batch 4 implemented |
| [014](014-resume-checks.md) | Compact, evidence-backed resume checks and preparation without new AI calls | Accepted; batch 5 baseline implemented |
| [015](015-saved-job-ranking.md) | Saved-job skill coverage ranking with explicit preference tie-breakers | Accepted; batch 6 saved-job baseline implemented |
| [016](016-notebook-improvements.md) | Recovery retention, durable job tasks, manual tracking and workspace preferences | Accepted; notebook follow-up implemented |

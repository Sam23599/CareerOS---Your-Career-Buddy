# CareerOS — Observations and change requests

One ongoing notebook for the whole project: bugs, rough ideas, UX observations, feature requests, questions, and anything else. Write freely in **Your raw notes**; no special format is required. Original notes and refined notes stay together here.

## Working agreement

- Preserve your original wording. Add clarification separately; never silently rewrite or delete a raw note.
- On review, assign stable IDs (`N-001`, `N-002`, …) to new raw entries and link each refined item back to its source ID. Split compound requests into related items when helpful.
- Refine only new or changed notes; update the existing refined entry instead of duplicating it. Record unresolved questions and distinguish assumptions from confirmed decisions.
- Check relevant code/plans before claiming a root cause or that something is already implemented. Add exact file/line references where useful; otherwise label the finding unverified.
- Suggest a small, practical next step and timing. You choose **now / soon / end of phase / end of project / undecided**. Suggestions do not change the roadmap by themselves.
- Notes and scheduled reviews authorize refinement only. Implement a request when you explicitly approve it in conversation or record a clear approval for the named item. An approval for later is not permission to start now.
- Before starting any project stage that will use AI capabilities (LLMs, embeddings, AI-based OCR or similar), notify you first. Explain its purpose, whether it is required or optional, the proposed provider/model or local setup, what data is processed or sent externally, and expected cost/configuration. Provider and budget choices must be settled before external model calls.
- Keep completed/deferred items and decision history in this file. Do not commit, push, or modify application code during a notes-only review.

## Your raw notes

Add entries below. Dates, screenshots/paths, expected behavior, and examples help, but are optional. If you change your mind, append a follow-up referencing the earlier note.

<!-- Write freely below this line. The reviewer will add IDs without changing your words. -->
- improve the main header bar sections and overall feel of the app. (just the ui/ux and frontend changes needed mainly) to give a modern fresh and user friendly look.
- add support for dark mode so user can pick between the two.
- implement a removed/deleted option as well for almost everywhere where the user has deleted anything. this allows them to restore in future in-case if they want to, with a custom (default 30 day) bin cleanup as well. bin cleanup will only soft delete it, allowing the data to persist in db even after delete and bin cleanup. so basically we would be needing 2 type deletes.
- an additioanl section of settings should be added to app for some custom user related settings for dashboard/ui/app token/credit usages, recharge/autofil credit etc things. 
- add a new window for user to track failure tasks or logs, that they can navigate or mail us, the careerOS developers for to debug and fix.
- add compress/expand button for the analyzed jobs/cv etc. currently it occupies the whole window, making the UI inconvinent.

auth:
- add cache for continued session scheck if security-vise applicable.
- google auth proper addition still remains.
- current card for 'continue as' still require password. we should be able to to sign-in directly in that case, like upto 7 days. in this case, user will be asked for password only when he hasnt logged in since last 7 days.

Jobs and ingestion:
- proper separator in jobs section for different jobs platforms that'll be added in future, along with the user custom career pages. and note, user may be adding a lot of dream companies so we need a proper platform and interface for that. 
- filters on main job page like skills, employment type, work mode, etc doesnt exactly work. or you may say, they cant filter properly because the original jobs fetched were parsed or structured improperly for filters to apply. maybe using llms to structure it properly would be better.(lets discuss it first with brain bombarding) 
- improve job's detail properly with divided sections of like role, responsibility, skills, experience/education, company, employee reviews (use glassdoor, ambitionbox, 6figures, etc).
- MAJOR: add a major feature to find emails of the HR or recuiters or of the people (may try linkedln and apollo extension feature) from those companies to show in the job-detail section. may require R&D here as where and how can we fetch those details.

Saved jobs:
- more filters by location, date post range, new apply/already applied to that company (this checks and allow the user if he is applying for the first time or not: this is because, a person would be ok to apply casually and be added in company's data records (company he is applying to), and also he might would like to be prepared for some specific ones first then only apply so his record stays fresh and new the company.) 
- one more filter for if the user has applied to the job, application in progress, being interviewed, etc status. this will then later help to track its appliation. (this can be in saved jobs as well or in a better suited place in future)

custom career sources and notifications:
- functionality vise it works perfect. just some ui/ux improvements are needed for much cleaner ui and flow.
- add linkedln jobs as well for common job sources. my R&D suggests linkedln supports public job search (for example: https://www.linkedin.com/jobs/jobs-in-pune-division?trk=homepage-jobseeker_brand-discovery_intent-module-secondBtn&position=1&pageNum=0), but for easy apply or more diverse search, a linkedln account sign-in is required.So we'll support both. default public search that linkedln allows, then for advance search ask user to sign-in to linkedln through our platform and allow the access to their linkedln, then use it for search and list available jobs. note, for sensitive platforms like this, we'll give user a specific guideline and prompt if they want a more faster scheduled search like every hour or every 30 mins with a warning that that particular platform might limit this feature or is against this type of heavy crawling. 
- the newly added jobs should be at the top of the list on '/career-sources/{id}' page. there should be a samll ui separation between old jobs and new jobs so it easier to pinpoint the exact new jobs. also add sorting and filter on top as you type on that page.

nits:
- "/status" currently ony have support for only 3 service's status. should track all services.
- in docker or services, service name should be more defined for better understanding. intelligence-db-1 should be renamed to better service. 

## Refined notes

No observations submitted yet. Each reviewed item will use this compact format:

```text
N-001 — Short title
Raw source: N-001 (or related IDs)
Type: Bug / improvement / feature / question / other
Understanding: What you want and why it matters.
Evidence / root cause: Verified file:line, or not yet investigated.
Proposed change: Smallest useful approach and what success looks like.
Questions / dependencies: Only what needs clarification.
Suggested timing: Now / soon / end of phase / end of project.
Your decision: Pending; no implementation approved.
Status: Needs discussion / ready for decision / approved / deferred / in progress / done / declined.
Updated: YYYY-MM-DD, Asia/Kolkata.
```

## Review log

| Review date (IST) | Notes reviewed | Outcome / decisions |
| --- | --- | --- |
| 2026-10-01 | Notebook setup | Raw and refined sections created. No feature requests or approvals inferred. |

## Daily review setup

Desired time: **03:00 every day, Asia/Kolkata (IST)**. Review everything new or edited since the last recorded review. You can also ask for a review at any time.

**Automation status: Not enabled.** This session has no task-scheduling tool; a file alone cannot trigger a background review. Until a scheduled task is configured, reviews happen when requested in an active session. Do not log scheduled reviews as completed unless they actually ran.

Ready-to-use scheduled-task prompt (run against this local project so it sees uncommitted notes):

> Review docs/project-notes.md in the CareerOS repository. Read its working agreement. Preserve all raw notes verbatim; assign stable IDs and refine new or changed entries in the same file. Consult relevant code and plans read-only, identify the underlying issue where evidence permits, suggest a minimal solution and timing, and record open questions. Preserve the user's decisions and distinguish suggested timing from approved timing. Do not implement, commit, push, or modify any other file. Re-read the file before saving to preserve concurrent user edits. Append a dated review-log entry with IDs reviewed and a short summary; if nothing changed, record one short no-change entry for that date without duplicating refined items. Report items needing the user's decision. Never treat this review as permission to implement.

Scheduling reference: [Scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app).

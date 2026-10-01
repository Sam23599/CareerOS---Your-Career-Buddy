# CareerOS — Observations and change requests

One ongoing notebook for the whole project: bugs, rough ideas, UX observations, feature requests, questions, and anything else. Write freely in **Your raw notes**; no special format is required. Original notes and refined notes stay together here.

## Working agreement

- Preserve your original wording. Add clarification separately; never silently rewrite or delete a raw note.
- On review, assign stable IDs (`N-001`, `N-002`, …) to new raw entries and link each refined item back to its source ID. Split compound requests into related items when helpful.
- Refine only new or changed notes; update the existing refined entry instead of duplicating it. Record unresolved questions and distinguish assumptions from confirmed decisions.
- Check relevant code/plans before claiming a root cause or that something is already implemented. Add exact file/line references where useful; otherwise label the finding unverified.
- Suggest a small, practical next step and timing. You choose **now / soon / end of phase / end of project / undecided**. Suggestions do not change the roadmap by themselves.
- Notes and scheduled reviews authorize refinement only. Implement a request when you explicitly approve it in conversation or record a clear approval for the named item. An approval for later is not permission to start now.
- Keep completed/deferred items and decision history in this file. Do not commit, push, or modify application code during a notes-only review.

## Your raw notes

Add entries below. Dates, screenshots/paths, expected behavior, and examples help, but are optional. If you change your mind, append a follow-up referencing the earlier note.

<!-- Write freely below this line. The reviewer will add IDs without changing your words. -->
Jobs and ingestion:
proper separator in jobs section for different jobs platforms that'll be added in future, along with the user custom career pages. and note, user may be adding a lot of dream companies so we need a proper platform and interface for that. 

Saved jobs:
more filters by location, date post range, new apply/already applied to that company (this checks and allow the user if he is applying for the first time or not: this is because, a person would be ok to apply casually and be added in company's data records (company he is applying to), and also he might would like to be prepared for some specific ones first then only apply so his record stays fresh and new the company.) 
one more filter for if the user has applied to the job, application in progress, being interviewed, etc status. this will then later help to track its appliation. (this can be in saved jobs as well or in a better suited place in future)

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

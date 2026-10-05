# CareerOS product UI refresh

This UI refresh precedes CV-to-job matching. It changes presentation and workspace
navigation while keeping the existing authentication, profile, resume, job,
saved-job, company-source and notification workflows.

## What changed

- A persistent desktop sidebar, compact top bar and expandable mobile navigation.
- A dashboard with clear entry points to the existing workflows.
- A matching sign-in/register layout, remembered-account card and existing OAuth controls.
- Consistent page headings, profile sections, resume cards, source filters, notification
  states, job listings, analysis evidence and native preview dialogs.
- Visible keyboard focus, a skip link, responsive layouts and reduced-motion support.
- Existing profile/saved-job discard confirmations also protect the new shell navigation.

Design rules and tokens are in [the workspace design](../design-system/careeros/MASTER.md).
The implementation uses shared React components and an additive stylesheet with
no new package dependencies or paid AI calls.

## Protected work

All 45 paths staged before this work are left unchanged, including `styles.css`,
`JobsPage.tsx` and `JobAnalysisPanel.tsx`. The new stylesheet is imported after the
original, so those screens receive the same design without modifying their files.
The Git index and staged diff are checked against their initial hashes. No UI changes
are staged or committed by this task. Raw project notes are preserved.

## Verification

Completed on 2026-10-05:

- Repository ESLint, frontend TypeScript, production build and whitespace checks passed.
- All 19 existing end-to-end journeys passed using isolated test services, a temporary
  MongoDB database and resume storage. These cover authentication/session restoration,
  profiles, resumes, PDF extraction, structured drafts, jobs, saved jobs, career sources,
  notifications and job-description analysis. Provider and paid AI responses were mocked;
  repaired-PDF extraction used the real parser without an OpenAI key.
- Three new browser checks passed for unsaved-edit confirmations, filtered-view
  navigation, the mobile menu, keyboard focus, the skip link and reduced motion.
- All 10 existing component checks passed with the shared theme loaded.
- Nine pages were reviewed at 1440, 768, 390 and 360px, with no horizontal overflow or
  browser errors. Mobile navigation and PDF preview were also checked. Enlarged-text
  checks at 768px confirmed usable layouts and header spacing.
- Primary and secondary text passed the measured contrast checks; control borders
  exceed 3:1 against white. This was a focused check, not a complete accessibility audit.
- All 45 protected working files, the staged diff and the Git index match their
  original hashes. The UI work remains unstaged.

Live Google/GitHub consent and paid OpenAI calls were not repeated for this UI change.
The isolated test services and their temporary data were removed after verification.

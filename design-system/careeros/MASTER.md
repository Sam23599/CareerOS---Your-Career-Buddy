# CareerOS workspace design

Implemented direction: a calm, professional workspace with forest green accents,
warm neutral backgrounds, readable forms and a consistent navigation shell.

## Rules

- Use the shared sidebar on desktop and the expandable navigation on smaller screens.
- Give each page a clear heading, short description and a visible primary action.
- Keep filters, source-check controls, saved-job notes and document actions accessible.
- Keep original listing text and evidence readable; warn with text as well as color.
- Use native controls and dialogs, visible keyboard focus, 44px control heights,
  responsive single-column forms and reduced-motion support.
- Use the system font stack and the shared SVG icons; no new font, icon or animation dependency.
- Do not show invented account statistics, job counts, progress or unavailable features.

## Tokens

| Role | Value |
| --- | --- |
| Main accent | `#174534` |
| Strong accent | `#103629` |
| Soft accent | `#eaf2eb` |
| Page background | `#f5f6f3` |
| Card surface | `#ffffff` |
| Primary text | `#25332b` |
| Secondary text | `#626f66` |
| Card border | `#dde4dc` |
| Control border | `#87978c` |
| Error text | `#a63838` |
| Card radius | `16px` |
| Spacing | `4 / 8 / 12 / 16 / 24 / 32 / 48px` |

Runtime source: `frontend/web/src/ui/workspace.css`. Shared presentation helpers:
`WorkspaceShell.tsx` and `WorkspaceUi.tsx` in the same directory.

UI UX Pro Max searches informed flat, clear workspace styling and semantic React
navigation. Its marketing-page layouts were not applicable to this signed-in app;
the existing green brand, visible filters and native controls guided this design.

## Historical redesign preservation boundary

The job-description-analysis changes staged before this redesign are protected.
The original `styles.css`, job pages, job-analysis panel and every other staged
path remain byte-for-byte unchanged. The product theme is imported after the
existing stylesheet. These UI changes stay unstaged, with no backend or API changes.

## Notebook refinement (2026-10-07)

The original boundary above describes the earlier staged-only redesign. The current approved notebook batch adds shared dark tokens, compact/native disclosure controls, settings and recovery/task navigation. Existing scoring and profile-import confirmation remain intact. Clearly labelled sample credits are allowed only in the user-requested demo settings; payment actions remain disabled. Runtime dark tokens are in workspace.css.

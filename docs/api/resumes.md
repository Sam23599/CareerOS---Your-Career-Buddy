# Resume management

Open `/resumes` from the dashboard or profile. All endpoints below require a JWT bearer token and operate only on its owner, including for ADMIN accounts.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/resumes` | Returns `{ resumes: [...] }`, newest version first. |
| `POST /api/v1/resumes?name=resume.pdf` | Raw PDF body with `Content-Type: application/pdf`; returns the updated list, status 201. URL-encode the filename. |
| `PUT /api/v1/resumes/:id/active` | Selects one owned, available version as active; returns the list. |
| `GET /api/v1/resumes/:id/download` | Downloads the original bytes as an attachment. |
| `DELETE /api/v1/resumes/:id` | Deletes the file and metadata; returns the list. |

Metadata includes `id`, `name`, `size` in bytes, monotonic `version`, `uploadedAt`, and `active`. A failed deletion also exposes `deleting: true` so the UI can retry cleanup. No filesystem paths are exposed.

PDF only, nonempty, maximum 5 MiB (5,242,880 bytes). Filenames must end in `.pdf`, be at most 200 characters, and contain no path separators/control characters. The API checks the PDF header and end marker; this is basic format validation, not parsing or malware scanning. The download API returns attachments. The View button fetches the same private bytes using JWT authentication and displays a temporary blob URL in an in-page PDF dialog. Closing the dialog or leaving the page releases that URL; unsupported browsers have a download fallback.

Every upload is an immutable version. Version numbers are never reused and may have gaps after failures. An upload becomes active if no active version is selected; otherwise it preserves the selection. Deleting the active version leaves none active. There is no automatic fallback to an older file. Concurrent active selections are last-write-wins, with one active pointer per owner.

Invalid input returns 400, oversize bodies 413, unsupported content types 415, and missing/foreign versions 404. Existing authentication errors remain 401/403. The frontend refreshes JWTs for uploads and authenticated binary downloads.

Files use the `ResumeStorage` interface with `LocalResumeStorage`. Docker mounts `resume_data` at `/data/resumes`; MongoDB stores metadata in `resume_libraries`. For host development, `RESUME_STORAGE_DIR` defaults to `./data/resumes` relative to the API process working directory (normally `backend/platform`). Keep database and file-volume backups together.

Deletion first marks a version unavailable, then removes bytes and metadata. If storage fails, Delete can be retried. A crash or uncertain database response during upload may leave an unreferenced file; files are deliberately retained to avoid deleting a possibly committed upload. Automated orphan reconciliation, quotas, DOCX support, parsing, and AI analysis are deferred.

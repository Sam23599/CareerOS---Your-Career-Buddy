# ADR-004: Private resume versions and local file storage

Status: Accepted. Date: 2026-10-01.

Store original resume bytes behind a small storage interface, initially backed by a private filesystem directory and Docker named volume. MongoDB stores one resume-library document per owner, with metadata, an incrementing version counter, and one active ID. This keeps active selection and metadata deletion atomic without requiring a replica set or transactions.

Accept PDF files up to 5 MiB through a bounded raw-body endpoint. This avoids multipart dependencies for a single-file operation. Use generated UUID storage keys, never user filenames. Require bearer authentication before reading uploads; all reads and mutations are scoped to the authenticated owner. Downloads use attachment disposition.

Each upload creates an immutable version. Select it automatically only when there is no active version. Deleting the active version clears the selection. Reserve version numbers before writing files; gaps are acceptable. Retain files on uncertain database writes rather than risk breaking a committed upload. Mark deletions before touching storage, disable access, and support retries if cleanup fails.

Filesystem and MongoDB writes are not transactional. Orphan-file reconciliation and storage quotas are later hardening work. PDF signatures are basic format checks only. DOCX, parsing, and AI analysis are outside this batch. The storage interface allows a future object-store implementation without changing owner-scoped API contracts.

See [resume API](../api/resumes.md). Jobs and ingestion are the next planned feature.

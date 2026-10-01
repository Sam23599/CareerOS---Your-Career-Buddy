# CareerOS — Phase 1 Implementation Backlog

## Objective

Build the first usable CareerOS platform using:

```text
React
+
Node.js
+
MongoDB
+
Docker
```

Optional infrastructure:

```text
Redis
Object Storage
```

The Phase 1 goal is not to build the complete CareerOS vision.

The goal is to establish a stable platform foundation that later phases can consume.

---

# 1. Milestone 1 — Repository & Tooling

### Tasks

* [x] Initialize repository
* [ ] Configure Git
* [x] Add README
* [x] Add development plan
* [x] Add `docs/`
* [x] Add ADR structure
* [x] Add `.gitignore`
* [x] Add `.env.example`
* [x] Define local development conventions
* [x] Add Docker Compose foundation

### Output

A clean repository that any developer can clone and start locally.

### Backend foundation — implemented

* [x] Express + TypeScript startup and validated environment configuration
* [x] MongoDB connection and separate liveness/readiness endpoints
* [x] JSON request logs, request IDs, and structured errors
* [x] Lint, type checks, build commands, and foundation API tests
* [x] Live Docker startup, database outage recovery, and persistence checks

---

# 2. Milestone 2 — Frontend Foundation

### Tasks

* [x] Create React application
* [x] Configure routing
* [x] Create application shell
* [x] Create authentication pages
* [x] Create dashboard layout
* [ ] Create reusable UI components
* [x] Configure API client
* [x] Configure error handling
* [x] Configure authentication state

Login, registration, and a protected account dashboard are implemented. `/status` retains the connection diagnostic. The protected career profile editor is implemented; public job search and details are implemented.

### Initial pages

```text
/login
/register
/dashboard
/profile
/jobs
/jobs/:id
/saved-jobs
/settings
```

---

# 3. Milestone 3 — Authentication

### Backend

Implement:

* [x] Registration
* [x] Login
* [x] Password hashing
* [x] JWT access token
* [x] Refresh token
* [x] Logout
* [x] Authentication middleware
* [x] Basic RBAC middleware

### Frontend

* [x] Login
* [x] Register
* [x] Protected routes
* [x] Token handling
* [x] Logout

### Acceptance

An unauthenticated user cannot access protected application features.

JWT sessions and Google/GitHub OAuth flows share the same authorization model. Provider credentials are required for live OAuth sign-in; see [setup and API contracts](api/authentication.md). Email verification, password recovery, and account linking remain later work.

---

# 4. Milestone 4 — User Profile — Implemented

### Backend

Implement:

```text
User
Profile
Skills
Experience
Education
Preferences
Connected Accounts
```

### APIs

```text
GET  /users/me
GET  /profiles/me
PATCH /profiles/me
```

### Frontend

Create:

* [x] Profile dashboard
* [x] Skills editor
* [x] Experience editor
* [x] Education editor
* [x] Career preferences
* [x] Connected profile section (saved professional URLs; imports deferred)
* [x] Certifications editor
* [x] Owner-only access, input validation, and concurrent-save protection

See [profile API and validation rules](api/profiles.md).

---

# 5. Milestone 5 — Resume Management — Implemented

### Backend

Implement:

* [x] Resume upload
* [x] Resume metadata
* [x] Multiple resume versions
* [x] Active resume
* [x] Delete resume
* [x] Download resume

Storage:

```text
Local → MinIO / filesystem
Production → S3
```

PDF uploads up to 5 MiB, private downloads, and persistent local storage are implemented. See [resume API](api/resumes.md). No complex AI processing yet.

---

# 6. Milestone 6 — Job Domain

## Normalized Job Model

Minimum fields:

```text
id
title
company
description
location
employmentType
remoteType
skills
source
sourceUrl
postedAt
expiresAt
metadata
createdAt
updatedAt
```

### Tasks

* [x] Job schema
* [x] Import/upsert and job read APIs
* [ ] Manual job editing/deletion (deferred; listings remain provider-owned)
* [x] Source abstraction
* [x] First source adapter
* [x] Job normalization
* [x] Duplicate detection
* [x] Job search
* [x] Filtering
* [x] Pagination

---

# 7. Milestone 7 — Saved Jobs — Implemented

### Tasks

* [x] Save job
* [x] Unsave job
* [x] Saved jobs page
* [x] Notes
* [x] Priority
* [x] Job status

Initial internal statuses:

```text
SAVED
INTERESTED
NOT_INTERESTED
```

Private notes, LOW/MEDIUM/HIGH priority, idempotent saves, and conflict-protected edits are implemented. See [saved-jobs API](api/saved-jobs.md). Application statuses belong to Java later.

---

# 8. Milestone 8 — Custom Career Sources

### Tasks

* [x] Add company
* [x] Add career page URL
* [x] Define search keywords
* [x] Define locations
* [x] Define scan frequency
* [x] Store source configuration

Implemented with private searchable/paginated watchlists, manual or scheduled Greenhouse board checks, and labeled links for unsupported pages. Supported checks run while the API is running; broader automation remains in Phase 6. See [the API contract](api/career-sources.md).

---

# 9. Deferred to Phase 5 — Community Foundation

Deferred to Phase 5 by the confirmed release decision. The tasks below are retained for future planning and do not block Phase 1.

### Teams

* [ ] Create team
* [ ] Update team
* [ ] Delete team
* [ ] List teams
* [ ] Team details

### Membership

* [ ] Invite user
* [ ] Join request
* [ ] Approve request
* [ ] Reject request
* [ ] Remove member
* [ ] Leave team

### Roles

```text
OWNER
ADMIN
MEMBER
```

---

# 10. Deferred to Phase 5 — Community Sharing

In Phase 5, allow members to share:

* [ ] Jobs
* [ ] Articles
* [ ] Projects
* [ ] Resources

Initial posts can remain intentionally simple.

Later iterations can introduce:

* Comments
* Reactions
* Mentions
* Bookmarks
* Moderation
* Search

---

# 11. Milestone 11 — Notification Foundation

Create a provider-independent notification abstraction.

```text
Notification Service
        │
        ├── Browser
        ├── Email
        └── Mobile
```

Initial scope:

* [x] Notification model
* [x] In-app notifications
* [x] Read/unread state
* [x] Notification preferences
* [x] Provider interface

Do not tightly couple the domain to AWS SNS, Firebase, or OneSignal at this stage.

Implemented with matching-job summaries, source-failure alerts, preferences, idempotent in-app delivery, and a retryable pending notice. See [the API contract](api/notifications.md).

---

# 12. Milestone 12 — Redis

Introduce Redis only where it provides clear value.

Initial candidates:

```text
Rate limiting
Session/cache data
Job search cache
Short-lived job-source state
Community presence
```

Avoid using Redis as the source of truth.

---

# 13. Milestone 13 — Testing

Minimum baseline:

### Backend

* [ ] Unit tests
* [ ] API tests
* [ ] Authentication tests
* [ ] RBAC tests
* [x] Job normalization tests
* Community permission tests are deferred to Phase 5.

### Frontend

* [ ] Component tests
* [ ] Authentication flow
* [ ] Critical user journey tests

---

# 14. Milestone 14 — Docker

The complete Phase 1 local environment should eventually start with:

```bash
docker compose up
```

Expected components:

```text
React
Node.js
MongoDB
Redis
Object Storage
```

Kafka, Python, and Java are not required for the first Phase 1 environment.

---

# 15. Phase 1 User Journey

The minimum successful journey is:

```text
Register
   ↓
Create Profile
   ↓
Upload Resume
   ↓
Set Career Preferences
   ↓
Search Jobs
   ↓
Open Job
   ↓
Save Job
```

---

# 16. Phase 1 Definition of Done

Phase 1 is complete when:

* [x] JWT user authentication works (live OAuth requires provider credentials).
* [x] A complete career profile can be maintained.
* [x] A resume can be uploaded and managed.
* [x] Jobs can be ingested and normalized.
* [x] Jobs can be searched and filtered.
* [x] Jobs can be saved.
* [x] Companies/career pages can be configured.
* [x] Basic notifications work.
* [ ] APIs have documentation.
* [ ] Critical workflows have tests.
* [x] Local foundation setup works through Docker.

---

# 17. What Phase 1 Deliberately Excludes

Do not block Phase 1 on:

* Community, teams, and sharing (Phase 5)
* LLM integration
* ATS analysis
* Semantic job matching
* RAG
* Cady
* Kafka
* Java services
* Browser automation
* Voice calls
* Kubernetes
* Advanced analytics

These belong to later phases.

---

# 18. First Development Sequence

The recommended implementation order is:

```text
1. Repository
      ↓
2. Docker / Local Infrastructure
      ↓
3. Node Backend Foundation
      ↓
4. React Foundation
      ↓
5. Authentication
      ↓
6. User Profile
      ↓
7. Resume Management
      ↓
8. Job Domain
      ↓
9. Job Search / Sources
      ↓
10. Saved Jobs
      ↓
11. Notifications
      ↓
12. Testing / Hardening
      ↓
13. Phase 1 Release
```

---

# 19. First ADR Set

Record decisions as their implementation begins. Assign IDs in one `docs/adr/` index; the topics below are not preassigned numbers.

```text
Overall Architecture
Repository Structure
Node.js Platform Boundaries
MongoDB Data Ownership
Authentication & RBAC
Job Source Adapter Architecture
Resume/Object Storage Strategy
```

Later:

```text
Community Service Boundary
AI Intelligence Service
Vector Storage
Kafka Event Architecture
Application Service Ownership
Notification Architecture
Production Deployment
```

The ADR list should grow only when a decision has meaningful architectural consequences.

See [review and next implementation steps](implementation-next-steps.md) for the current foundation batch and completion criteria.

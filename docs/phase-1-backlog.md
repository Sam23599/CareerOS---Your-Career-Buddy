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
* [ ] Add ADR structure
* [ ] Add `.gitignore`
* [ ] Add `.env.example`
* [ ] Define local development conventions
* [ ] Add Docker Compose foundation

### Output

A clean repository that any developer can clone and start locally.

---

# 2. Milestone 2 — Frontend Foundation

### Tasks

* [ ] Create React application
* [ ] Configure routing
* [ ] Create application shell
* [ ] Create authentication pages
* [ ] Create dashboard layout
* [ ] Create reusable UI components
* [ ] Configure API client
* [ ] Configure error handling
* [ ] Configure authentication state

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

* [ ] Registration
* [ ] Login
* [ ] Password hashing
* [ ] JWT access token
* [ ] Refresh token
* [ ] Logout
* [ ] Authentication middleware
* [ ] Basic RBAC middleware

### Frontend

* [ ] Login
* [ ] Register
* [ ] Protected routes
* [ ] Token handling
* [ ] Logout

### Acceptance

An unauthenticated user cannot access protected application features.

---

# 4. Milestone 4 — User Profile

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

* Profile dashboard
* Skills editor
* Experience editor
* Education editor
* Career preferences
* Connected profile section

---

# 5. Milestone 5 — Resume Management

### Backend

Implement:

* [ ] Resume upload
* [ ] Resume metadata
* [ ] Multiple resume versions
* [ ] Active resume
* [ ] Delete resume
* [ ] Download resume

Storage:

```text
Local → MinIO / filesystem
Production → S3
```

No complex AI processing yet.

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

* [ ] Job schema
* [ ] Job CRUD
* [ ] Source abstraction
* [ ] First source adapter
* [ ] Job normalization
* [ ] Duplicate detection
* [ ] Job search
* [ ] Filtering
* [ ] Pagination

---

# 7. Milestone 7 — Saved Jobs

### Tasks

* [ ] Save job
* [ ] Unsave job
* [ ] Saved jobs page
* [ ] Notes
* [ ] Priority
* [ ] Job status

Initial internal statuses:

```text
SAVED
INTERESTED
NOT_INTERESTED
```

Application statuses belong to Java later.

---

# 8. Milestone 8 — Custom Career Sources

### Tasks

* [ ] Add company
* [ ] Add career page URL
* [ ] Define search keywords
* [ ] Define locations
* [ ] Define scan frequency
* [ ] Store source configuration

Initial implementation may support manual triggering.

Scheduled automation can follow after the source adapter architecture is stable.

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

* [ ] Notification model
* [ ] In-app notifications
* [ ] Read/unread state
* [ ] Notification preferences
* [ ] Provider interface

Do not tightly couple the domain to AWS SNS, Firebase, or OneSignal at this stage.

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
* [ ] Job normalization tests
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

* [ ] User authentication works.
* [ ] A complete career profile can be maintained.
* [ ] A resume can be uploaded and managed.
* [ ] Jobs can be ingested and normalized.
* [ ] Jobs can be searched and filtered.
* [ ] Jobs can be saved.
* [ ] Companies/career pages can be configured.
* [ ] Basic notifications work.
* [ ] APIs have documentation.
* [ ] Critical workflows have tests.
* [ ] Local setup works through Docker.

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

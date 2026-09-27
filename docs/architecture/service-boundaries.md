# CareerOS — Service Boundaries

## 1. Purpose

This document defines the initial responsibility boundaries for CareerOS services.

The boundaries are logical first and deployment boundaries second.

A service may initially run as part of the same process and later be independently deployed when required.

---

# 2. Platform & Integrations — Node.js

## API Gateway

### Owns

* Frontend entry point
* API versioning
* JWT validation
* Rate limiting
* Request IDs
* Routing
* Authentication middleware
* Authorization middleware

### Does not own

* Business data
* AI processing
* Application state

---

## Identity / Profile

### Owns

* Users
* Authentication
* Profile
* Skills
* Experience
* Education
* Connected profiles
* User preferences

### Example APIs

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
GET  /users/me
GET  /profiles/me
PATCH /profiles/me
```

---

## Job Service

### Owns

* Job sources
* Job adapters
* Normalized jobs
* Job search
* Saved jobs
* Custom company sources
* Search preferences
* Job deduplication

### Example APIs

```text
GET  /jobs
GET  /jobs/{id}
POST /jobs/search
POST /jobs/{id}/save
DELETE /jobs/{id}/save

POST /job-sources
GET  /job-sources

POST /companies/{id}/career-source
```

---

## Community Service

### Owns

* Teams
* Memberships
* Invitations
* Join requests
* Team roles
* Posts
* Shared resources
* Community permissions
* WebSocket sessions/presence initially

### Example APIs

```text
POST /teams
GET  /teams
GET  /teams/{id}

POST /teams/{id}/invite
POST /teams/{id}/join
POST /teams/{id}/approve

GET  /teams/{id}/posts
POST /teams/{id}/posts

WS /ws/teams/{id}
```

---

## Notification Service

### Owns

* Notification records
* Notification preferences
* Delivery state
* Browser notification integration
* Email notification integration
* Mobile notification integration

The service should depend on provider abstractions rather than directly coupling business logic to a single provider.

---

# 3. Intelligence & AI — Python

## Intelligence Service

### Owns

* Resume parsing
* JD parsing
* Skill extraction
* ATS analysis
* Matching
* Ranking
* Skill-gap analysis
* Recommendations
* RAG
* Embeddings
* Cady
* AI tool orchestration

### Example APIs

```text
POST /resume/analyze
POST /jobs/{id}/analyze
POST /jobs/{id}/match
POST /matching/batch
POST /skills/analyze
POST /assistant/chat
GET  /recommendations
```

The service should consume Node/Java capabilities through APIs or Kafka rather than querying their databases directly.

---

# 4. Applications & Workflows — Java

## Application Service

### Owns

* Applications
* Status transitions
* Application history
* Application notes
* Application metadata

### Example APIs

```text
POST   /applications
GET    /applications
GET    /applications/{id}
PATCH  /applications/{id}/status
DELETE /applications/{id}
GET    /applications/{id}/history
```

---

## Interview / Workflow Service

### Owns

* Interview rounds
* Scheduling
* Feedback
* Interview state
* Workflow coordination

### Example APIs

```text
POST /applications/{id}/interviews
GET  /applications/{id}/interviews
PATCH /interviews/{id}
POST /interviews/{id}/feedback
```

---

# 5. Ownership Rules

### Rule 1

No service directly reads another service's primary database.

### Rule 2

A service may cache data belonging to another service, but the source of truth remains with the owner.

### Rule 3

Business state changes are published as events when other services need to react.

### Rule 4

Synchronous REST is preferred when the caller requires an immediate result.

### Rule 5

Kafka is preferred for independent downstream reactions.

### Rule 6

AI services call business capabilities through APIs/tools instead of bypassing domain boundaries.

---

# 6. Cross-Domain Example

## User saves a job

```text
React
 ↓
Gateway
 ↓
Job Service
 ↓
MongoDB
```

No event is required unless another domain needs to react.

---

## User applies to a job

```text
React
 ↓
Gateway
 ↓
Application Service
 ↓
PostgreSQL
 ↓
application.created
 ↓
Kafka
```

Consumers can react independently.

---

## New job matches a user

```text
Job Service
 ↓
job.created
 ↓
Kafka
 ↓
Python
 ↓
job.match.calculated
 ↓
Notification
```

---

# 7. Service Extraction Strategy

A module should become a separately deployed service when one or more of these become true:

* Independent scaling is needed.
* Deployment cadence differs.
* Ownership becomes distinct.
* Failure isolation becomes important.
* Processing requirements differ significantly.
* Team boundaries justify separation.
* Resource usage becomes independently measurable.

Microservices are therefore an **evolutionary outcome**, not a requirement that every module be deployed independently from day one.

# CareerOS — System Architecture Overview

Current implementation: React, Express/MongoDB, and modular Python/FastAPI with Python-owned PostgreSQL for structured resume drafts and job analyses, plus on-demand deterministic CV/job matching, resume checks/preparation and saved-job ranking. See [ADR-001](../adr/001-local-platform-foundation.md), [ADR-010](../adr/010-resume-intelligence-foundation.md), [ADR-011](../adr/011-structured-resume-drafts.md), [ADR-012](../adr/012-job-description-analysis.md), [ADR-013](../adr/013-cv-job-matching.md), [ADR-014](../adr/014-resume-checks.md) and [ADR-015](../adr/015-saved-job-ranking.md). Reports reuse saved analyses without new AI calls or persistence. Node orchestrates its saved shortlist/preferences through existing Python matching; [personalized AI preparation and initial Cady](../personalized-preparation.md) now reuse shared intelligence providers, with source-checked background plan generation and read-only context answers ([ADR-017](../adr/017-personalized-preparation-and-initial-cady.md)). The diagrams below describe the planned evolution; Java, Redis, Kafka and advanced Cady remain future work.

## 1. Purpose

This document defines the initial technical architecture of CareerOS.

The architecture is intentionally progressive:

```text
Phase 1
React + Node.js
       ↓
Phase 2
+ FastAPI / AI
       ↓
Phase 3
+ Spring Boot
       ↓
Phase 4
+ Kafka / Event Driven
       ↓
Phase 5
+ Real-time Community
       ↓
Production Infrastructure
```

The goal is to establish strong domain ownership without prematurely turning every module into an independent distributed service.

---

# 2. High-Level Architecture

```text
                         ┌──────────────────────┐
                         │      React Web       │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    Node API Gateway  │
                         └──────────┬───────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
     ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
     │ Platform &      │   │ Intelligence &  │   │ Applications &  │
     │ Integrations    │   │ AI              │   │ Workflows       │
     │ Node.js         │   │ FastAPI         │   │ Java            │
     └────────┬────────┘   └────────┬────────┘   └────────┬────────┘
              │                     │                     │
              ▼                     ▼                     ▼
          MongoDB              AI / Vector DB          PostgreSQL
              │                     │                     │
              └──────────────┬──────┴──────────────┬──────┘
                             │                     │
                             ▼                     ▼
                          Redis                  Kafka
```

The API Gateway is the primary frontend entry point.

The frontend should not normally communicate directly with internal services.

### Planned intelligence execution boundary

Current job tasks run through a PostgreSQL-backed poller inside FastAPI. The
[Celery migration plan](../intelligence-background-processing-plan.md) proposes
`Node → FastAPI → PostgreSQL task/outbox → Redis broker → Celery worker`, reusing
existing Python domain/LLM services. PostgreSQL remains authoritative for owned
task history and versioned artifacts; broker messages carry task IDs only.
Introduce a shared generation permit before separating worker/API processes.
Job analysis moves first, resume AI drafts later; fast matching/checks stay inline.
Redis task delivery is planned independently of Kafka's later cross-domain events.
Workers receive no CareerOS JWT secret, Node MongoDB access or original-resume mount.

---

# 3. Backend Domain Ownership

## Platform & Integrations — Node.js

Owns functionality required to operate the platform.

### Responsibilities

* Authentication
* User identity
* User profiles
* Connected professional profiles
* Resume metadata
* Job aggregation
* Job-source adapters
* Job search
* Saved jobs
* Custom company sources
* Community & collaboration
* Notifications
* API gateway
* Frontend-facing APIs

### Primary datastore

**MongoDB**

Suitable for flexible profile, job, integration, and community documents.

---

## Intelligence & AI — Python / FastAPI

Owns computational and AI-driven intelligence.

### Responsibilities

* Resume parsing
* Resume analysis
* JD parsing
* Skill extraction
* ATS analysis
* Profile ↔ JD matching
* Skill-gap analysis
* Job ranking
* Recommendations
* Cady
* NLP
* ML
* RAG
* Embeddings
* LLM integrations
* Agentic workflows

### Data

The Python domain should own its own AI-related data.

Potentially:

```text
PostgreSQL + pgvector
```

for:

* Embeddings
* Analysis results
* AI-generated artifacts
* Retrieval metadata
* Cady memory/context where appropriate

The Python service should not directly access Node's MongoDB or Java's PostgreSQL.

---

## Applications & Workflows — Java / Spring Boot

Owns transactional career workflows.

### Responsibilities

* Job applications
* Application state machine
* Application history
* Interviews
* Interview scheduling
* Interview feedback
* Application analytics
* Transactional workflows

### Primary datastore

**PostgreSQL**

---

# 4. Service Boundaries

The initial logical services are:

```text
Node.js
├── API Gateway
├── Identity / Profile
├── Job Service
├── Community Service
└── Notification Service

Python
└── Intelligence Service

Java
├── Application Service
└── Interview / Workflow Service
```

These are **logical ownership boundaries**.

They do not all need to become independently deployed processes on day one.

The initial implementation should allow related Node modules to be deployed together and split later when justified.

---

# 5. Database Ownership

The guiding rule is:

> A service owns its data. Other services access that data through APIs or events.

### Node / Platform

```text
MongoDB
├── users
├── profiles
├── connected_accounts
├── jobs
├── job_sources
├── saved_jobs
├── search_preferences
├── teams
├── memberships
├── posts
└── notifications
```

### Python / Intelligence

```text
PostgreSQL + pgvector
├── resume_analysis
├── job_analysis
├── skill_extractions
├── match_results
├── embeddings
└── assistant_context
```

### Java / Applications

```text
PostgreSQL
├── applications
├── application_status_history
├── interviews
├── interview_feedback
└── application_analytics
```

### Redis

Redis is shared infrastructure but data should be logically namespaced by service.

Examples:

```text
platform:session:*
platform:rate-limit:*
job:search:*
community:presence:*
ai:cache:*
```

### Kafka

Kafka owns no business state.

It transports events between domains.

---

# 6. Object Storage

Resume and other uploaded documents should not be stored directly inside MongoDB/PostgreSQL.

Use:

```text
S3
```

or local development equivalent:

```text
MinIO
```

Example:

```text
User
 ↓
Resume Upload
 ↓
Object Storage
 ↓
Python Intelligence Service
 ↓
Resume Analysis
```

---

# 7. API Architecture

The frontend communicates with:

```text
React
 ↓
/api/v1
 ↓
Node API Gateway
```

Example public API structure:

```text
/api/v1/auth/*
/api/v1/users/*
/api/v1/profiles/*
/api/v1/jobs/*
/api/v1/saved-jobs/*
/api/v1/teams/*
/api/v1/community/*
/api/v1/notifications/*
/api/v1/intelligence/*
/api/v1/applications/*
/api/v1/interviews/*
```

The gateway is responsible for:

* JWT validation
* Request authentication
* Authorization enforcement
* Rate limiting
* Request validation
* Routing
* API versioning
* Correlation IDs
* Response normalization

---

# 8. Inter-Service Communication

CareerOS will use both synchronous and asynchronous communication.

## REST

Use REST when the caller needs an immediate response.

Examples:

```text
GET profile
GET job
GET application
POST resume-analysis
POST job-match
PATCH application-status
```

## Kafka

Use events when:

> Something happened and other services may need to react.

Examples:

```text
job.created
resume.analyzed
job.match.calculated
application.created
application.status.changed
interview.scheduled
```

---

# 9. Example — Job Matching Flow

```text
User
 ↓
React
 ↓
Node Gateway
 ↓
Python Intelligence
 ↓
Resume + Job Data
 ↓
Matching Engine
 ↓
Match Result
 ↓
Node
 ↓
React
```

The initial implementation can be synchronous.

Later:

```text
Job Created
     ↓
Kafka
     ↓
Python
     ↓
Match Calculation
     ↓
job.match.calculated
     ↓
Notification / Recommendation
```

---

# 10. Example — Application Flow

```text
React
 ↓
Node Gateway
 ↓
Java Application Service
 ↓
PostgreSQL
 ↓
application.created
 ↓
Kafka
 ├── Notification
 ├── Analytics
 └── Intelligence
```

The Java service remains the owner of application state.

---

# 11. Community Architecture

Community functionality belongs to **Platform & Integrations**.

```text
Node
└── Community Service
    ├── Teams
    ├── Memberships
    ├── Invitations
    ├── Join Requests
    ├── Team RBAC
    ├── Posts
    ├── Shared Resources
    └── Real-time Communication
```

### Initial real-time architecture

```text
React
  ↓
WebSocket
  ↓
Community Service
```

For voice/video later:

```text
WebSocket → Signaling
WebRTC    → Media
```

A separate real-time service should only be introduced if scale or operational requirements justify it.

---

# 12. RBAC Model

CareerOS will have two authorization layers.

## System RBAC

Example:

```text
USER
ADMIN
```

## Team RBAC

Example:

```text
OWNER
ADMIN
MEMBER
```

Permissions should be explicit rather than relying only on role names.

```text
CREATE_TEAM
MANAGE_TEAM
MANAGE_MEMBERS
APPROVE_JOIN_REQUEST
CREATE_POST
EDIT_POST
DELETE_POST
SHARE_RESOURCE
```

JWT should contain stable identity and global roles.

Team membership/permissions should be resolved through the platform domain, with Redis caching where useful.

---

# 13. Job Source Architecture

External job sources should use adapters.

```text
                 Job Service
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
    Naukri        Indeed      Company Careers
    Adapter       Adapter        Adapter
        │            │             │
        └────────────┼─────────────┘
                     ▼
              Normalized Job
                     ▼
                 MongoDB
```

Each integration should produce a common internal schema.

This allows additional sources to be added without changing the rest of CareerOS.

External-source implementations should respect applicable API policies, authentication requirements, rate limits, and site terms.

---

# 14. Cady Architecture

Cady belongs inside the Python intelligence domain.

```text
                        Cady
                         │
              ┌──────────┴──────────┐
              │                     │
           LLM Layer            Tool Layer
              │                     │
      OpenAI / Gemini       CareerOS APIs
              │                     │
              └──────────┬──────────┘
                         │
                    LangGraph
                         │
                  RAG / Retrieval
                         │
              User Career Context
```

Cady should use APIs/tools rather than directly reading another service's database.

Example tools:

```text
get_user_profile()
get_resume()
get_saved_jobs()
get_job_details()
get_application_history()
get_interview_history()
get_skill_gaps()
get_team_resources()
```

This preserves service ownership.

---

# 15. RAG Strategy

Potential knowledge sources:

```text
User Resume
User Profile
Job Descriptions
Company Information
Preparation Material
Projects
Technical Notes
Community Resources
```

Retrieval must respect visibility.

For example:

```text
User-private data
      ≠
Team-private data
      ≠
Public community data
```

The retrieval layer should apply authorization filters before returning context to an LLM.

---

# 16. Kafka Event Catalog — Initial

| Event                        | Producer | Potential Consumers     |
| ---------------------------- | -------- | ----------------------- |
| `user.profile.updated`       | Node     | Python                  |
| `job.created`                | Node     | Python, Notification    |
| `job.updated`                | Node     | Python                  |
| `resume.analyzed`            | Python   | Node, Notification      |
| `job.match.calculated`       | Python   | Node, Notification      |
| `application.created`        | Java     | Notification, Analytics |
| `application.status.changed` | Java     | Notification, Python    |
| `interview.scheduled`        | Java     | Notification            |
| `team.member.joined`         | Node     | Notification            |
| `community.post.created`     | Node     | Notification            |

The initial Kafka implementation should contain only events that have meaningful consumers.

---

# 17. Transactional Event Publishing

Once Kafka is introduced, avoid unreliable patterns such as:

```text
Database Write
      ↓
Kafka Publish
```

where the database succeeds but Kafka fails.

For critical workflows, progressively introduce:

```text
Database Transaction
        ↓
Outbox Event
        ↓
Kafka Publisher
        ↓
Kafka
```

This is especially important for the Java application domain.

---

# 18. Phase-by-Phase Architecture

## Phase 1

```text
React
  ↓
Node
  ├── MongoDB
  ├── Redis
  └── Object Storage
```

No Kafka requirement.

---

## Phase 2

```text
React
 ↓
Node
 ├── MongoDB
 └── Python
       ├── AI
       ├── RAG
       └── Vector Store
```

---

## Phase 3

```text
              Node
             /    \
         Python   Java
           │        │
      AI Storage  PostgreSQL
```

---

## Phase 4

```text
              Kafka
          /     |      \
       Node   Python   Java
         \      |      /
             Events
```

---

## Phase 5

```text
React
 ├── REST
 └── WebSocket
        ↓
 Community Service
```

---

# 19. Non-Goals for Initial Architecture

The first version should not attempt to solve:

* Full autonomous job application
* Browser automation at scale
* Video conferencing infrastructure
* Multi-region deployment
* Kubernetes-first deployment
* Dozens of microservices
* Fully autonomous AI agents
* Complex ML ranking models before baseline matching exists

These can be introduced after the core product is stable.

---

# 20. Core Architectural Rule

CareerOS should follow:

> **Own data by domain, expose capabilities through APIs, communicate asynchronous business events through Kafka, and keep AI as a consumer/orchestrator of domain capabilities rather than a direct owner of business data.**

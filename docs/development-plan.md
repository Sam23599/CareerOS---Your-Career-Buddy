# CareerOS — Development Plan

> **Development roadmap for CareerOS — Your Career Buddy**

This document defines the planned development path for CareerOS.

The roadmap is intentionally incremental. The project will begin with a relatively simple architecture and progressively introduce AI, additional backend technologies, event-driven communication, real-time capabilities, and production infrastructure.

The plan is expected to evolve as implementation exposes new requirements and architectural constraints.

---

# 1. Development Philosophy

CareerOS will follow these principles during development:

1. **Build a usable product before optimizing the architecture.**
2. **Introduce complexity only when the product requires it.**
3. **Give every backend technology a meaningful domain responsibility.**
4. **Keep service boundaries explicit.**
5. **Prefer asynchronous events where decoupling provides real value.**
6. **Keep external integrations replaceable through adapters.**
7. **Document important architectural decisions through ADRs.**
8. **Treat security, observability, and reliability as progressive concerns rather than final-stage additions.**
9. **Build locally first and make the system deployable through containers.**
10. **Keep future capabilities isolated from the initial MVP.**

---

# 2. Overall Development Roadmap

```text
Phase 0
Project Foundation
        ↓
Phase 1
Core Platform & Integrations
        ↓
Phase 2
Job Intelligence & AI
        ↓
Phase 3
Applications & Workflows
        ↓
Phase 4
Event-Driven Architecture
        ↓
Phase 5
Community & Real-Time Platform
        ↓
Phase 6
Notifications & Automation
        ↓
Phase 7
Production Infrastructure
        ↓
Phase 8
Advanced AI & Career Agent
```

Not every phase needs to be completed before the next phase begins. Some capabilities will overlap where appropriate.

---

# 3. Phase 0 — Project Foundation

## Objective

Establish the repository, development standards, documentation, and local development environment.

## Tasks

### Repository

* [ ] Create GitHub repository
* [x] Create initial README
* [x] Create development plan
* [x] Create `docs/` structure
* [x] Create ADR structure
* [ ] Define repository conventions
* [ ] Define branch strategy
* [ ] Define commit conventions

### Initial Structure

```text
career-os/
│
├── frontend/
│
├── backend/
│   ├── Platform & Integrations/
│   ├── Intelligence & AI/
│   └── Applications & Workflows/
│
├── infrastructure/
│
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── events/
│   └── adr/
│
├── docker-compose.yml
└── README.md
```

### Development Standards

Define:

* Coding conventions
* Environment configuration
* `.env` strategy
* API naming conventions
* Error-response format
* Logging conventions
* Testing strategy
* API documentation strategy

### Initial ADRs

Potential initial topics (assign IDs in one `docs/adr/` index as decisions are recorded):

```text
Overall Architecture
Repository Structure
Database Strategy
Authentication Strategy
```

---

# 4. Phase 1 — Core Platform & Integrations

## Technology

* React
* Node.js
* Express.js
* MongoDB
* Redis where required

## Objective

Build the first usable version of CareerOS.

The platform should allow a user to create an account, build a professional profile, search for jobs, and save relevant opportunities.

---

## 4.1 Authentication & Identity

### Features

* User registration
* Login
* Logout
* Password management
* JWT-based authentication
* Refresh-token strategy
* Basic RBAC
* User session management

### Initial Roles

```text
USER
ADMIN
```

Team-specific roles will be introduced with the community domain.

---

# 4.2 User Profile

Create a centralized career profile.

### Profile information

* Personal information
* Professional summary
* Skills
* Experience
* Education
* Certifications
* Preferred roles
* Preferred locations
* Work-mode preference
* Experience level
* Salary expectations
* Career interests

---

# 4.3 External Profile Connections

Allow users to connect/import information from:

* LinkedIn
* Naukri
* GitHub
* Coding platforms
* Portfolio
* Other professional profiles

The first implementation should focus on supported integrations rather than attempting to automate every external platform.

---

# 4.4 Resume Management

Initial functionality:

* Upload CV
* Store resume metadata
* Maintain multiple resume versions
* Select an active resume
* Download/delete resume

AI-based analysis will be introduced in Phase 2.

---

# 4.5 Job Aggregation

Create a normalized internal job representation.

```text
External Source
      ↓
Source Adapter
      ↓
Normalization
      ↓
Deduplication
      ↓
CareerOS Job
```

### Initial sources

Start with a small number of sources.

Potential integrations:

* Naukri
* Indeed
* Wellfound
* Foundit
* Other supported sources

Additional sources should be added through independent adapters.

---

# 4.6 Custom Company Career Pages

Allow users to add companies they are interested in.

Example:

```text
Company
├── Name
├── Career URL
├── Search preferences
├── Keywords
├── Locations
└── Monitoring schedule
```

The platform can later periodically inspect these sources for relevant jobs.

---

# 4.7 Job Search

Implement:

* Keyword search
* Location filtering
* Remote filtering
* Experience filtering
* Technology/skill filtering
* Company filtering
* Source filtering
* Date filtering

---

# 4.8 Saved Jobs

Users can:

* Save jobs
* Remove saved jobs
* Add notes
* Add priority
* Categorize jobs
* Mark jobs as viewed

---

# 4.9 Basic Notifications

Introduce the notification abstraction without over-engineering it.

Potential channels:

* In-app
* Browser
* Email

Provider integrations can be introduced progressively.

---

## Phase 1 Milestone

CareerOS should now support:

```text
Register
   ↓
Create Profile
   ↓
Upload Resume
   ↓
Search Jobs
   ↓
View Job
   ↓
Save Job
```

At this point, CareerOS should already be usable without AI.

---

# 5. Phase 2 — Intelligence & AI

The [Phase 2 implementation backlog](phase-2-backlog.md) defines the executable sequence. Its first batch is private PDF text extraction through Python, with [ADR-010](adr/010-resume-intelligence-foundation.md) and an [API contract](api/intelligence.md). Batches 1–3 are implemented locally: private PDF extraction, OpenAI-assisted structured drafts with explicit profile import, and job-description requirements/evidence with private version history. See [ADR-011](adr/011-structured-resume-drafts.md) and [ADR-012](adr/012-job-description-analysis.md). Matching and Cady remain planned.

## Technology

* Python
* FastAPI
* NLP libraries
* OpenAI API
* Gemini API
* Embeddings
* Vector search
* RAG
* LangChain / LangGraph where appropriate

## Objective

Introduce the intelligence layer and Cady.

---

# 5.1 Resume Intelligence

Pipeline:

```text
Resume
   ↓
Document Parsing
   ↓
Text Extraction
   ↓
Section Detection
   ↓
Skill Extraction
   ↓
Experience Extraction
   ↓
Structured Profile
```

Extract:

* Skills
* Technologies
* Roles
* Experience
* Education
* Certifications
* Projects
* Keywords

---

# 5.2 Job Description Intelligence

Process job descriptions similarly.

```text
Job Description
      ↓
Parsing
      ↓
Requirements Extraction
      ↓
Skills
      ↓
Experience
      ↓
Responsibilities
      ↓
Keywords
```

---

# 5.3 Resume ↔ Job Matching

Compare:

```text
User Profile
     +
Resume
     +
Job Description
     ↓
Matching Engine
```

Produce:

* Match score
* Matched skills
* Missing skills
* Relevant experience
* Keyword gaps
* Potential concerns
* Explanation

The matching system should initially establish an explainable baseline before depending heavily on LLM-generated judgments.

---

# 5.4 ATS Analysis

Analyze resumes against a selected JD.

Potential checks:

* Keyword coverage
* Skill coverage
* Role alignment
* Resume structure
* Relevant experience
* Missing terminology
* Section completeness

Output:

```text
ATS Analysis
├── Overall assessment
├── Keyword coverage
├── Skills coverage
├── Missing keywords
├── Improvement suggestions
└── JD alignment
```

---

# 5.5 Skill-Gap Analysis

Identify:

```text
Required Skills
       -
Existing Skills
       ↓
Skill Gap
```

Then generate recommendations for:

* Learning resources
* Topics
* Projects
* Coding problems
* System-design concepts
* Practical exercises

---

# 5.6 Job Ranking & Recommendations

Jobs can eventually be ranked using multiple signals:

```text
Profile Match
+
Skill Match
+
Experience Match
+
Location Preference
+
Work Mode
+
Company Preference
+
Career Goals
```

The exact ranking methodology will be documented and iterated through ADRs.

---

# 5.7 Cady — Initial Version

Cady should initially operate as an AI assistant capable of answering questions using the user's career context.

Examples:

> "Which jobs from my saved list should I prepare for first?"

> "Why am I not matching well with this role?"

> "What skills am I missing for this company?"

> "How should I improve my resume for this JD?"

The first version should remain focused on **career intelligence**, rather than attempting autonomous actions.

---

# Phase 2 Milestone

```text
Resume
   ↓
AI Analysis
   ↓
Profile Intelligence
   ↓
Job Matching
   ↓
Skill Gap
   ↓
Personalized Preparation
```

---

# 6. Phase 3 — Applications & Workflows

## Technology

* Java
* Spring Boot
* PostgreSQL

## Objective

Introduce the transactional application-management domain.

---

# 6.1 Application Tracking

Users can create an application from a saved job.

Example lifecycle:

```text
SAVED
  ↓
APPLIED
  ↓
SCREENING
  ↓
INTERVIEW
  ↓
OFFER
```

Alternative paths:

```text
APPLIED → REJECTED
APPLIED → WITHDRAWN
INTERVIEW → REJECTED
```

---

# 6.2 Application History

Track:

* Status changes
* Dates
* Notes
* Recruiter information
* Job information
* Resume used
* Application source
* Interview history

---

# 6.3 Interview Management

Track:

* Interview rounds
* Round type
* Date/time
* Interviewer
* Meeting information
* Preparation status
* Feedback
* Outcome

---

# 6.4 Application Analytics

Potential metrics:

* Applications per week
* Applications per company
* Response rate
* Interview rate
* Rejection rate
* Offer rate
* Source performance
* Role performance
* Skill correlation

---

# Phase 3 Milestone

The platform should now provide:

```text
Discover
   ↓
Match
   ↓
Prepare
   ↓
Apply
   ↓
Track
   ↓
Analyze
```

---

# 7. Phase 4 — Event-Driven Architecture

## Technology

* Apache Kafka
* Redis
* Existing Node/Python/Java services

## Objective

Introduce asynchronous communication between domains.

Kafka should **not replace every REST API**.

Use synchronous APIs when an immediate response is required.

Use events when:

> Something happened and other parts of the system may need to react.

---

## Initial Events

```text
user.profile.updated
job.created
job.updated
resume.analyzed
job.match.calculated
application.created
application.status.changed
interview.scheduled
```

---

## Example

```text
Application Service
       │
       │ application.created
       ▼
     Kafka
       │
       ├──► Notification
       │
       ├──► Analytics
       │
       └──► Intelligence
```

---

## New Job Flow

```text
Job Source
    ↓
Node Job Service
    ↓
Job Created
    ↓
Kafka
    ↓
Python Intelligence
    ↓
Match Calculation
    ↓
Kafka
    ↓
Notification
```

This allows new functionality to consume job events without tightly coupling services together.

---

# 8. Phase 5 — Community & Real-Time Platform

## Technology

Initially:

* Node.js
* WebSockets
* MongoDB
* Redis

Potential future additions:

* Kafka
* WebRTC
* Dedicated real-time infrastructure

## Objective

Build the social and collaborative side of CareerOS.

---

# 8.1 Teams

Users can:

* Create teams
* Join teams
* Leave teams
* Invite users
* Generate invite links
* Request membership

---

# 8.2 Team RBAC

Initial roles:

```text
OWNER
ADMIN
MEMBER
```

Potential permissions:

```text
MANAGE_TEAM
MANAGE_MEMBERS
APPROVE_REQUESTS
DELETE_CONTENT
CREATE_CONTENT
VIEW_CONTENT
```

---

# 8.3 Community Content

Users can share:

* Jobs
* Articles
* Blogs
* Projects
* Resources
* Preparation material

Potential future features:

* Posts
* Comments
* Reactions
* Bookmarks
* Mentions
* Search

---

# 8.4 Real-Time Communication

Initial implementation:

```text
Client
  ↓
WebSocket
  ↓
Community Service
```

Potential capabilities:

* Direct messaging
* Team messaging
* Presence
* Typing indicators
* Real-time notifications

Voice communication can later be explored through WebRTC.

---

# Phase 5 Milestone

CareerOS becomes both:

```text
Career Platform
      +
Career Community
```

---

# 9. Phase 6 — Notifications & Automation

## Objective

Create a consistent notification system across the platform.

Potential providers:

* AWS SNS
* Firebase
* OneSignal
* Email provider

Potential notification types:

```text
New matching job
Resume analysis completed
Application status reminder
Interview reminder
Team invitation
Join request
Team activity
Cady recommendation
Company job update
```

---

## Scheduled Automation

Potential automation capabilities:

* Periodic company career-page scans
* Job-source scans
* New matching-job alerts
* Preparation reminders
* Application follow-ups
* Interview reminders
* Skill-development reminders

Scheduling should be configurable per user.

---

# 10. Phase 7 — Production Infrastructure

## Objective

Make CareerOS production-deployable.

---

# 10.1 Containerization

Every service should eventually have its own container.

Local development:

```text
docker compose up
```

should be capable of starting the required platform components.

---

# 10.2 AWS

Potential architecture:

```text
AWS
│
├── ECS
│   ├── Node Services
│   ├── Python Service
│   └── Java Services
│
├── ECR
├── S3
├── IAM
├── CloudWatch
├── SNS
├── Secrets Manager
└── SSM
```

The exact AWS architecture will be determined later.

---

# 10.3 CI/CD

Potential pipeline:

```text
Git Push
   ↓
Tests
   ↓
Lint
   ↓
Build
   ↓
Docker Image
   ↓
Security Checks
   ↓
Push to Registry
   ↓
Deployment
```

---

# 10.4 Observability

Introduce:

* Structured logging
* Metrics
* Health checks
* Distributed tracing
* Error tracking

Potential stack:

```text
OpenTelemetry
      ↓
Metrics / Traces / Logs
      ↓
Monitoring
```

Important metrics include:

* API latency
* Error rates
* Database performance
* Kafka consumer lag
* Queue depth
* AI request latency
* External-source failures

---

# 10.5 Security

Progressively introduce:

* JWT
* Refresh tokens
* RBAC
* OAuth2
* Service-to-service authentication
* Secrets management
* Rate limiting
* Input validation
* Secure file handling
* API security
* Audit logging

---

# 11. Phase 8 — Advanced Cady

This phase represents the longer-term AI vision.

Cady can evolve from an assistant into a career-oriented agent.

Potential capabilities:

```text
                 Cady
                  │
        ┌─────────┼─────────┐
        ↓         ↓         ↓
     Discover   Prepare   Analyze
        │         │         │
        ↓         ↓         ↓
      Jobs     Projects   Profile
        │         │         │
        └─────────┼─────────┘
                  ↓
              Recommend
```

Potential future capabilities:

* Autonomous job discovery
* Personalized job feeds
* Company-specific preparation plans
* Resume improvement
* Application follow-up recommendations
* Interview preparation
* Career progression analysis
* Personalized learning plans
* Agentic workflows
* Browser-assisted application workflows

---

# 12. Future / Optional Features

These features are intentionally **not part of the initial MVP**.

## Automated Job Application

Potentially:

```text
Job
 ↓
Cady
 ↓
Application Preparation
 ↓
Browser Automation
 ↓
User Confirmation
 ↓
Application
```

This will require careful consideration of:

* Website terms
* Authentication
* CAPTCHA
* Anti-bot mechanisms
* User consent
* Privacy
* Reliability

---

## Voice Assistant

Potential future architecture:

```text
Voice
 ↓
Speech-to-Text
 ↓
Cady
 ↓
Career Intelligence
 ↓
Text-to-Speech
```

---

## Advanced Community Communication

Potentially:

* Voice calls
* Video calls
* Screen sharing
* Group study rooms
* Interview practice rooms

---

# 13. Testing Strategy

Testing will evolve with the system.

### Unit Tests

Each service should have domain-level unit tests.

### Integration Tests

Validate:

* Database interactions
* External integrations
* API contracts
* Kafka events
* Redis behavior

### End-to-End Tests

Important user journeys:

```text
Register → Profile → Search → Save Job

Resume → Analyze → Match → Prepare

Job → Apply → Track → Interview

Create Team → Invite → Join → Share
```

### Contract Testing

As services become more independent, API/event contracts should be tested to prevent breaking changes.

---

# 14. Documentation Strategy

Documentation will evolve alongside the implementation.

```text
docs/
│
├── architecture/
│   ├── system-overview.md
│   ├── service-boundaries.md
│   └── data-flow.md
│
├── api/
│   └── ...
│
├── events/
│   ├── event-catalog.md
│   └── schemas/
│
└── adr/
    ├── ADR-001-...
    ├── ADR-002-...
    └── ...
```

Documentation should describe the **actual implemented architecture**, not merely the intended architecture.

---

# 15. Milestone Definition

A phase is considered complete when:

1. Its core functionality works locally.
2. Relevant APIs are documented.
3. Tests exist for critical paths.
4. Authentication/authorization requirements are satisfied.
5. Required documentation is updated.
6. Architectural decisions are recorded where necessary.
7. The feature can be demonstrated independently.

---

# 16. Release Targets

The first usable release is Phase 1: authentication, profile/preferences, resume management, job ingestion/search, saved jobs, custom source configuration, and basic notifications. Community, teams, and sharing are deferred to Phase 5.

The broader product MVP spans Phases 1–3 and should focus on:

```text
Authentication
       ↓
User Profile
       ↓
Resume Upload
       ↓
Job Search
       ↓
Job Aggregation
       ↓
Save Jobs
       ↓
Application Tracking
       ↓
Basic AI Matching
```

This broader target does not add AI or application tracking to the Phase 1 release requirements.

---

# 17. Long-Term Product Flow

The eventual CareerOS experience should look approximately like:

```text
                    CAREEROS
                       │
          ┌────────────┴────────────┐
          │                         │
      Career Engine             Community
          │                         │
          ↓                         ↓
      Job Search                Teams
          ↓                     Discussions
      Job Match                 Resources
          ↓                     Networking
      Preparation                   │
          ↓                         │
      Application ←─────────────────┘
          ↓
      Tracking
          ↓
      Analytics
          │
          ↓
         Cady
          │
          └──────► Personalized Career Intelligence
```

The goal is to progressively turn CareerOS into a unified career platform rather than a collection of independent features.

---

# 18. Current Development Status

| Area                  | Status          |
| --------------------- | --------------- |
| Project definition    | Planned         |
| Repository setup      | Local foundation implemented |
| README                | Initial version |
| Development plan      | Initial version |
| Architecture          | Implemented decisions recorded in ADR-001 through ADR-011 |
| Frontend              | Auth, profiles, resumes, jobs, saved jobs, career sources, and in-app notifications implemented |
| Node.js platform      | JWT/RBAC, profiles, resumes, jobs/ingestion, saved jobs, private career-source checks, and notifications implemented |
| Python intelligence   | Private PDF extraction, shared OpenAI layer, saved structured drafts and reviewed profile import implemented |
| Java workflows        | Not started     |
| Kafka                 | Future phase    |
| Community             | Planned         |
| Cady                  | Planned         |
| Production deployment | Future phase    |

This document should be updated continuously as implementation progresses and architectural decisions are made.

See [review and next implementation steps](implementation-next-steps.md) for the implementation sequence and completion criteria.

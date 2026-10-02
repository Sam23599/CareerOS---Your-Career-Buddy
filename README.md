# CareerOS — Your Career Buddy

> **A personal career operating system for discovering opportunities, preparing intelligently, tracking applications, and connecting with other job seekers.**

**CareerOS** is a full-stack, AI-powered job hunting and career development platform designed to bring the entire job-search journey into one place.

Instead of treating job search, resume optimization, interview preparation, application tracking, and professional networking as separate activities, CareerOS brings them together into a single platform.

At the center of the platform is **Cady**, the personalized AI career assistant.

Cady is designed to understand a user's profile, skills, experience, career goals, job preferences, applications, and preparation progress, and use that context to provide personalized recommendations throughout the career journey.

---

## Project notebook

Add observations, change requests, and future ideas to [project notes](docs/project-notes.md). Your raw notes, refined proposals, decisions, and review history stay in that one file.

## Run locally

The implemented foundation is React + TypeScript, Express + TypeScript, and MongoDB. The rest of this README describes the planned product.

```bash
npm run setup
docker compose up --build -d --wait
```

Open http://localhost:5173 to register or sign in. JWT sessions, protected pages, and configurable Google/GitHub OAuth are implemented. Career profiles are available at `/profile` after signing in; see the [profile API](docs/api/profiles.md). Private PDF resume uploads, versions, in-page previews, downloads, and active selection are available at `/resumes`; see the [resume API](docs/api/resumes.md). Public job search and details are available at `/jobs`; Remotive listings refresh automatically every four hours while the API runs. See [job ingestion commands](docs/api/jobs.md). Save jobs and manage private notes, priorities, and interest statuses at `/saved-jobs`. Manage job sources and career bookmarks at `/career-sources`, with complete Greenhouse checks, limited Google Careers checks and explicit bookmark tracking setup; read alerts and set preferences at `/notifications`. See [career sources](docs/api/career-sources.md), the [source integration plan](docs/architecture/career-source-integration.md), and [notifications](docs/api/notifications.md). The connection diagnostic is at `/status`. Docker must be running; `npm run setup` creates a local signing secret without replacing existing settings.

See [local development](docs/local-development.md) for host development, checks, ports, and persistence, and [ADR-001](docs/adr/001-local-platform-foundation.md) for the setup decisions. See [authentication and OAuth setup](docs/api/authentication.md) to configure Google/GitHub credentials.

---

## What is CareerOS?

CareerOS focuses on four major areas:

```text
Discover → Match → Prepare → Apply → Track → Improve
                     ↕
                  Connect
```

### 1. Discover

Find relevant opportunities from multiple sources:

* LinkedIn
* Naukri
* Indeed
* Wellfound
* Foundit
* Other major job platforms
* Remote-focused platforms
* Country-specific job platforms
* Custom company career pages
* Custom job sources

Users can define companies, locations, countries, technologies, roles, and other preferences to personalize their search.

---

### 2. Match

CareerOS analyzes the relationship between a user's profile and available jobs.

Features include:

* Resume/CV parsing
* ATS analysis
* Resume ↔ Job Description matching
* Skill extraction
* Matched and missing skills
* Skill-gap analysis
* Job relevance scoring
* Personalized job recommendations
* Profile improvement suggestions

The AI intelligence layer will eventually combine traditional NLP/ML techniques with LLM-based analysis, embeddings, RAG, and agentic workflows.

---

### 3. Prepare

CareerOS doesn't stop at finding a job.

It helps users prepare for it.

Examples:

* Personalized interview preparation
* Company-specific preparation
* Technical topic recommendations
* Coding problems
* System-design preparation
* Mini-project recommendations
* Short 1–5 day projects based on current technologies
* AI/Backend/System Design learning recommendations
* Skill-gap driven learning paths
* Preparation based on previously saved or applied jobs

Coding recommendations can also be influenced by the companies a user is targeting.

---

### 4. Apply & Track

The initial platform focuses on helping users **manage and track** their applications.

Users can:

* Save jobs
* Record applications
* Track application status
* Maintain application history
* Track interviews
* Manage preparation progress
* View application analytics

A future version may support automated job applications through browser automation where technically and legally appropriate.

---

### 5. Connect

CareerOS also acts as a career-focused community platform.

Users can:

* Create teams/groups
* Invite people using shareable links
* Discover available groups
* Request to join groups
* Manage members using RBAC
* Share jobs
* Share articles and blogs
* Share projects
* Discuss opportunities
* Exchange preparation resources
* Communicate within the platform

Future iterations can include real-time communication and voice capabilities.

---

# Cady — Your AI Career Assistant

**Cady** is the personalized AI assistant inside CareerOS.

The name comes from:

> **CA**reer + bu**DY**

Cady is intended to evolve beyond a traditional chatbot into an AI career agent capable of working with the user's career context.

Potential responsibilities include:

```text
User Profile
     ↓
Cady
     ├── Job Discovery
     ├── Job Matching
     ├── Resume Analysis
     ├── Skill Gap Analysis
     ├── Job Preparation
     ├── Project Recommendations
     ├── Coding Preparation
     ├── Application Insights
     └── Career Recommendations
```

The long-term goal is for Cady to become the intelligent layer connecting the different parts of CareerOS.

---

# Core Features

## Profile & Identity

Users can connect/import:

* LinkedIn profile
* CV/Resume
* Email
* Primary mobile number
* GitHub
* Coding profiles
* Portfolio websites
* Other professional profiles

Users can control which information is shared and used by the platform.

---

## Job Intelligence

* Multi-source job aggregation
* Job normalization
* Duplicate detection
* Job filtering
* Profile-based recommendations
* Resume ↔ JD matching
* ATS analysis
* Skill extraction
* Skill-gap analysis
* Company-specific recommendations

---

## Job Sources

CareerOS is designed around an extensible job-source architecture.

```text
                CareerOS
                   │
       ┌───────────┼───────────┐
       ↓           ↓           ↓
 Job Platforms  Companies   Custom Sources
       │           │           │
       ├─ Naukri   ├─ Career A ├─ Country X
       ├─ Indeed   ├─ Career B ├─ Remote
       ├─ Wellfound└─ Career C └─ Custom
       └─ Foundit
```

Each source can eventually have its own integration/adapter.

Users can also configure custom company career pages and allow CareerOS to periodically search them for relevant opportunities.

---

## AI-Powered Profile Improvement

CareerOS can analyze professional profiles and identify areas that could be improved from a recruiter/hiring perspective.

Potential sources:

* LinkedIn
* Naukri
* GitHub
* Coding platforms
* Portfolio
* Resume

The system can provide recommendations around:

* Skills
* Experience presentation
* Project visibility
* Keywords
* Profile completeness
* Role alignment
* Technical positioning

---

## Community & Teams

CareerOS supports collaborative career groups.

A team can contain:

* Members
* Admins
* Shared discussions
* Jobs
* Articles
* Projects
* Resources
* Preparation activities

Teams use role-based access control to manage permissions.

Example:

```text
Team
├── Owner
├── Admin
├── Member
└── Pending Members
```

Future versions can introduce:

* Real-time messaging
* WebSocket communication
* Voice calls
* Group discussions
* Shared preparation sessions

---

# Architecture Direction

CareerOS will progressively evolve into a **polyglot microservice and event-driven architecture**.

The project intentionally gives each backend technology a meaningful domain responsibility rather than using multiple languages only for demonstration purposes.

### Frontend

**React**

Responsible for:

* User interface
* Job discovery
* Profile management
* AI interactions
* Application dashboard
* Team/community experience
* Notifications
* Real-time experiences

### Node.js / MERN

**Core Platform & Integrations**

Responsible for:

* Authentication
* Users
* Profiles
* Connected accounts
* Job aggregation
* External integrations
* API gateway
* Notifications
* Frontend-facing APIs
* Community & Collaboration: team/group management, invitations, memberships, RBAC, discussions, shared resources, and real-time community interactions.

### Python / FastAPI

**Job Intelligence & AI**

Responsible for:

* Resume parsing
* Skill extraction
* Resume analysis
* Job ↔ profile matching
* Skill-gap analysis
* Job ranking
* Recommendations
* NLP/ML
* RAG
* LLM integrations
* AI agents

### Java / Spring Boot

**Application Management & Enterprise Workflows**

Responsible for:

* Job applications
* Application lifecycle
* Application state machine
* Application history
* Interview scheduling
* Application analytics
* Transactional workflows
* Event-driven workflows

---

# Technology Stack

### Frontend

* React
* JavaScript/TypeScript
* WebSockets

### Backend

* Node.js
* Express.js
* Python
* FastAPI
* Java
* Spring Boot

### Databases & Data

* MongoDB
* PostgreSQL
* Redis

### Messaging

* Apache Kafka

### AI / ML

* OpenAI APIs
* Gemini APIs
* LangChain
* LangGraph
* RAG
* NLP
* Machine Learning
* Embeddings / Vector Search

### Infrastructure

* Docker
* Docker Compose
* AWS
* CI/CD

Potential AWS components:

* ECS
* ECR
* S3
* IAM
* CloudWatch
* SNS
* Secrets Manager
* SSM

### Notifications

Potential providers:

* AWS SNS
* Firebase
* OneSignal

Supporting:

* Browser notifications
* Email notifications
* Mobile notifications

---

# Development Strategy

The project will **not start as a fully distributed system**.

It will be developed incrementally so that every stage remains usable while gradually introducing microservices, AI, messaging, and distributed-system concepts.

## Phase 1 — Core Platform & Integrations

**React + Node.js**

Build the foundation of CareerOS.

### Focus

* React frontend
* Node.js backend
* Authentication
* RBAC foundation
* User profiles
* Connected profiles
* Resume upload
* Job search
* Job aggregation
* Job normalization
* Job saving
* Custom company career sources
* Basic notifications

### Goal

Build a functional CareerOS platform capable of discovering and organizing jobs.

---

## Phase 2 — Job Intelligence & AI

**Python + FastAPI**

Introduce the intelligence layer.

### Focus

* Resume parsing
* Skill extraction
* ATS analysis
* JD parsing
* Resume ↔ JD matching
* Skill-gap analysis
* Job recommendations
* Profile improvement
* AI assistant — Cady
* RAG
* LLM integrations
* NLP/ML capabilities
* Personalized job preparation

### Goal

Turn CareerOS from a job aggregator into an **intelligent job-search platform**.

---

## Phase 3 — Application Management & Enterprise Workflows

**Java + Spring Boot**

Introduce the application management domain.

### Focus

* Application tracking
* Application lifecycle
* Status state machine
* Application history
* Interview management
* Scheduling
* Application analytics
* Transactional workflows
* Event-driven workflows

### Goal

Build a robust application-management system with enterprise-oriented backend patterns.

---

## Phase 4 — Event-Driven Architecture

Introduce **Apache Kafka** progressively.

Potential events:

```text
user.profile.updated
job.created
job.updated
resume.analyzed
job.match.calculated
application.created
application.status.changed
interview.scheduled
notification.created
```

Kafka will be introduced where asynchronous communication provides a real architectural benefit rather than replacing every REST request.

---

## Phase 5 — Community & Real-Time Platform

Expand the social/community layer.

### Focus

* Teams
* Invitations
* Join requests
* Team RBAC
* Discussions
* Shared resources
* Real-time messaging
* WebSockets
* Voice communication

---

## Phase 6 — Notifications & Automation

Expand basic notifications with scheduled source scans, matching-job alerts, interview reminders, and preparation follow-ups.

---

## Phase 7 — Production Infrastructure

Containerize and deploy the platform.

### Local

```text
Docker Compose
├── React
├── Node.js
├── FastAPI
├── Spring Boot
├── MongoDB
├── PostgreSQL
├── Redis
└── Kafka
```

### Production

Progressively introduce:

* AWS
* CI/CD
* Container orchestration
* Observability
* Metrics
* Logging
* Distributed tracing
* Scaling
* Secrets management

---

## Phase 8 — Advanced Cady

Extend Cady into a career agent for personalized preparation, discovery, and career planning, following the detailed development roadmap.

---

# Repository Structure

The repository will initially follow a **frontend/backend separation**, with each backend technology maintaining its own services.

```text
career-os/
│
├── frontend/
│   └── web/
│
├── backend/
│   │
│   ├── Platform & integrations (node)/
│   │   ├── api-gateway/
│   │   ├── user-service/
│   │   ├── job-service/
│   │   ├── community-service/
│   │   └── notification-service/
│   │
│   ├── Intelligence & AI (python)/
│   │   └── intelligence-service/
│   │
│   └── Applications & workflows (Java)/
│       ├── application-service/
│       └── interview-service/
│
├── infrastructure/
│   ├── docker/
│   ├── kafka/
│   ├── mongodb/
│   ├── postgres/
│   └── redis/
│
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── events/
│   └── adr/
│
├── docker-compose.yml
├── README.md
└── LICENSE
```

The exact service boundaries may evolve as development progresses.

---

# Architecture Decision Records

CareerOS will maintain **Architecture Decision Records (ADRs)** from the beginning.

ADRs will document important technical decisions such as:

* Why a particular database was selected
* Why a service boundary exists
* REST vs Kafka decisions
* Authentication strategy
* AI/LLM provider decisions
* RAG architecture
* Job-source integration strategy
* Caching strategy
* Deployment decisions
* Security decisions

Example:

```text
docs/
└── adr/
    ├── ADR-001-project-architecture.md
    ├── ADR-002-database-strategy.md
    ├── ADR-003-event-driven-architecture.md
    └── ADR-004-ai-intelligence-service.md
```

The ADR directory will act as the historical record of how and why CareerOS evolves.

---

# Guiding Principles

### Build incrementally

Do not introduce distributed-system complexity before it provides value.

### Clear service ownership

Each service should own its domain and data rather than creating tightly coupled services.

### AI with explainability

AI recommendations should provide useful reasoning and supporting information where possible.

### Integration-first design

External job platforms should be accessed through replaceable adapters rather than tightly coupling the platform to individual providers.

### Security by design

Authentication, RBAC, secrets management, data protection, rate limiting, and secure service communication will be considered throughout development.

### Portfolio-quality engineering

CareerOS is intended not only to solve a real problem but also to demonstrate production-oriented engineering across:

```text
Full Stack
   +
Microservices
   +
Cloud
   +
Event Driven Architecture
   +
AI / GenAI
   +
RAG
   +
Distributed Systems
   +
Security
   +
Observability
```

---

# Long-Term Vision

CareerOS aims to become more than a job board.

The long-term vision is:

> **A personal career operating system that continuously helps users discover opportunities, understand where they fit, prepare for them, manage their applications, improve their professional profile, and connect with a community pursuing similar goals.**

And at the center of that experience:

> **Cady — your AI career companion.**

---

## Project Status

**Status:** Phase 1 core features are implemented and verified locally: JWT authentication, career profiles/preferences, PDF resumes, job ingestion/search, saved jobs, career sources/bookmarks and in-app notifications. Interrupted session restoration and GitHub issuer validation are fixed; standalone component tests and live GitHub sign-in/logout/returning-account checks pass. Google verification is deferred. See the [release verification report](docs/phase-1-release-verification.md).

The architecture, service boundaries, technology choices, and feature set are expected to evolve as the project is implemented.

The [development plan](docs/development-plan.md) defines the roadmap. The [Phase 1 backlog](docs/phase-1-backlog.md) tracks the first release, and the [review and next steps](docs/implementation-next-steps.md) define the proposed implementation sequence.

The first release focuses on the core job workflow; community belongs to Phase 5. This README describes the product vision and planned architecture.

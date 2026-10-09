# CareerOS — Product vision and feature guide

Adapted from the detailed product narrative in the former root README at commit `02cfd2e`. This guide preserves the intended experience, feature examples and architecture direction for future reference.

**Scope:** This is the broader product vision. Many integrations, community capabilities, application workflows and AI extensions below are planned. The [main README](../README.md) is the entry point for setup and current availability; the [development plan](development-plan.md), [Phase 2 backlog](phase-2-backlog.md) and [intelligence expansion plan](intelligence-evolution-plan.md) determine the implementation sequence. This guide does not select new work or mark a phase complete.

[Product journey](#what-is-careeros) · [Cady](#cady--your-ai-career-assistant) · [Core features](#core-features) · [Architecture](#architecture-direction) · [Development strategy](#development-strategy) · [Long-term vision](#long-term-vision)

> **A personal career operating system for discovering opportunities, preparing intelligently, tracking applications, and connecting with other job seekers.**

**CareerOS** is a full-stack, AI-powered job hunting and career development platform designed to bring the entire job-search journey into one place.

Instead of treating job search, resume optimization, interview preparation, application tracking, and professional networking as separate activities, CareerOS brings them together into a single platform.

At the center of the platform is **Cady**, the personalized AI career assistant.

Cady is designed to understand a user's profile, skills, experience, career goals, job preferences, applications, and preparation progress, and use that context to provide personalized recommendations throughout the career journey.

---

## What is CareerOS?

CareerOS connects five major areas:

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

The planned community stage extends CareerOS into a career-focused collaboration platform.

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

## Cady — Your AI Career Assistant

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

## Core Features

### Profile & Identity

The connections and imports below describe the target experience. Current manual profile fields, resume imports and OAuth sign-in are documented in the [README](../README.md#current-features); OAuth sign-in does not imply importing an entire provider profile.

The intended profile experience can connect or import:

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

### Job Intelligence

Current matching measures explainable skill coverage and resume checks use CareerOS heuristics. Broader ATS analysis is an aspiration; CareerOS does not reproduce an employer's ATS or predict hiring probability.

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

### Job Sources

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

Users can configure supported company career sources for periodic checks. Broader company-page discovery requires additional adapters or future research tools; unsupported pages currently remain bookmarks. See the [source integration strategy](architecture/career-source-integration.md).

---

### AI-Powered Profile Improvement

The planned profile-improvement capabilities analyze professional profiles and identify areas that could be improved from a recruiter/hiring perspective.

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

### Community & Teams

CareerOS plans to support collaborative career groups.

A team can contain:

* Members
* Admins
* Shared discussions
* Jobs
* Articles
* Projects
* Resources
* Preparation activities

Teams will use role-based access control to manage permissions.

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

## Architecture Direction

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

## Technology Stack

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

### Messaging and background execution

* Celery + Redis for planned intelligence task execution
* Apache Kafka for later domain events

### AI / ML

OpenAI is the implemented provider. Additional providers, retrieval and agent frameworks are planned capabilities; their inclusion here is not a dependency-installation requirement. Shared intelligence serves multiple features, with Cady as one consumer.

* OpenAI APIs
* Gemini APIs
* Grok APIs
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

## Development Strategy

The project grows incrementally from a usable local platform into a distributed system where the product needs it.

It will be developed incrementally so that every stage remains usable while gradually introducing microservices, AI, messaging, and distributed-system concepts.

### Phase 1 — Core Platform & Integrations

**React + Node.js**

Build the foundation of CareerOS.

#### Focus

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

#### Goal

Build a functional CareerOS platform capable of discovering and organizing jobs.

---

### Phase 2 — Job Intelligence & AI

**Python + FastAPI**

Introduce the intelligence layer.

#### Focus

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

#### Goal

Turn CareerOS from a job aggregator into an **intelligent job-search platform**.

---

### Phase 3 — Application Management & Enterprise Workflows

**Java + Spring Boot**

Introduce the application management domain.

#### Focus

* Application tracking
* Application lifecycle
* Status state machine
* Application history
* Interview management
* Scheduling
* Application analytics
* Transactional workflows
* Event-driven workflows

#### Goal

Build a robust application-management system with enterprise-oriented backend patterns.

---

### Phase 4 — Event-Driven Architecture

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

### Phase 5 — Community & Real-Time Platform

Expand the social/community layer.

#### Focus

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

### Phase 6 — Notifications & Automation

Expand the existing scheduled source checks and in-app matching-job alerts with broader delivery channels, interview reminders and preparation follow-ups.

---

### Phase 7 — Production Infrastructure

Build on the existing local containers to deploy and operate the platform in production.

#### Local — future expanded stack

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

#### Production

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

### Phase 8 — Advanced Cady

Extend Cady into a career agent for personalized preparation, discovery, and career planning, following the detailed development roadmap.

---

## Repository Structure

The repository separates `frontend/web`, the Node platform in `backend/platform`, and Python intelligence in `backend/intelligence`. Java, event infrastructure and cloud modules will be added when their stages are implemented. See the [current repository layout](../README.md#repository-layout) and [service boundaries](architecture/service-boundaries.md); conceptual service responsibilities do not require a separate deployable service for every feature.

---

## Architecture Decision Records

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

See the [ADR index](adr/README.md) for the decisions already recorded.

The ADR directory acts as the historical record of how and why CareerOS evolves.

---

## Guiding Principles

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

## Long-Term Vision

CareerOS aims to become more than a job board.

The long-term vision is:

> **A personal career operating system that continuously helps users discover opportunities, understand where they fit, prepare for them, manage their applications, improve their professional profile, and connect with a community pursuing similar goals.**

And at the center of that experience:

> **Cady — your AI career companion.**

---

# Project Proposal

SWE5006 Designing Modern Software Systems – Practice Module Project

## 1. Project Title

JobPilot SG: Job Aggregation and AI-Assisted Application Platform (Singapore)

## 2. Project Sponsor

N/A (student-proposed project; no company sponsor).

## 3. Project Members and Primary Responsibilities

| Member | Primary Responsibility | Main Scope |
|---|---|---|
| TANG YUCHEN | Frontend / UX | React UI: login, job discovery/filtering, favorites, profile, dynamic application forms, confirmation panel. |
| LIAO BINGFENG | Backend Core / Database | FastAPI, auth/RBAC, PostgreSQL schema/migrations, job/profile/application APIs. |
| ZHU PENGXU | Job Ingestion Pipeline + LLM Job Extraction | Source adapters, scheduled/manual ingestion, normalization, deduplication, crawl-run state; LLM-assisted job extraction (prompts, schema validation, confidence tagging). |
| LIN XINDA | LLM Provider & AI Form Assistant | LLM provider abstraction (shared provider interface used by M3 job extraction and M4 form-assistant services), profile-to-form mapping, draft answers for semantic questions, confidence/fallback, form-mapping LLM contract tests. |
| LIAO CAN | DevSecOps / QA / Audit | GitHub Actions, Docker, SAST/dependency checks, audit events, E2E/demo environment. |

All members jointly participate in backlog refinement, design review, integration, testing, presentation and the final report.

## 4. Project Overview

Job seekers in Singapore must monitor many recruitment channels — InternSG, MyCareersFuture, LinkedIn, university portals and company career sites. Vacancies are time-sensitive, and application processes repeatedly request the same personal, education and experience data, causing information gaps, duplicated effort and missed deadlines.

JobPilot SG is a web-based platform that aggregates Singapore job postings — **InternSG as the primary source**, plus a sandbox source for stable demonstration — into one searchable repository. For selected demonstration jobs, an in-platform **AI Application Form Assistant (Phase 1)** maps the user's maintained profile and LLM draft answers onto a job-specific form schema; users review and confirm every value, and the final Submit remains a user action. The same engine may be extended to a **browser extension in Phase 2** (stretch goal). The LLM is a replaceable assistance component: deterministic parsing comes first, LLM output is schema-validated, confidence-aware and auditable, and personal data is handled under PDPA.

Benefits: (1) one searchable view of Singapore vacancies; (2) one profile mapped to many application forms — no repeated typing; (3) AI assists but never decides — human confirmation and graceful fallback; (4) every crawl, mapping and application is traceable.

## 5. General Architecture

Web-based **modular monolith** with an integrated AI-assisted application form — deliberately preferred over a browser-extension MVP so a five-person team can develop and demonstrate the full workflow in a controlled environment.

```
React + TypeScript UI (browse/filter/favorites/profile, application form + confirmation panel)
        │ REST/JSON over HTTPS
FastAPI Modular Monolith: Auth/RBAC · Job Query · Profile · Application Form/Assistant
                          · Ingestion Orchestrator · Source Adapters · LLM Services · Audit
        │
PostgreSQL (users / profiles / jobs / tags / form schemas / applications / crawl runs / audit)
        ▲
External: InternSG · sandbox/mock · approved public RSS/static sources
          LLM API (Qwen or DeepSeek, TBD) behind a provider interface
DevSecOps: GitHub Actions · pytest · Semgrep · pip-audit · Docker Compose
```

Ingestion flow: Source → Adapter fetch/parse → deterministic extraction → optional LLM extraction → schema validation → normalize/deduplicate → PostgreSQL → Job API → UI.
Application flow: Job + Form Schema + Profile → LLM mapping/draft answers → validation/confidence → user review/edit/confirm → confirmed values applied → user clicks Submit → application + audit record.

## 6. Scope of Work

### 6.1 In-Scope (Key Use Cases)

| ID | Use Case | Actor |
|---|---|---|
| UC01 | User registration & login (hashed passwords, expiring JWT, Job Seeker/Admin roles) | Seeker / Admin |
| UC02 | Browse & filter jobs (keyword, tag, city, job type, deadline, salary when available) | Seeker |
| UC03 | Job detail, external link & favorites | Seeker |
| UC04 | Profile & resume management (single pre-fill data source) | Seeker |
| UC05 | Scheduled/manual job ingestion from InternSG + sandbox source, with dedup & incremental update | System / Admin |
| UC06 | AI-assisted form filling on in-platform forms (Phase 1): mapping → human confirmation → fill | Seeker / System |
| UC07 | Application records & status tracking | Seeker / Admin |
| UC08 | Admin: source configuration, crawl runs, audit events | Admin |

### 6.2 Out of Scope (First Release)

- Scraping commercial recruitment platforms, login-wall/anti-bot bypass, or sources that disallow access; robots.txt/ToS always respected.
- Automatic submission to real third-party sites, unattended submission, silent overwriting of user values.
- Chrome extension as an MVP component (Phase 2 stretch goal only).
- Resume optimization/generation, model training, autonomous/multi-agent workflows.
- Mobile apps, multi-tenancy, billing, microservices, Kubernetes.

### 6.3 Demonstration of SWE5006 Course Capabilities

| Course Capability | How the Project Demonstrates It |
|---|---|
| Agile Practices | Product backlog, user stories, sprint planning/review/retrospective, burndown, fortnightly progress reports. |
| Analysis & Design | Use cases, domain model, sequence diagrams (ingestion, form mapping), module boundaries, API contracts, traceability. |
| Design Patterns | Strategy (LLM providers), Adapter (source types), Template Method (ingestion pipeline); others only if needed. |
| Well-structured Code & Testing | Modular services, typed contracts, migrations, unit/API/integration/LLM-contract/form-E2E tests. |
| DevSecOps | GitHub Actions: lint, tests, Semgrep SAST, dependency audit, Docker build; secrets kept outside the repo. |

## 7. Functional Requirements

| Module | Key Requirements |
|---|---|
| User Access & Profile | Email+password login, hashed passwords, expiring JWT, RBAC; maintainable profile and resume metadata; demonstrations use synthetic data. |
| Ingestion & Normalization | InternSG (primary) + sandbox/mock/RSS sources with configurable schedule; crawl-run state (found/new/updated/failed); deterministic rules for salary/deadline/location, LLM for semantic fields, typed schema validation; dedup hash + incremental update; timeouts/retries; low-confidence fields blank or flagged; failures never corrupt accepted data. |
| Job Discovery | Paginated job cards; keyword/tag/city/type/deadline/salary filters; detail page with source attribution and original URL; favorites. |
| AI Form Assistant (Phase 1) | Per-job form schema (label/type/required/options/validation); LLM mapping and draft answers with confidence flags; review/edit/approve before applying; only confirmed values applied; final Submit is a user action; manual fallback when LLM is unavailable. |
| Tracking & Audit | Application records with status and mapping version; audit events (actor/action/entity/timestamp/run id/provider-prompt version); admin views sources, runs, failures and audit. |

## 8. Technology Selection

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | React + TypeScript + Vite | Mature ecosystem, component-based, team-friendly. |
| Backend | Python + FastAPI | LLM/ingestion integration; typed; automatic OpenAPI docs. |
| Database | PostgreSQL + SQLAlchemy + Alembic | Relational, transactional, reproducible migrations. |
| Scheduling | APScheduler | In-process ingestion; no extra worker platform. |
| Ingestion | httpx + RSS/static parsing (Playwright only if justified) | Controlled fetch of InternSG/approved sources. |
| LLM | Provider interface + one live provider (Qwen/DeepSeek, TBD) + MockProvider | Replaceable; deterministic tests. |
| Validation | Pydantic / typed DTO contracts | Schema-validated LLM output and API payloads. |
| Auth | JWT + secure password hashing | Course-appropriate RBAC; no enterprise SSO. |
| Testing | pytest + Playwright E2E | Unit/API/integration/LLM-contract/form-E2E coverage. |
| DevSecOps & Container | GitHub Actions + Ruff/ESLint + Semgrep + pip/npm audit; Docker Compose | Automated quality gates; consistent environments. |

## 9. Non-Functional Requirements

| Dimension | Requirement |
|---|---|
| Performance | Normal operations ≤ 2s under demo load (excluding bounded LLM latency); indexes + pagination; size limits/timeouts/retries on external calls. |
| Reliability | Re-runs are idempotent (no duplicates); crawl-run state visible and replayable; LLM output schema-validated, low-confidence values blank or reviewed; source/LLM failure never corrupts accepted data. |
| Security & Privacy (PDPA) | Hashed passwords, expiring tokens, role checks; secrets in env/CI, never in repo or logs; PDPA: data minimization, redacted logs, fictional demo data, minimal context sent to LLM; allow-listed domains, robots/ToS respected, no anti-bot bypass; AI is never the final decision — user confirmation and user-controlled submission. |
| Usability | Clear flow: discover → inspect → save → apply → review AI suggestions → submit/track; form marks confirmed/unconfirmed/low-confidence/missing/edited values; errors give a safe next action. |
| Maintainability / Extensibility / Auditability | Clear service interfaces and boundaries; Strategy/Adapter/Template Method; CI runs lint/tests/SAST/dependency/Docker; versioned audit events reconstructable. |

## 10. Effort Estimates

~10 person-days per participant ≈ **50 person-days total**, in four integrated iterations so a runnable system exists continuously. Milestones: Proposal 28 Aug; Review 31 Aug; Conduct 1 Sep; Presentation 3–4 Nov; Report 10 Nov.

| Iteration | Duration | Activities | Deliverables | Person-days |
|---|---|---|---|---|
| 1 | 24 Aug–13 Sep | Proposal/backlog finalize; repo, DB/auth, CI skeleton, UI shell, form-schema model. | Approved proposal; login-enabled skeleton; CI; basic form page. | 10.5 |
| 2 | 14 Sep–11 Oct | InternSG + sandbox adapters, ingestion, schema-validated LLM extraction, dedup, job APIs, filterable UI. | Source-to-job E2E; job repository; filters/favorites; crawl evidence. | 22 |
| 3 | 12–25 Oct | Form-schema API, LLM profile-to-form mapping, draft answers, confirmation UI, user-controlled submission, tracking. | Confirmed in-platform application workflow; history; mapping-version audit; form E2E tests. | 10 |
| 4 | 26 Oct–10 Nov | Stabilize, security/dependency checks (PDPA, secrets, SAST), demo data, fixes, presentation, final report. | Release candidate; reliable demo; test/scan evidence; presentation + report. | 7.5 |

## 11. MVP Acceptance Criteria

- A user can register/login, maintain a synthetic profile, browse/filter jobs, save favorites and view application history.
- The system ingests from the agreed sources (InternSG + sandbox), produces normalized records, creates no duplicates on re-runs, and preserves valid data when a source/LLM fails.
- LLM outputs (extraction, mapping, drafts) are schema-validated; invalid output is rejected; low-confidence values require review or stay empty.
- For a selected job, the platform loads a dynamic form, shows AI suggestions, applies only confirmed values, and leaves Submit to the user.
- Crawl/mapping/application events are traceable via audit records with timestamps and version identifiers.
- CI runs lint/test/SAST/dependency/Docker for the release candidate; the E2E demo runs reproducibly from the Docker-based environment.

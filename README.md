# JobPilot SG

**Job Aggregation & AI-Assisted Application Platform (Singapore)**

Aggregates Singapore job/internship postings (InternSG as the primary source, plus a sandbox fixture source) into one searchable repository, and assists job seekers with an in-platform AI Application Form Assistant (Phase 1) — mapping a maintained user profile to job-specific application forms under human confirmation. The same engine may be extended to a browser extension in Phase 2 (stretch goal).

> Course: SWE5006 Designing Modern Software Systems – Practice Module Project (Aug–Nov 2026)
> Status: Proposal submitted (28 Aug 2026) · Project conduct from 1 Sep 2026

## Architecture

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

## Repository structure

```
├─ docs/          Architecture, API contract, ADRs, deliverables (proposal, dev doc)
├─ agile/         Product backlog, user stories, sprint plans/reviews/retros, burndown
├─ backend/       FastAPI modular monolith (Python 3.13)
├─ frontend/      React + TypeScript + Vite (Phase 1 UI shell)
├─ extension/     Chrome extension (Phase 2, placeholder)
├─ scripts/       Pipeline / validation scripts
└─ .github/       CI workflows, issue & PR templates
```

## Quick start

```bash
# 1. Infrastructure (PostgreSQL + Redis)
docker compose up -d db redis

# 2. Backend
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload

# 3. Health check
curl http://localhost:8000/health   # -> {"status":"ok"}
```

## Team

| Member | Primary Responsibility |
|---|---|
| TANG YUCHEN | Frontend / UX |
| LIAO BINGFENG | Backend Core / Database |
| ZHU PENGXU | Job Ingestion Pipeline + LLM Job Extraction |
| LIN XINDA | LLM Provider & AI Form Assistant |
| LIAO CAN | DevSecOps / QA / Audit |

## Collaboration rules

See [CONTRIBUTING.md](CONTRIBUTING.md) — GitHub Flow (feature branch + PR), Conventional Commits, 1 approve + CI green before merge, one issue per user story, sprint tags (`sprint-1` …).

## AI tool declaration

We used Hermes Agent to produce drafts based on our discussed idea, format paragraphs, improve expression, refine, and finalise our proposal, and Codex to review and validate the draft. We are responsible for the content and quality of the submitted work.

## Key documents

- Project Proposal (v2.1): [docs/deliverables](docs/deliverables/)
- Development Document (v0.2): [docs/deliverables](docs/deliverables/)
- API contract draft: [docs/api-contract.md](docs/api-contract.md)

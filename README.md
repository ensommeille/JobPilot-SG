# JobPilot SG

**Job Aggregation & AI-Assisted Application Platform (Singapore)**

Aggregates Singapore job/internship postings (InternSG as the primary source, plus a sandbox fixture source) into one searchable repository, and assists job seekers with profile reuse, evidence-backed job analysis and human-reviewed form filling. A Chrome extension supports controlled filling of the original InternSG form; final external submission remains with the user. Saving a JobPilot application record does not verify employer receipt.

> Course: SWE5006 Designing Modern Software Systems – Practice Module Project (Aug–Nov 2026)
> Status: Course project in progress. Historical proposal and development plans are preserved; see the [course closeout baseline](docs/deliverables/COURSE_CLOSEOUT_BASELINE.md) for the 15 October 2026 implementation snapshot and remaining verification.

## Architecture

```
React + TypeScript UI (jobs/recommendations/favorites/profile/application history)
        │ REST/JSON (localhost HTTP; external deployment needs HTTPS)
FastAPI Modular Monolith: Auth/RBAC · Job Query · Profile · Application Form/Assistant
                          · Ingestion Orchestrator · Source Adapters · LLM Services · Audit
        │
PostgreSQL (users / profiles / jobs / tags / form schemas / applications / crawl runs / audit)
        ▲
External: InternSG · local sandbox fixtures · optional Qwen/DeepSeek via provider interface
          Chrome extension assists with original-site filling under user review
DevSecOps: GitHub Actions · pytest · Semgrep · pip-audit · Docker Compose
```

## Repository structure

```
├─ docs/          Architecture, API contract, ADRs, deliverables (proposal, dev doc)
├─ agile/         Product backlog, user stories, sprint plans/reviews/retros, burndown
├─ backend/       FastAPI modular monolith (Python 3.13)
├─ frontend/      React + TypeScript + Vite web UI
├─ extension/     Chrome extension for controlled original-form assistance
├─ scripts/       Pipeline / validation scripts
└─ .github/       CI workflows, issue & PR templates
```

## Quick start

For a complete local Docker deployment (frontend, API, PostgreSQL and Redis),
copy the repository-root `.env.example` to `.env`, replace the two local secrets,
then run `docker compose up -d --build`. Open `http://localhost:5173`.
The root `.env` configures Compose; `backend/.env` configures a directly launched
Python backend. Do not mix the two. This Compose file binds published ports to
loopback and is not an internet-facing production configuration.

See [clean deployment acceptance](docs/member3/CLEAN_DEPLOYMENT_ACCEPTANCE.md)
for isolated-port testing, PostgreSQL verification and Chrome extension pairing.

For a real AWS course demonstration, see the [CloudFormation template and runbook](infra/aws/README.md)
and the [verified deployment status](docs/deployment/IAC_STATUS.md). This separate
single-host configuration provides HTTPS and private container database ports;
review its ongoing AWS cost and disposable-data lifecycle before deployment.

```bash
# 1. Infrastructure (PostgreSQL + Redis)
docker compose up -d db redis

# 2. Backend
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env                  # replace JWT_SECRET_KEY before shared deployment
alembic upgrade head
uvicorn app.main:app --reload

# 3. Optional: create a local administrator and repeatable demo data
export JOBPILOT_DEMO_ADMIN_PASSWORD='replace-with-a-local-password'
python -m app.demo_seed --admin-email admin@jobpilot.sg
unset JOBPILOT_DEMO_ADMIN_PASSWORD

# 4. Health check
curl http://localhost:8000/health   # -> {"status":"ok"}
```

The demo bootstrap is idempotent and does not print the password. See the
[Member 2 Chinese run report](docs/member2/BLOCK_5_LOCAL_DEMO_BOOTSTRAP_PROGRESS_REPORT_ZH.md)
for usage and safety notes.

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
- Course closeout: [baseline](docs/deliverables/COURSE_CLOSEOUT_BASELINE.md), [requirements trace](docs/deliverables/REQUIREMENTS_TRACE.md), [demo acceptance](docs/deliverables/DEMO_ACCEPTANCE.md), [process evidence](agile/PROCESS_EVIDENCE_INDEX.md)

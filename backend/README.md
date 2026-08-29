# Backend — FastAPI modular monolith

JobPilot SG backend (Python 3.13). Skeleton stage: health endpoint only; modules land per sprint.

## Run

```bash
docker compose up -d db redis          # from repo root
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload          # http://localhost:8000
```

## Test & lint

```bash
pytest                      # unit/API tests
ruff check .                # lint
```

## Planned modules (per development document v0.2)

Auth/RBAC · Job Query · Profile · Form Mapping (domain) · Assistant API & Persistence · Ingestion Orchestrator · Source Adapters (InternSG/sandbox) · LLM Extraction · Audit.

# Backend — FastAPI modular monolith

JobPilot SG backend (Python 3.13). The first backend foundation includes the relational schema,
Alembic migrations, authentication, expiring JWT access tokens, and reusable RBAC dependencies.

## Run

```bash
docker compose up -d db redis          # from repo root
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env              # replace JWT_SECRET_KEY before shared deployment
alembic upgrade head
uvicorn app.main:app --reload          # http://localhost:8000
```

The application reads configuration from environment variables or `backend/.env`. The checked-in
`.env.example` contains local PostgreSQL defaults but no usable JWT secret.

## Implemented endpoints

```text
POST /auth/register
POST /auth/login
GET  /users/me
GET  /jobs
GET  /jobs/{job_id}
GET  /tags
POST /jobs/{job_id}/favorite
DELETE /jobs/{job_id}/favorite
GET  /favorites
GET  /profile
PUT  /profile
POST /profile/resumes
GET  /profile/resumes
POST /jobs/{job_id}/applications
GET  /applications
GET  /applications/{application_id}
PATCH /applications/{application_id}
GET  /assistant/bootstrap
GET  /assistant/forms/{form_id}
POST /assistant/map-fields
POST /assistant/applications
GET  /assistant/mappings/{mapping_id}
GET  /health
GET  /sources              # administrator only
POST /sources              # administrator only
PATCH /sources/{id}        # administrator only, schedule/enablement
POST /sources/{id}/run     # administrator only, bounded manual crawl
GET  /runs                 # administrator only
GET  /audit-events         # administrator only, excludes audit metadata
```

Registration creates both the user account and its one-to-one empty profile in one transaction.
Passwords are stored as Argon2 hashes. Authorization checks always reload the user and role from the
database instead of trusting the role claim in the token.

## Database migrations

```bash
alembic upgrade head       # apply all migrations
alembic downgrade -1      # roll back one migration
alembic current            # show the installed revision
```

The initial migration creates the 13 planned domain tables for users, profiles, resume metadata,
job sources, job postings, tags, favorites, application forms, applications, mapping records, crawl
runs, and audit logs. SQLite is used only by the isolated test suite; PostgreSQL remains the runtime
database.

Job discovery is public so the team can demonstrate the repository before login. Favorites remain
user-owned and require a bearer token. `GET /jobs` accepts keyword, tag, city, type, salary, deadline,
page, and page-size parameters; multiple tag values are combined as an intersection.

Profile and resume routes store the structured pre-fill source and validated resume metadata. The
MVP does not store uploaded resume bytes. Application routes provide user-owned history and a
controlled lifecycle from draft through submitted, interviewing, offered, rejected, or withdrawn.

## Optional scheduled collection

Source creation accepts `schedule: "manual"` (or no schedule), `"daily"`, or a bounded
interval such as `"every 6h"` or `"every 2d"` (1 hour to 7 days). The default is manual.
Only supported live Greenhouse/Lever or InternSG sources may be scheduled. A source is due
only after its last completed crawl has aged by that interval; a running crawl is not
restarted. Each cycle processes at most three sources and five jobs per source by default.
An administrator can change an existing source with `PATCH /sources/{id}` using
`{"schedule":"every 6h"}`; `{"schedule":null}` returns it to manual-only mode.
Scheduled runs are recorded with `trigger=scheduled` and an audit entry whose actor is
`null` (system-initiated). This is a **single-worker** design; do not run multiple
scheduler instances against one database.

The worker is **off by default**. Preview due sources without network access:

```bash
python -m app.ingestion.scheduler_cli
```

To run one due cycle (this does access the configured external sites):

```bash
python -m app.ingestion.scheduler_cli --apply --max-sources 1 --max-jobs 5
```

With the normal Compose stack and migrations already running, opt in to a single
periodic worker using `docker compose --profile scheduler up -d scheduler`.
Stop it with `docker compose --profile scheduler stop scheduler`. The worker does
not run LLM extraction or submit any applications.

The `/assistant/map-fields` route delegates to Member 4's concrete profile-to-form mapping service.
It returns a partial `MappingDraft` even when no LLM key is configured: direct fields are mapped,
while unsupported or unavailable fields remain available for manual entry. Semantic answers are
drafts requiring human review. Confirmed assistant results are written atomically to the application
and form-mapping tables. See [the M4 design](../docs/member4/FORM_ASSISTANT_V1.md).

## Test & lint

```bash
pytest                      # unit/API tests
ruff check .                # lint
```

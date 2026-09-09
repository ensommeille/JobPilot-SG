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
GET  /health
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

## Test & lint

```bash
pytest                      # unit/API tests
ruff check .                # lint
```

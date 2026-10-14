# Clean deployment acceptance

Verified on 14 October 2026 from PR #28 commit `ad3f1ce`, plus the deployment fixes in this working tree. A fresh Docker build, a new PostgreSQL volume and actual HTTP requests passed the profile-to-recommendation-to-reuse API journey. This is deployment and API acceptance, not an installed Chrome extension or real-employer delivery result.

## Fixes

The frontend image previously compiled a fixed `http://localhost:8000` API address. The Dockerfile now accepts `VITE_API_BASE_URL` as a build argument, and Compose passes it before Vite compiles the app. Changing only a running Nginx container environment cannot change a previously compiled frontend; rebuild the frontend after changing this address.

Compose now supports explicit port, CORS, extension client ID and origin overrides while retaining its existing default port numbers. Published ports bind to `127.0.0.1` for local use. Both Docker build contexts exclude local environment files and generated artifacts. Frontend build dependencies were refreshed for `brace-expansion` 5.0.12 and `source-map-js` 1.2.2; the fresh Linux build reports zero npm vulnerabilities.

The backend startup shell now uses `exec uvicorn` after migration and bootstrap. This makes the server receive Docker's shutdown signal directly; the previous wrapper forced a timeout kill during `docker compose stop`. After rebuilding, Uvicorn ran as PID 1, logged a complete application shutdown and exited with code 0 instead of 137. The 19-case focused deployment and safety suite passed again after this change.

No database schema or public JSON contract was changed by these deployment fixes. Live model keys are not passed by this Compose configuration.

## Verified results

- Fresh PostgreSQL 16 applied all four migrations to `20261014_0004`; a repeated `alembic upgrade head` was a no-op.
- First demo bootstrap created two sandbox jobs, six tags and one application form. Repeating it, including after a full stack restart, created no duplicates.
- Eight actual HTTP acceptance groups passed: Nginx deep-link routing, compiled API address and CORS; health and fixture discovery; registration, login and saved profile; evidence-backed partial recommendation; PKCE single-use authorization and restricted extension credentials; application draft reuse after profile changes and explicit clears; logout and account isolation; zero application records.
- The same fictional account and saved profile survived stopping and restarting the whole isolated stack. The main acceptance database retained three jobs, one form, one explicitly synthetic extraction and zero applications.
- The complete backend suite in a fresh Linux Python 3.13 container passed 559 tests. One Docker CLI configuration test was skipped because that Python image has no Docker CLI; that test passed in the separate 19-case deployment and safety run on Windows.
- The final complete Windows backend run passed all 560 tests using a fresh short temporary directory. Both platforms emitted one existing Starlette `httpx` deprecation warning.
- Fresh Linux frontend dependency installation, TypeScript/Vite production build, ESLint and npm audit passed.

The recommendation fixture is deliberately labelled `ACCEPTANCE ONLY`. It contains source-backed synthetic text and exercises the live-result consumer branch without making a model call. Its provider metadata says that no model was called. This verifies routing and persistence, not extraction accuracy, recommendation quality on real jobs, or employer delivery. No employer submission or paid model request was made.

The first Windows suite attempts encountered an existing temporary-directory ACL problem and then Windows path-length limits for nested atomic-output tests. The final 560-test run passed after selecting a new, short test directory; no global ACL or long-path settings were changed. For repeat runs:

```powershell
python -m pytest -q --basetemp C:/Users/pengp/Documents/Codex/jp-test-NEWID
```

Choose a new suffix for each run; pytest manages only that named test directory.

## Repeat a local deployment

From a fresh checkout, copy the repository-root `.env.example` to `.env`. Replace the JWT and demo administrator password values. Keep model keys out of this file. Start with `docker compose -p jobpilot-local up -d --build`, then check `docker compose -p jobpilot-local logs backend` and `http://localhost:8000/health` before signing in at `http://localhost:5173`.

The default installed extension pairing is **`http://localhost:5173` to `http://localhost:8000`**. Register the installed extension ID through `EXTENSION_CLIENT_IDS`, then recreate the backend. The alternative fixed extension pairing, `http://127.0.0.1:5173` to `http://127.0.0.1:8001`, is for the existing local-development setup, not default Docker. Do not interchange these origins and ports.

The isolated ports used below are suitable for deployment and HTTP tests but are not in the installed extension's allowlist. Backend CORS or `EXTENSION_WEB_ORIGINS` alone does not authorize a new extension pairing. A custom pairing needs a coordinated, reviewed extension build; this acceptance did not change that trust boundary.

To avoid existing services, use a unique Compose project and these `.env` overrides:

```dotenv
JOBPILOT_DB_PORT=15432
JOBPILOT_REDIS_PORT=16379
JOBPILOT_API_PORT=18200
JOBPILOT_WEB_PORT=15173
VITE_API_BASE_URL=http://127.0.0.1:18200
CORS_ORIGINS=["http://127.0.0.1:15173","http://localhost:15173"]
EXTENSION_WEB_ORIGINS=["http://127.0.0.1:15173","http://localhost:15173"]
EXTENSION_CLIENT_IDS=["REPLACE_WITH_INSTALLED_EXTENSION_ID"]
```

Use a new project name so its PostgreSQL volume is new. Do not run cleanup or volume deletion against another project. The tracked helper `scripts/seed_acceptance_fixture.py` is optional and only for a fresh disposable PostgreSQL demo database. It refuses databases that already contain additional users, jobs, extraction runs or applications. It is never called by normal startup.

```powershell
docker compose -p YOUR_TEST_PROJECT cp scripts/seed_acceptance_fixture.py backend:/tmp/seed_acceptance_fixture.py
docker compose -p YOUR_TEST_PROJECT exec -T -e JOBPILOT_ACCEPTANCE_ONLY=fresh-disposable-database backend python /tmp/seed_acceptance_fixture.py
python scripts/verify_deployment_api.py --fixture-job-id PRINTED_FIXTURE_UUID --extension-client-id YOUR_EXTENSION_ID --allow-test-writes
```

The HTTP helper accepts only explicit localhost or `127.0.0.1` origins, refuses URL credentials, paths, query strings and fragments, and does not follow redirects with authorization headers. It creates fictional accounts and saves their generated credentials only under ignored `output/deployment-acceptance/test-credentials.json`; its report excludes passwords and tokens. Run it only against the disposable test database, not an existing user environment.

## Preserved acceptance environment

The source clone is `output/acceptance-clean-20261014-01`, with Compose project `jobpilot-acceptance-20261014`. Its services use frontend 15173, API 18200, PostgreSQL 15432 and Redis 16379. The test services are stopped; their source configuration, images and PostgreSQL volume are retained for further checks. A second database named `acceptance_fixture_probe` inside that same isolated PostgreSQL container verified the fresh-fixture helper's success path; the helper's refusal path was verified against the already-used acceptance database.

From the clone directory, restart with:

```powershell
docker compose -p jobpilot-acceptance-20261014 up -d
```

Stop only this project with `docker compose -p jobpilot-acceptance-20261014 stop`. Do not add `down -v` unless the isolated test data is no longer needed. Installed Chrome authorization, real InternSG field filling and manual CAPTCHA display remain a separate browser acceptance step; no real application should be submitted during that check.

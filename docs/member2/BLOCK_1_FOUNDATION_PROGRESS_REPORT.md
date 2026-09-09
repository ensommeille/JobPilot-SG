# JobPilot SG Backend Core and Database Progress Report 1

**Module:** SWE5006 Designing Modern Software Systems Practice Module  
**Contributor:** LIAO BINGFENG  
**Reporting date:** 12 September 2026  
**Work completed through:** 9 September 2026  
**Scope:** Block 1 Database Foundation and Authentication

## Status Summary

Block 1 is complete. The backend now has a migration-controlled relational model and a working
authentication path. A user can register, log in, receive an expiring access token, and retrieve
their own public account record. The code also supplies reusable role checks for later administrator
routes. Automated checks currently report 12 passing tests and no Ruff findings.

## Work Completed

| Area | Implementation | Result |
|---|---|---|
| Configuration | Added environment-backed database and JWT settings with a checked-in `.env.example` | Secrets remain outside source control and deployment values can change without code edits |
| Database access | Added a shared SQLAlchemy engine, session factory, declarative base, and request-scoped dependency | Later modules use one transaction and dependency pattern |
| Relational model | Added 13 tables covering users, profiles, resume metadata, sources, jobs, tags, favorites, forms, mappings, applications, crawl runs, and audit logs | The database model now supports every MVP module named in the proposal |
| Integrity controls | Added unique account, favorite, application, source record, deduplication, and form-version constraints plus a salary-range check | Common duplicates and invalid salary ranges are rejected by the database |
| Search preparation | Added indexes for job title, company, city, type, salary, posted date, deadline, and status | Sprint 2 job filtering has an indexed persistence layer |
| Schema migration | Added Alembic configuration and revision `20260909_0001` | A clean database can be upgraded and the complete change can be rolled back |
| Registration | Added `POST /auth/register` with email normalization, validation, Argon2 hashing, duplicate handling, and profile creation | Registration persists no plaintext password and creates the user's profile atomically |
| Login | Added `POST /auth/login` with uniform credential errors and an expiring signed JWT | Valid users receive a bearer token; invalid credentials return HTTP 401 |
| Current user | Added protected `GET /users/me` | The frontend can restore the authenticated user from a valid token |
| Authorization | Added reusable role dependencies for job seekers and administrators | Later source and audit routes can return HTTP 403 without duplicating authorization logic |

## Technical Decisions

- PostgreSQL remains the runtime database. SQLite is limited to isolated automated tests.
- Passwords use Argon2 through `pwdlib`. The JWT signing key is mandatory configuration and is not
  committed to the repository.
- Authorization reloads the account and current role from the database. A role claim in an older
  token cannot preserve permissions after an administrator changes or deactivates the account.
- Registration creates the one-to-one profile in the same transaction as the user. This removes a
  partial state in which an authenticated account has no profile record.
- UUID primary keys avoid exposing sequential account and application identifiers and allow fixture
  data to be generated independently by different team modules.
- The schema includes persistence boundaries required by Member 3 ingestion and Member 4 form
  mapping, while their domain logic remains outside Member 2 ownership.

## Verification Evidence

| Check | Result | Coverage |
|---|---|---|
| Ruff static checks | Passed with no findings | Application, migration, and test Python files |
| Pytest | 12 passed | Health, registration, duplicate email, input validation, login, protected current-user access, token expiry, RBAC, schema tables, and job indexes |
| Migration upgrade | Passed | Empty SQLite test database upgraded to revision `20260909_0001` and created 13 domain tables plus the Alembic version table |
| Migration rollback | Passed | Downgrade to base removed all domain tables |
| PostgreSQL SQL generation | Passed | Alembic compiled the full revision using the PostgreSQL dialect without opening a database connection |

Container and live PostgreSQL execution remain part of the repository CI and shared integration
environment. The current workstation does not provide a Docker executable, so this report does not
claim a local container run.

## Requirements Traceability

| Requirement | Evidence in this block | Status |
|---|---|---|
| UC01 user registration and login | Three implemented authentication endpoints, password hashing, expiry tests, and protected current-user lookup | Complete |
| Job Seeker and Admin roles | Persisted role enum and reusable role dependency with HTTP 403 test | Complete foundation |
| PostgreSQL schema and migrations | SQLAlchemy model plus Alembic revision for all planned MVP entities | Complete baseline |
| PDPA security controls | No password or JWT key is returned or committed; public response schemas exclude password hashes | Complete for authentication |
| Unit and API test evidence | Twelve repeatable automated tests | Complete for Block 1 |
| Job, profile, and application APIs | Their database entities and constraints exist; route implementation is assigned to Blocks 2 and 3 | In progress |

## Integration Notes

Member 3 can replace the JSON proof-of-concept repository with an adapter that maps normalized job
records into `JobSource`, `JobPosting`, `JobTag`, and `CrawlRun`. The database enforces both the
source and external identifier pair and the normalized deduplication hash. Member 4 can persist form
assistant output through `ApplicationForm`, `FormMappingRecord`, and `Application` without placing
LLM provider logic in the API layer.

## Next Work

Block 2 will implement job list and detail routes, combined filters, deterministic pagination, tag
listing, and user-owned favorites. Its tests will cover empty results, intersecting filters,
pagination boundaries, missing jobs, duplicate favorites, and cross-user ownership.

Block 3 will implement profile updates, resume metadata validation, application creation and status
changes, application history, and the persistence side of the assistant contract. The tests will
verify ownership isolation and valid status transitions.

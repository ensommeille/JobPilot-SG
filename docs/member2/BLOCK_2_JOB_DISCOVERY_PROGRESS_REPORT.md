# JobPilot SG Backend Core and Database Progress Report 2

**Module:** SWE5006 Designing Modern Software Systems Practice Module  
**Contributor:** LIAO BINGFENG  
**Work completed through:** 9 September 2026  
**Scope:** Block 2 Job Discovery and Favorites

## Status Summary

Block 2 is complete. The backend now exposes the job repository required by UC02 and UC03. Clients
can list and inspect available jobs, combine all proposal filters, retrieve normalized tags, and
manage authenticated favorites. The implementation keeps discovery public for the demonstration
flow while enforcing ownership on every favorite read and write. The full backend suite reports 19
passing tests and no Ruff findings.

## Endpoints Completed

| Endpoint | Access | Delivered behaviour |
|---|---|---|
| `GET /jobs` | Public | Deterministic pagination with total item and page counts |
| `GET /jobs/{job_id}` | Public | Job detail with source attribution and normalized tags |
| `GET /tags` | Public | Stable category and name ordering for filter controls |
| `POST /jobs/{job_id}/favorite` | Authenticated | Creates a user-owned favorite and returns the persisted job snapshot |
| `DELETE /jobs/{job_id}/favorite` | Authenticated | Idempotently removes only the current user's favorite |
| `GET /favorites` | Authenticated | Returns only the current user's favorites with pagination |

## Query Behaviour

The job list accepts keyword, repeated or comma-separated tags, city, job type, salary minimum,
salary maximum, deadline range, page, and page size. Keyword matching covers title, company, and
description without case sensitivity. Multiple tags use intersection semantics so every requested
tag must exist on the result.

Salary parameters select overlapping advertised ranges. A requested minimum compares with the
advertised maximum, and a requested maximum compares with the advertised minimum. Jobs without
salary data remain visible unless the user applies a salary filter. Invalid salary or deadline
ranges return HTTP 422 before a database query runs.

Only active and incomplete jobs appear in public discovery. Incomplete records remain visible so
the ingestion pipeline can preserve useful jobs with optional missing fields, while archived records
stay hidden. Results sort by posted date, creation time, and UUID to remain stable between pages.

## Security and Ownership

- Job and tag discovery require no personal data and remain public.
- Favorite routes resolve the current account from its bearer token and include `user_id` in every
  database condition.
- Repeating a favorite creation returns the original record instead of creating a duplicate.
- Deleting a favorite that the current user does not own has no effect on another user's data.
- Missing, archived, and unknown jobs return HTTP 404 through the same public lookup rule.

## Verification Evidence

| Check | Result | Coverage |
|---|---|---|
| Ruff static checks | Passed with no findings | All backend application, migration, and test files |
| Full Pytest suite | 19 passed | Twelve Block 1 checks plus seven job and favorite API checks |
| Combined filters | Passed | Keyword, city, type, salary overlap, two-tag intersection, and deadline range in one request |
| Pagination and visibility | Passed | Page totals, stable order, incomplete visibility, and archived exclusion |
| Detail contract | Passed | Source attribution, tags, missing UUID, and archived UUID |
| Favorite idempotency | Passed | Repeated create returns one database record and repeated delete remains safe |
| Ownership isolation | Passed | A second user cannot list or delete the first user's favorite |

## Requirements Traceability

| Requirement | Evidence in this block | Status |
|---|---|---|
| UC02 browse and filter jobs | Public paginated list with every proposal filter | Complete |
| UC03 job detail and external link | Detail response includes description, source, tags, and apply URL | Complete |
| UC03 favorites | Authenticated create, delete, and list operations | Complete |
| Performance under demo load | Query-side filtering, bounded page size, and planned search indexes from Block 1 | Baseline complete |
| Reliability | Deterministic order, explicit visibility states, and idempotent favorite operations | Complete for Block 2 |
| PDPA ownership boundary | Favorite records are always filtered by the authenticated user | Complete for Block 2 |

## Integration Notes

Member 3 can write normalized records into the existing job tables without changing the public API.
The response deliberately uses `source`, `tags`, and proposal field names, so Member 1 can build job
cards and filter controls against a stable contract. The API keeps incomplete jobs visible because
the agreed ingestion policy prefers an empty optional field over discarded valid data.

## Next Work

Block 3 will complete Member 2 scope with profile updates, resume metadata, application creation and
history, controlled application status transitions, and assistant mapping persistence. The next test
set will verify validation, per-user isolation, duplicate protection, and the rule that assistant
applications must include a confirmed mapping version.

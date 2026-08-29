# Product Backlog — JobPilot SG (baseline v0.1)

Priorities: **P0** = must have (MVP) · **P1** = should have · **P2** = stretch (post-MVP / Phase 2)

| ID | Story (As a … I want … so that …) | Use case | Priority | Suggested sprint |
|---|---|---|---|---|
| SB-01 | As a user, I want to register and log in with role-based access, so that my data is protected | UC01 | P0 | Sprint 1 |
| SB-02 | As a user, I want to maintain my profile and resume, so that application forms can be pre-filled | UC04 | P0 | Sprint 1 |
| SB-03 | As an admin, I want to configure job sources (InternSG + sandbox), so that ingestion targets are controlled | UC08 | P0 | Sprint 2 |
| SB-04 | As a system, I want to ingest jobs on schedule with dedup and incremental updates, so that the repository stays current without duplicates | UC05 | P0 | Sprint 2 |
| SB-05 | As a system, I want LLM-assisted extraction with schema validation and confidence tagging, so that job fields are normalised reliably | UC05 | P0 | Sprint 2–3 |
| SB-06 | As a job seeker, I want to browse and filter jobs by keyword/tag/city/type/salary/deadline, so that I can find suitable opportunities fast | UC02 | P0 | Sprint 2 |
| SB-07 | As a job seeker, I want job detail pages with source attribution and favorites, so that I can track interesting roles | UC03 | P0 | Sprint 2 |
| SB-08 | As a job seeker, I want the AI form assistant to map my profile to a job-specific form and draft answers, so that applying is faster | UC06 | P1 | Sprint 3 |
| SB-09 | As a job seeker, I want to review/confirm/edit every AI suggestion before values are applied and submit myself, so that AI never decides for me | UC06 | P1 | Sprint 3 |
| SB-10 | As a job seeker, I want application records and status tracking, so that I can manage my pipeline | UC07 | P1 | Sprint 3 |
| SB-11 | As an admin, I want crawl-run state, failure visibility and audit events, so that ingestion is diagnosable | UC08 | P1 | Sprint 3 |
| SB-12 | As a team, I want CI with lint/test/SAST/dependency/docker, so that quality gates are enforced | — | P0 | Sprint 1 |

## Stretch (P2, only after MVP is stable)

- Chrome extension reusing the form-mapping engine (Phase 2)
- MyCareersFuture or additional Singapore public source adapter
- Job deadline / new-match notifications
- Resume document parsing into profile fields
- Application funnel analytics

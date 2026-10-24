# Sprint 4 ingestion and admin acceptance repairs (2026-10-23)

This is technical evidence for the `fix/sprint4-ingestion-acceptance` branch, based on
`main` commit `7d1d6fe493d2a992ebcc13118f1c4fcd8271fabf`. It is not a signed
team Sprint Review, Retrospective, or a claim that every MVP DoD item is complete.

## Defect and fix

The Stripe Greenhouse board currently includes two different published posting IDs,
`8194287` and `8194291`, both titled “Data Analyst, Intern”. The former ATS hash
used source/title/company/city, so the two posts got the same hash. A batch import
then inserted both in a SQLAlchemy session with `autoflush=False` and failed on the
unique `dedup_hash` constraint at the final flush.

The ATS adapter now hashes provider, board token, and official posting ID. The
repository checks `(source_id, external_id)` first, never replaces a canonical ID
just because another row has the same hash, and flushes inserted/updated rows
within the existing transaction so later batch records see them. A recrawl can
migrate an unchanged legacy row to the new hash when that hash is unclaimed; an
already-claimed hash is preserved rather than causing a unique-index failure.

## Verification actually run

- Regression tests were observed failing before the fix, then passing after it.
- Backend: **1,006 passed**, branch coverage **91%** (rounded), above the 85% project gate;
  Ruff passed. A dependency emitted one Starlette deprecation warning.
- Frontend production build and ESLint passed; extension syntax check passed.
- Frontend and extension offline dependency audits each found 0 vulnerabilities
  at the high-severity gate using cached advisory data; a fresh CI scan remains
  to be confirmed. Updated backend, frontend, and opt-in scheduler
  Docker images built successfully; this is not a deployed service check.
- Extension Playwright: **230 passed, 0 skipped** in an isolated Chromium run
  with a temporary Vite frontend. This includes the two opt-in native-extension
  tests and four opt-in widget tests using jQuery 3.7.1, CountrySelect 2.1.0,
  and Froala 4.0.7 from their npm packages. These are isolated fictional forms,
  not a fresh installed-extension test on the live InternSG website.
- The separate loopback-only full application journey passed **10/10** checks:
  fictional account creation/profile, saved source-bound Stripe suggestion,
  negative recommendation cases, favorite, draft, sandbox assistant save and
  answer recall, responsive history, account isolation, and logout. The
  generated verification record now describes saved evidence accurately rather
  than referring to old pending PRs. New model calls and employer submissions
  were both **0**.
- A disposable four-service Docker project imported the public Stripe board with
  `--max-jobs 3`: **found 14 candidates, new 3, failed 0**. The database retained
  both same-title IDs with distinct hashes. A repeat run was **new 0, updated 0,
  failed 0**. After rebuilding the final code, recrawl migrated three old hashes
  (**new 0, updated 3, failed 0**); the next recrawl was again **0/0/0**.
- A fresh, read-only InternSG adapter check with `max_links=1`, `max_details=1`,
  a 15-second timeout and no retry returned **succeeded: 1 discovered, 1
  attempted, 1 parsed, 0 failures**. It obeyed the adapter's robots policy and
  did not write to a database. This is a point-in-time source check, not
  end-to-end ingestion or employer application acceptance.

No paid model call, personal resume, CAPTCHA action, or employer submission was
part of this verification. The Docker database was isolated from the existing
project database and is removed after testing.

## Source operations and optional scheduler

- Admin-only `GET /audit-events` returns key audit columns with pagination and
  does not return the free-form metadata JSON. A read-only `/admin` page shows
  configured sources, runs, and audit events; runs and audit events use 20 rows
  per page. API and
  browser tests verified that a job-seeker account cannot see this data.
- Existing sources can be enabled/disabled or assigned a bounded interval using
  admin-only `PATCH /sources/{id}`; the change itself is audited. The new
  single-worker scheduler supports `daily`, `every Nh`, or `every Nd` (1 hour to
  7 days), skips disabled/manual/running/not-yet-due sources, and records
  scheduled runs with a system actor. Invalid historical schedule text is
  skipped, not interpreted as permission to crawl.
- The Compose scheduler service is in an **opt-in profile** and was **not
  started** in this test. A CLI preview test confirmed that the default command
  performs no fetch. The Compose configuration validates, but real periodic
  collection in a running deployment has not been observed. It does not run
  LLM extraction or send applications.

## Remaining acceptance boundaries

- Backend test coverage was not below the gate before this fix (previously
  90.84%). The genuine test gap was the six opt-in browser checks, now run.
- The earlier live InternSG listing timed out; today's single-item adapter
  check succeeded, but live availability can vary. A full InternSG database
  import and installed-extension fill on a current original application page
  remain separate acceptance steps. Do not present saved-site fixtures as a
  live crawl or as employer submission.
- The original MVP DoD lists an admin view and scheduled collection. The new
  API/UI and opt-in worker implement these in code, but scheduled collection
  still needs a deployment run with an administrator-configured source before
  it can be signed off as operational. The proposal states
  **resume metadata** for MVP, while the development document uses broader
  resume wording; actual document-byte upload is not assumed to be required
  without a team scope decision.
- Team Sprint 4 Review/Retro, installed extension on a live site, final demo
  rehearsal, and backup videos still require explicit acceptance evidence.

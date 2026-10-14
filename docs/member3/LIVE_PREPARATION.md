# Bounded live job preparation

This operator workflow reuses the existing schema and adapters. It does not
promote accounts, create tables, change user profiles or submit applications.
It preserves the plain-text Job Description (not page navigation) in
job_postings.description, with source URL and raw hash. Source HTML formatting
is not preserved. LLM output is stored separately in job_extraction_runs.

## Run

Use the existing DATABASE_URL and an existing active administrator UUID.
Create or select an InternSG HTML source through the existing admin API.
Configure LLM_PROVIDER=deepseek and LLM_MODEL to the model available on the account.
Supply the key through LLM_API_KEY or the hidden terminal prompt, never a command
argument, repository file or browser.

From backend:

```powershell
python -m app.prepare_jobs --source-id SOURCE_UUID --actor-id ADMIN_UUID --limit 3 --allow-paid --prompt-key
```

Paid calls require --allow-paid. Default limit is 3, maximum 10. Only active jobs
successfully persisted from this collection are extracted. Unchanged inputs reuse
the same pipeline result. Changed JD or pipeline gets a new run. No mock fallback.
Authentication/rate-limit failures stop subsequent calls; other failures are reported.
Transport and validation retries are disabled: at most one generation request per
selected uncached job. A failed crawl does not call the model.

The CLI requires operator machine/database access; it is not a public user endpoint.
For existing admin extraction HTTP endpoints, set JOB_EXTRACTION_LIVE_ENABLED=true
in the server process together with LLM configuration. A key alone does not enable
paid calls. Legacy offline test mode remains the default when this flag is absent;
the new preparation command explicitly refuses that mode.

## Result and limits

Prints crawl ID/status and per-job ID, JD length, extraction ID/status, reuse and
safe error code. needs_review means structurally valid model output, not verified
truth. Every claim retains a JD evidence quote. Matching checks quote presence and
input freshness. All downstream recommendations remain preliminary.

No fabricated result is inserted on network/model failure. A successful crawl can
remain useful if inference fails: rerun to reuse stored jobs and retry extraction.
The original JD is never replaced by model output. No model secrets enter pipeline
snapshots, audit records or reports.

## Tests

Isolated tests use HTTP transport fixtures (no paid CI calls) to verify the real
DeepSeek adapter, JD persistence, live result metadata, cache reuse, changed-JD
invalidation, crawl/provider failures, bounded inputs and admin preflight.
Live acceptance is reported separately from those deterministic tests.

## 2026-10-14 initial checkpoint (superseded by acceptance below)

Read-only live InternSG collection succeeded for three jobs, with JD lengths
1062, 2889 and 847 characters. The website required bounded timeout retries.
One freshly collected Intern (Human Capital) JD was sent to DeepSeek.
The first request returned finish_reason=length at 4000 output tokens; it was
recorded as a failure, not accepted as extracted facts. Extraction-only runtime
now explicitly disables thinking, preserving shared provider default behavior.
A second request on the same saved real JD returned needs_review with 19 claims
and 19 verbatim-evidence matches. This is evidence coverage, not semantic accuracy.

No new schema/migration was needed. Existing local demo DB has no administrator,
so live insertion has not run there: the operator command fails closed rather
than elevating an existing account. The valid real result is saved in the ignored
local output/live-extraction-smoke.json, with the failed attempt archived separately.
Creating an authorized local operator or selecting an existing admin is still needed
to complete live database acceptance. No key was saved in these artifacts.

Full backend suite: 362 passed before the thinking-option correction; after that
correction, all 26 preparation/provider tests passed, as did Ruff checks/format.

## 2026-10-14 bounded local acceptance

The user approved one independent local administrator, backup and data insertion,
at most ten jobs / ten new generation requests, and local delivery only. No schema
change, existing-account promotion, GitHub push or employer submission was authorized
or performed. Windows sandbox loopback initially blocked asyncio startup; stopped
attempts had made no crawl or model request. Execution proceeded after network access.

The completed run collected and persisted ten real InternSG jobs. Each has its
complete parsed plain-text JD and source URL. All ten real DeepSeek requests returned
`needs_review`, with no fallback, validation retries or transport retries. Across
these runs, 189 of 189 claim quotes matched their JD; usage recorded 13,880 input and
7,803 output tokens. This is not a cost estimate or a semantic-accuracy score.
The ten-request authorization is now exhausted; do not rerun this batch with a real
provider without fresh authorization. The CLI limit is per invocation, not a global
budget ledger, and failed extractions can consume new requests on a later invocation.

Local locations (relative to the repository):

- Database: `output/browser-smoke-rxfai8bl/test.sqlite`.
- Pre-change backup: `output/browser-smoke-rxfai8bl/before-live-20261014-180941.sqlite`.
- Crawl run: `04b4245f-2ccb-45d5-98f0-a3c305436d04`.
- Source: `77fadacd-5aa9-43aa-8187-20e5390a78e5` (`InternSG live`).
- Local operator: `2e0098db-0b95-43cb-8e28-d3d4cad06d6f`.
- Verification evidence: `output/live-acceptance.json` (ignored local artifact).
- Read-only acceptance script: `output/verify_live_acceptance.py`.
- Existing-DB server launcher: `output/serve_live_workspace.py` (no migrations).

The operator is `local-ingestion-operator@jobpilot.invalid`. A random password hash
was created, but its password was discarded: it is an operator identity for local
machine/DB commands, not a new shared login credential. Creation is audited. Direct
comparison against the backup verified unchanged schema, original users, all existing
profiles and all applications. One operator was added; no records were deleted.
Keys were supplied only via a hidden prompt, not stored in repository or artifacts.

The local API at `http://127.0.0.1:8001` serves these records. Each public job detail
was checked against the stored JD and source URL. The frontend at
`http://127.0.0.1:5173/jobs` was tested in a browser: ten real listings plus the
pre-existing clearly labelled demo, full JD, preliminary requirement analysis and
original-application entry point. No application was sent. The server launcher
does not enable paid background calls; viewing/analyzing/recommending uses stored
results and does not consume model tokens. It generates a fresh signing key on
restart, so an old browser session must sign in again.

### Historical v1 recommendation and quality limitations

The recommendation API evaluated nine real jobs, excluded one real job with no
explicit applicant requirements, and excluded the old mock demo. It returned
`no_matches`. All 41 extracted required/preferred skill labels are full phrases
or unsupported skill labels; none exactly matches the comparator's closed alias
vocabulary. **This batch cannot produce supported matches regardless of profile
contents.** This is a matcher/extractor compatibility limitation, not evidence of
applicant unsuitability. No profile was modified or fake match inserted to hide it.
The real-data pipeline and downstream reads are accepted; useful broad natural-
language recommendations are not accepted by this run. Next work should address
evidence-preserving skill normalization/partial overlap, with separate handling
of proficiency, alternatives and compound requirements and corresponding UI/tests.

The IT Software Engineering Intern JD contains nine duties but no explicit applicant
requirements. All nine duties are stored in its extraction; `no_requirements` in
the matching view is expected, not data loss.

Matching evidence text does not prove that the model classified its meaning correctly.
Spot review found two Staff Nurse skills classified as preferred without explicit
preference wording in their JD sentences. They remain unverified `needs_review` data;
the current comparator leaves them unknown. Preference/requirement classification
needs stronger evaluation before being relied on for ranking. No paid correction
was attempted after reaching the approved cap.

### Natural-language overlap follow-up (2026-10-14)

The v1 exact-label limitation above is superseded by the v2 comparator and
recommendation contract. Explicit named skills inside prose now produce partial
overlaps backed by both JD and saved profile evidence; they do not establish
proficiency or satisfaction of the full requirement. Model-assigned importance
and generic traits do not improve rank. Unsupported terms still remain unknown.

Eight read-only acceptance scenarios reused these ten real jobs without new model
calls. Excel, AutoCAD, Office and Canva profiles selected the expected related
roles; Python-only, general-only, negative and learning-only profiles did not
produce artificial recommendations. All synthetic profiles existed only in memory;
database SHA256, stored profiles and extraction counts were unchanged. The real
duties-only IT job and the old mock job remain excluded. See
RECOMMENDATIONS_CONTRACT.md and ignored output/natural-acceptance.json for scope
and evidence; this is not a measured real-world recommendation-accuracy result.

### Final regression evidence

- Backend full run: 364 passed, one filesystem hard-link test skipped in sandbox.
  That exact test passed separately outside sandbox: all 365 cases covered.
- Preparation tests: nine passed, including three-job 401 and 429 cases proving
  the remaining model calls stop and the failed run releases its lease.
- Browser suite: 65 passed, three optional real-widget-library tests skipped;
  those three passed separately using existing local widget assets: all 68 covered.
- Frontend production build and lint, extension syntax checks, targeted backend
  Ruff/format and `git diff --check` passed. One existing Starlette/httpx deprecation
  warning remains. Automated browser regression used intercepted data; the live
  database/API/browser acceptance above was checked separately.

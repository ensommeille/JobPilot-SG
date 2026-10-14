# Evidence-led recommendations v2

## Scope

POST /jobs/recommendations accepts the current platform JWT and a JSON object:
keyword (optional, at most 200 characters), city (120), job_type (80), limit
(integer 1–20, default 10). Unknown fields, including user_id and model, are rejected.
Keyword is a literal case-insensitive title/company substring. City and type are
case-insensitive exact values. These request-time preferences are not persisted.
The endpoint has no DB writes, new tables, model calls or external network calls.
It returns Cache-Control: no-store; restricted extension credentials are not accepted.

## Selection and ordering

Only active jobs whose known deadline has not passed in Singapore are candidates.
Unknown deadlines are allowed, not assumed open indefinitely. Scan the newest 500
by posted_at (null last), created_at and ID; truncated indicates a larger pool.
This is not a global best-match search. Fetch the latest extraction per job in one
window-function query; do not fall back to an older successful run.

Reuse the detail-analysis validator and comparator: current input hash and identity,
valid extraction schema, normalized source-quote presence and conservative skill
recognition. Both the run and result hashes must match the current input; source ID,
external ID and source URL must also agree. The latest run is chosen by started_at
descending, then extraction ID descending.
Missing, stale, failed, running, invalid, empty and mock extractions are excluded.
An extraction containing only a summary or duties has no applicant requirements
and is excluded as no_requirements. No extraction is automatically started.
Existing mock fixtures stay mock.

The saved profile needs at least one recognized, affirmative specific tool or
domain skill. Each recommended job must share at least one such skill with the
profile. That evidence can be an exact supported skill entry or a partial overlap
whose complete requirement remains unknown. General traits such as communication
or teamwork alone cannot satisfy either gate, even when the profile contains an
unrelated specific skill.

Sort lexicographically by absence of any explicit skill gap, number of distinct
specific skill IDs descending, then candidate recency/ID. Candidate recency means
posted_at descending (null last), created_at descending, then job ID ascending.
Deduplicate IDs across all supported and partial facts: aliases, repeated facts,
and repeated required/preferred labels do not inflate counts. General traits and
model-assigned required/preferred classifications do not affect ordering. Unknown
requirements are not gaps or negative ranking signals; their explicitly shared
specific skills can contribute to overlap count. This is a browsing heuristic,
not a suitability score or global best-match ranking.

## Response and interpretation

version: evidence-discovery-v2. status: ready, profile_needed, no_candidates,
no_evidence or no_matches. profile_needed means the saved profile has no recognized
affirmative specific skill; no_candidates means no jobs passed the candidate
filters; no_evidence means no candidate had usable non-mock requirements;
no_matches means usable requirements were evaluated but no job passed the specific
overlap gate. scanned is the bounded candidate count; evaluated counts jobs with
usable non-mock extracted requirements; matched counts all jobs passing the overlap
gate in that pool, before limit. excluded groups unavailable reasons. truncated
indicates that the candidate pool exceeded 500 jobs.

items contain job identity/title/company/city/type and supported/gaps/unknown lists
of the existing MatchItem shape. Each MatchItem adds skill_overlaps, a list of
objects with skill_id, label, kind (specific/general), and the original
profile_evidence string. The outcomes remain supported, gap and unknown.

Recommendation.overlaps is an additive list of unknown items with nonempty
skill_overlaps. Every item in overlaps also remains in unknown for compatibility;
these lists must not be added together to count requirements. supported contains
only exact atomic skill comparisons. gaps contains only explicit comparable
negative profile evidence. An unknown item can share a skill without establishing
the entire requirement. overlaps can include general traits once a job has passed
the specific-skill gate; those traits still do not count toward ranking.

## Evidence boundaries

A shared skill must be recognized in all three places: the extracted skill label,
its source quote, and an affirmative entry in the current user's saved skills.
The quote must occur at valid token boundaries in the current description after
Unicode/whitespace normalization, and its skill must be recognized in the full
source context, not just in a clipped quote. The source sentence is checked too: quoting only
"Python" from "No Python required" cannot create support or an overlap. An
invented skill label cannot borrow an unrelated valid quote. Source negation or
learning-only/uncertain wording suppresses overlaps. A negative or uncertain
profile entry vetoes that named skill across entries; contradictory affirmative
and negative entries do not establish support or a gap.

For example, "Comfortable using Excel or Google Sheets" with a profile entry
"I used Microsoft Excel to prepare weekly reports" can yield an Excel overlap.
The requirement remains unknown: the response does not establish Google Sheets,
the employer's alternative, or the requested proficiency. Basic AutoCAD wording
and compound Canva/Photoshop/Illustrator wording can likewise expose a shared
named tool while leaving conditions unverified. Natural profile descriptions
remain verbatim evidence, not rewritten claims of mastery.

The source extraction still needs human review. Quote presence is not proof of
semantic entailment. Recognition uses a bounded vocabulary of explicit tool,
technical and domain-skill names plus separately marked general traits; it is not
arbitrary semantic understanding. Aliases identify the same named skill, not
related or parent/child skills: Microsoft Office does not establish Excel, Excel
does not establish Microsoft Office, and Java is not JavaScript. Ordinary uses of
ambiguous words are filtered conservatively. Unknown terms can be missed.

Only extracted required/preferred skill facts produce skill overlaps. Education,
languages, experience and other qualifications remain manual; uploaded resume
files and other profile prose fields are not parsed. Proficiency, years,
eligibility and complete compound requirements are not inferred. Missing skills
are unknown, not deficiencies. Explicit negative entries can identify gaps, but
users should not add artificial negative entries. Unsupported skills can yield
profile_needed; that does not mean the user has no skills. No success-rate or
real-world recommendation-quality claim is made.

## UI and compatibility

For you is a separate section on /jobs, before unchanged general browsing.
Suggestions are requested explicitly, not automatically. Filter edits clear stale
results; account changes abort requests and clear private results. Failed requests
can be retried. Editing the saved profile requires requesting fresh suggestions.
Evidence expands inline and links to existing job details for analysis, favorites
and application decisions. No auto-submission or application workflow changes.
The UI distinguishes exact skill entries, partial shared mentions, explicit gaps,
and remaining unknowns. It renders partial items once despite their inclusion in
both overlaps and unknown. General traits are labeled and the ranking explanation
does not claim that extracted required/preferred labels are verified. Existing
/jobs behavior and match-analysis outcome values are preserved; match-analysis
adds the same skill_overlaps evidence under its v2 response version.

## Verification

Backend tests cover authentication, account isolation, no writes, input bounds,
exclusion reasons, literal filters, deadlines/status, refresh, ranking, deduplicated
aliases, latest-run selection, bounded candidates and fixed query count. The v2
test cases also cover natural profile text, alternatives, basic tools, compound
requirements, Office/Excel separation, clipped source conditions, unrelated quotes,
contradictory/learning-only profiles, duties-only extraction, general-trait gating,
and ordering independent of model-assigned importance.
Browser tests cover explicit requests, evidence/detail links, all empty states,
errors/retry, filter invalidation, signed-out behavior, account switches and mobile.
SQLite is exercised locally; deployment PostgreSQL and real-world relevance
evaluation remain separate acceptance work.

2026-10-14 v2 validation: 524 backend tests passed in the full sandbox run; the
one skipped filesystem hard-link safety test passed separately outside the
sandbox (525 cases covered). The complete browser run passed 70 tests; after the
storage-clear privacy regression was added, all 16 matching/recommendation tests
passed again (71 distinct browser cases covered). Frontend build/lint and backend
Ruff passed. The existing Starlette/httpx deprecation warning remains.
Formatting checks pass for all backend files changed in this refinement. A wider
repository formatting check still reports 12 pre-existing files outside this
refinement; they were not bulk-reformatted. This is not a claim that every global
formatting gate is green. The local service was restarted without migration or
paid-call flags, and OpenAPI confirms evidence-discovery-v2 / evidence-overlap-v2;
all eleven existing jobs and the frontend remain accessible.

Read-only saved-data acceptance used the ten real InternSG jobs and existing mock
demo with eight synthetic profiles held only in memory. The actual analysis and
recommendation functions selected Finance & Operations for Excel, ACMV AutoCAD
Drafter for AutoCAD, Intern (Human Capital) for Microsoft Office, and two marketing
roles for Canva. Every such result remained partial/unknown, not full support.
Python-only produced no_matches; general-only, negative Excel and learning-only
AutoCAD profiles produced no suggestions. The duties-only real job and mock job
were excluded. Database SHA256, extraction count and profile count stayed unchanged.
No paid or other network calls occurred. This acceptance exercises saved real JDs
and real business logic, not HTTP authentication or measured recommendation quality.
Evidence: ignored local output/natural-acceptance.json and its read-only runner
output/verify_natural_acceptance.py. HTTP/auth coverage is in the isolated API tests.

Historical v1 checkpoint, 2026-10-14: 356 backend tests passed (recommendation module
100% statement/branch coverage in this suite), 68 browser tests passed, followed by
8 recommendation browser tests after a placeholder contrast correction.
Frontend build/lint and backend Ruff passed. These are engineering checks,
not measured real-world recommendation accuracy.

That v1 local HTTP smoke reached the actual running service, rejected extension
tokens, and returned no_evidence with one mock_extraction excluded. The local
candidate pool at that checkpoint was a mock demo, so that smoke did not
demonstrate real recommendations. Positive/ranked results use isolated test
fixtures, explicitly not employer data or live-model validation. No user profile
was changed to manufacture matches.

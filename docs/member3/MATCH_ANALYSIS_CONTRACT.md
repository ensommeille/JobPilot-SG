# Offline job matching v2

## Opt-in project evidence — 2026-10-19

`POST /jobs/{job_id}/match-analysis` additionally accepts
`{"include_experience": true}`. The switch is a strict boolean, defaults to false,
and does not accept client-supplied experience, model settings or account IDs.
Legacy requests retain the v2 comparison and status behavior. Opt-in responses
use `evidence-overlap-v3` and add `responsibility_matches` independently of `items`.
The new collection defaults to empty for old requests.

Each row contains `responsibility`, `job_evidence`, `priority`, `condition`,
`outcome` (`related_evidence` or `unknown`), `reason`, `activities` (stable IDs),
and `profile_evidence` (original excerpts from the authenticated user's saved
`experience`). Duties never become satisfied applicant requirements, explicit
gaps or a match percentage. The existing skill and work-condition meanings stay
unchanged. A duties-only, non-mock extraction can now yield a preliminary
comparison when opted in; no comparable project evidence remains unknown.

The deterministic recognizer checks bounded activity/object patterns, not just
shared technology words. Source quotes and their surrounding context must agree
with the current JD. Plans, learning goals, uncertain/negative claims and bare
technology lists are not performed-project evidence. Unsupported wording stays
unknown. A related activity does not establish the full scope of a compound duty,
seniority, proficiency or eligibility. Conditional/secondary scope stays visible;
it cannot independently admit or improve a recommendation.

This reads existing profile text only: it does not parse uploaded PDFs, infer new
resume claims, call a model, write data or migrate the database. Existing latest-run,
freshness, authentication and no-store protections still apply. The UI explicitly
opts in and keeps project evidence separate from skill counts. Tests live in
`test_responsibility_matching.py`, `test_experience_matching_api.py` and the existing
matching/recommendation browser suites. The sections below describe the legacy
default path and historical checkpoints, not a claim of universal semantic matching.

## Typed extraction refinement — 2026-10-16

The starting branch for this change is `feat/course-closeout` at `e2fe853`.
That branch already contains the Chinese learning-goal guard (`想学 Python` /
`正在学 Python`) and the unique complete-line Canva evidence fix. These are
preserved existing features, not new fixes claimed by this change. The new
`tests/test_semantic_matching.py` verifies their use with typed v2 extraction.

Both stored `job-extraction-v1` and `job-extraction-v2` payloads are supported.
Historical v1 payloads are read conservatively without rewriting or relabelling
their schema. V2 uses typed requirement groups rather than treating every fact
as a skill. Only a `skill` condition with a recognized **specific** skill can
contribute an intersection. Language, trait, interest and qualification
conditions cannot contribute, even if their text contains a recognized skill.
A model labelling `Communication` as a skill still cannot make it a specific skill.

Each v2 group retains its original statement/evidence and its `group_operator`
(`all_of`, `any_of`, `unspecified`). Additive `conditions` contain `kind`,
`requirement`, `qualifier` and `qualifier_evidence` (text or null), `outcome`, `reason`, `job_evidence`,
`profile_evidence` and `skill_overlaps`. Each child is shown separately. A Python
intersection in `Python AND SQL` does not establish SQL; a Python intersection
in an OR group does not automatically verify the employer's proficiency or other
conditions. Compound groups remain `unknown`, including when every named skill
overlaps. A single unqualified `all_of` skill can retain the original narrowly
defined exact-entry `supported` or explicit `gap` result. Both the complete group
label and group quote/context must themselves be unqualified and atomic; a model
omitting SQL from its child list cannot make a Python-and-SQL group supported.
A qualifier remains
unverified; an unsupported group/atom/qualifier quote cannot contribute overlap.

Only identical standalone language claims with the same source quote, priority
and qualifier are shown once, including Mandarin/Mandarin Chinese/Putonghua and
English aliases. A language-typed duplicate takes precedence over a skill-typed
duplicate. Repeated languages inside distinct compound groups remain visible so
their AND/OR conditions are not silently removed. Differently qualified
written/spoken requirements are not collapsed. Canonical concrete skill IDs are
deduplicated for discovery ranking across all groups.

The detail response additionally returns `summary` (TextFact or null) and
`responsibilities` (value/evidence/priority/condition). V2 preserves primary,
secondary and conditional responsibilities; a conditional duty retains its
source-backed condition. A v1 duty receives `priority: unspecified` and
`condition: null`; historical data does not acquire invented priorities.

`work_constraints` is a **separate** list from applicant `items`. It always
contains five categories: `work_constraints.schedule`, `.hours`,
`.minimum_duration`, `.work_modes`, `.locations`. Every comparison outcome is
`unknown`: source facts about a job do not verify anyone's availability or
location. Known source values and conditional scope are displayed with evidence;
missing facts are explicitly “not stated”. Months are not converted to assumed
day counts. Missing legacy v1 fields stay unknown. These five rows neither
inflate requirement counts nor contribute rank, and no feasible/eligible
conclusion is returned. This is project feature acceptance, not any team
member's employment eligibility assessment.

A numeric/unit evidence guard distinguishes days per week from hours per week
and checks the duration's stated unit. An unsupported model number/unit is
displayed as “extracted number/unit requires review”, alongside the original
quote, rather than presenting the wrong hours as a sourced job fact. The raw
model result is not rewritten. An extracted location reference is explicitly
workplace-unverified: candidate eligibility wording does not establish an office
location or a person's location feasibility.
Work-mode allowance has a separate conservative wording guard: a contradiction,
missing conditional quote or wording outside simple explicit allow/prohibit
patterns is shown as “extracted allowance requires review”. Even when the simple
quote supports a direction, the model interpretation is not human-verified.

The historical acceptance numbers below describe earlier checkpoints. Validation
for this refinement must be reported separately after tests and environment
rebuild; adding this contract is not a deployment or model-accuracy claim.

## Delivered scope

POST /jobs/{job_id}/match-analysis accepts an empty JSON object and a platform
Bearer token. It reads only the authenticated user's existing profile and the
latest extraction for that job. It writes nothing, makes no model/network calls,
and creates no tables or profile records. The v2 response adds skill-overlap
evidence while preserving the supported/gap/unknown outcome values.
The restricted extension credential cannot access this endpoint.

Response: version (evidence-overlap-v2), job_id, status (preliminary/unavailable),
reason, extraction_id, warnings and items. Each item has category, requirement, importance
(required/preferred/unspecified), outcome (supported/gap/unknown), reason,
job_evidence, profile_evidence, profile_field and skill_overlaps. skill_overlaps
defaults to an empty list. Each overlap has skill_id, label, kind
(specific/general), and profile_evidence containing the original saved skill entry.
No overall score is returned.
Responses are no-store. Unknown payload fields (including user_id/model) return 422.
Unauthenticated: 401. Unknown or unavailable job: 404.

## Exact entries and partial overlap

The supported outcome retains the narrow comparison of known atomic technical/tool
labels with exact case-normalized profile entries or explicit aliases. The full
source context must also permit an unconditional comparison. Exact profile skill
presence supports the named skill entry, not proficiency or eligibility.
An explicit profile skill entry such as "No experience with Python" can identify a
gap. Absence from the profile remains unknown. Contradictory entries remain unknown.
Do not teach users to enter negative skills merely to obtain a gap result.

The broader mention recognizer can identify explicit named skills within natural
required/preferred skill wording and natural text saved in profile.skills.
An overlap requires the same canonical skill ID in the extracted label, its
source quote and an affirmative saved skill entry. Each shared skill is returned
once per item. An exact supported item may also carry skill_overlaps; otherwise
positive overlaps remain outcome unknown. There is no new partial outcome value.

For example, "Comfortable using Excel or Google Sheets" and "I used Microsoft
Excel to prepare weekly reports" can share Excel while the whole requirement
remains unknown. "Basic knowledge of AutoCAD" can share AutoCAD without proving
the requested level. A Canva/Photoshop/Illustrator requirement with Canva-only
profile evidence shares only Canva. Alternatives, compound skills, proficiency,
experience levels and other conditions still need manual comparison.

For historical v1 facts, kind specific denotes a recognized tool, technical or domain skill. kind general
denotes a broad trait such as communication or teamwork. Both may appear as
evidence in single-job analysis. The recommendation endpoint separately requires
at least one specific overlap and excludes general traits from ranking; see
[Recommendations contract](RECOMMENDATIONS_CONTRACT.md). The detail endpoint
itself does not rank jobs or require a specific-skill gate.

Recognition is deterministic and limited to a closed, inspectable vocabulary and
aliases; it does not understand arbitrary synonyms or infer related or parent/child
skills. Microsoft Office does not imply Excel or the reverse; Java is not
JavaScript; C is not C++. Ambiguous ordinary words require explicit skill context.
Unknown terminology can be missed. It does not infer proficiency from a mention.

For historical v1 payloads, only required_skills and preferred_skills receive skill overlaps. Education,
languages, experience and other qualifications remain unknown, not inferred from
prose or nationality. Summary and responsibilities do not become applicant
requirements. Other profile fields and uploaded resume files are not parsed.
There is no semantic model call, profile-wide qualification inference, eligibility
decision or application action.

## Source and profile safeguards

The current extraction schema has no human-approved state. Every valid comparison
is therefore prominently preliminary, not a certified match. Mock extraction is
explicitly labeled. Quotes must occur in the current JD after Unicode/whitespace
normalization; absent quotes cannot produce support or overlaps. Recognition must
also occur within the quoted text itself, so an invented label cannot borrow a
valid unrelated quote. Surrounding source sentences are checked to retain context
when a model supplies a shortened quote: "Python" inside "No Python required"
cannot yield a positive overlap, and omitting "advanced" does not establish an
unconditional supported skill. Ambiguous repeatedly occurring short quotes fail
closed. Quote presence alone does not prove semantic entailment.
Required/preferred labels are extracted classifications, not independently verified.

Negative, uncertain or learning-only source wording suppresses positive overlap.
Profile entries are assessed conservatively as whole entries: a negative or
uncertain entry vetoes its recognized skills across the profile, including when
another entry is affirmative. Learning goals alone do not establish a skill.
Contradictory natural affirmative and negative entries remain unknown rather than
becoming a gap. An isolated explicit negative entry can still produce a gap under
the atomic comparison rules. Original profile evidence is retained; for multiple
overlaps, the item-level profile_evidence joins distinct entries while each overlap
retains its own original entry. profile_field is skills when profile evidence is used.

The recognizer is bounded by the existing input contracts: at most 40,000 characters
per source text and 100 saved skill entries of at most 100 characters each. It
rejects oversized legacy inputs instead of truncating away potential contradictions.

Missing, malformed, failed, running or stale extraction produces unavailable, not
fabricated requirements. The current input hash and source identity must agree
with the stored result: both run and result input hashes, source ID, external ID
and source URL are checked. The latest run is authoritative, ordered by started_at
descending and then extraction ID descending: no silent fallback to an older
successful run after a failed/re-running extraction. Empty or duties-only extraction
returns no_requirements; it does not mean the employer has no requirements. No new
extraction is auto-triggered. The detail endpoint can display a mock result with
a warning; discovery excludes mock results.

## Frontend

The inline job-detail section starts only on an explicit click. It presents exact
skill entries, shared skill mentions with unverified conditions, explicit gaps,
and remaining unknowns with expandable paired evidence and a profile-edit link.
Partial items are displayed once while retaining outcome unknown in the API.
Shared skill labels identify general traits separately. Rerunning reads
the latest saved profile; the page explains that results are snapshots. Pending
requests are aborted on unmount or account changes; old-account results are discarded.
Empty/loading/network-error/unavailable states remain distinct. React renders
evidence as text rather than HTML.

## Verification and next boundary

Backend tests cover exact aliases, false substring matches, conflicting skills,
negative/alternative JD wording, account isolation, no writes, missing/invalid/stale
data and evidence mismatch. Added v2 cases cover natural profile evidence, compound
and alternative skill facts, clipped source conditions, unrelated valid quotes,
Office/Excel separation, duties-only facts, and negative/learning-only profile
contradictions. Browser tests cover explicit requests, source quotes, errors/retry,
unauthenticated behavior, account changes and desktop/mobile layout. Token-boundary
checks reject clipped Java/JavaScript evidence and full-context checks distinguish
the verb "excel" from the tool. Only a safe unqualified atomic source sentence can
retain supported/gap; other compound/proficiency wording remains unknown.

Final v2 validation on 2026-10-14: 525 backend cases covered (524 full-suite passes
and one sandbox-skipped hard-link case passed separately); 71 distinct browser
cases covered (70 full-suite passes, followed by 16 matching/recommendation passes
including the new storage-clear regression). Frontend build/lint and backend Ruff
passed. Eight read-only scenarios against saved real JDs passed without changing
profiles or consuming model tokens. See RECOMMENDATIONS_CONTRACT.md for exact
acceptance scope and local evidence artifact paths.

This endpoint supplies read-only single-job evidence comparison and shares its
validator with the recommendation endpoint. Real-world relevance and deployment
PostgreSQL acceptance remain separate work. A future semantic comparison/provider
call or saved matching history requires a separate scope decision. Existing
extraction preparation remains administrative.

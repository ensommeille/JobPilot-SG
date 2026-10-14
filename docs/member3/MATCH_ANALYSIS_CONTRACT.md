# Offline job matching v2

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

kind specific denotes a recognized tool, technical or domain skill. kind general
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

Only required_skills and preferred_skills receive skill overlaps. Education,
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

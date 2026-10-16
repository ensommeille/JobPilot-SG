# Recommendation feasibility check — 15 October 2026

Scope: local `feat/course-closeout` working tree. This is a deterministic
comparison check, not a measured success rate for finding suitable real jobs.
No model API, employer application, profile write, or database migration was used.

## Expected behavior and evidence

| Boundary | Observed check |
| --- | --- |
| Saved specific skill plus current JD requirement | Isolated API fixtures return evidence-backed recommendations and keep original JD/profile quotes. |
| Learning-only profile | A regression test exposed that `想学 Python` and `我正在学 Python` were incorrectly treated as affirmative. Simplified and traditional variants now produce no skill overlap or recommendation. |
| Missing skill versus explicit absence | Missing information remains `unknown`; an explicit negative can be a `gap`. Compound JD conditions remain `unknown` even when a named skill overlaps. |
| Unusable job or extraction | API tests exclude closed/deadline-expired jobs and missing, stale, failed or mock extraction runs. A duties-only extraction does not manufacture a skill requirement. |
| Ranking | API tests order by explicit gaps, distinct specific overlaps, then recency; synonyms and generic traits do not inflate rank. |

Before the Chinese-learning fix, the focused new regression cases failed in six
places: four skill-signal assertions and two API-level analysis assertions. After
that fix, the focused cases passed (17 passed). A subsequent real-JD check found
that a complete Canva bullet was merged with an unrelated “willing to learn” line.
One new regression failed before, then passed after the unique-complete-line
context fix; a duplicate/negative-line control also passed. The full backend
suite then passed (578 tests), as did targeted Ruff lint/format. The suite emits
one pre-existing Starlette/httpx deprecation warning.

## Current deployed-data limit

A read-only baseline snapshot of the running `jobpilot-installed-check-20261015`
PostgreSQL database found 5 InternSG acceptance-source jobs, 2 sandbox jobs,
and **zero** saved extraction runs. At that time, a saved specific skill could
only produce `no_evidence`; without one the API returned `profile_needed`.
One source-matched real JD was subsequently sent to a live model once and saved
as `needs_review` (run ID `4ec90a75-2d9a-46d3-b0e4-0667aade66dd`). Its 24
claims have 24 quote-presence matches, not human semantic approval. A Codex
first-pass comparison of the saved JD with the exact extraction run is in
`docs/deliverables/RECOMMENDATION_SOURCE_COMPARISON_20261015.md`; it identifies
lost role priority, over-broad `required_skills` classification, a duplicate
language condition, and missing work-arrangement structure. The earlier
checkbox packet is superseded and does not need user completion.
The historical natural-language acceptance noted in
`docs/member3/RECOMMENDATIONS_CONTRACT.md` used an earlier real-JD dataset; it is
not evidence that the present database contains comparable requirements.

The code changes have not been rebuilt into the running Docker containers or
pushed to the remote. A read-only local comparison using the new run and temporary
unsaved profiles found one **partial/unknown** Canva overlap, no Python overlap,
and no learning-only Canva overlap. The current container still runs the older
matcher, so this is not a deployed UI result. A quality assessment needs more
current JDs and human labels; one live result and fixture pass rates must not be
called recommendation accuracy.

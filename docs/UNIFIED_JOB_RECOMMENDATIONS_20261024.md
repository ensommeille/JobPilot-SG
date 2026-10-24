# Unified Jobs recommendations — 24 October 2026

This local update replaces the separate “For you”, manual AI selection and browse
sections with one Jobs flow. It supersedes the discovery instructions and v3
semantic-defect status in [the 23 October handoff](HANDOFF_20261023.md).

## User flow

1. Review and save the resume-derived skills, education and experience once in
   Profile. The profile's navigation link now says **View jobs**.
2. Open Jobs and click **Recommend to me**. The request is
   `POST /jobs/ai-recommendations` with `{"confirmed":true}`; the server automatically
   shortlists up to five current jobs from the saved profile. There is no second
   profile form or manual candidate selection.
3. Recommendations replace the browse results. Each card retains its job detail,
   original posting, save and preparation actions, with expandable evidence.
4. **Show all jobs** returns to the browse list, retaining its filters, sort and
   page during that view switch. This action does not call the model. Reloading a
   saved `?ai_run=...` link only reads that user's existing result.

Only an explicit recommendation click can start an analysis. An identical fresh
cache entry is reused. Late GET/POST responses cannot reopen recommendations after
the user has selected Show all jobs. Other users' saved runs remain inaccessible.

## Real-source verification

On 24 October, the existing four official ATS feeds were checked and refreshed:
BlockTech (3 vacancies), Cantina (2), StraitsX (2) and Graviton Campus (5).
These **12 vacancies** were still publicly listed at the observation time. One
separate SP Group internship programme overview remains clearly classified as a
programme, not a concrete advertised vacancy. The visible catalog therefore has
13 active entries. Two synthetic negative fixtures are closed and excluded;
disabled/mock/sandbox sources are also excluded from browse counts and pagination.

No new employer content or vacancies appeared in that refresh. The 12 internal
updates were deduplication-key migrations, not newly invented job data. Existing
job IDs and private user/profile/resume/application/email/AI records were retained.
The refresh itself did not run models, send mail or submit applications.

Public feeds used:

- <https://api.ashbyhq.com/posting-api/job-board/blocktech>
- <https://api.ashbyhq.com/posting-api/job-board/cantina>
- <https://boards-api.greenhouse.io/v1/boards/straitsx/jobs?content=true>
- <https://boards-api.greenhouse.io/v1/boards/globalcampus/jobs?content=true>

## Local acceptance

- Backend: **196 relevant tests passed**, with zero attempted external socket/DNS
  access under the offline harness. Ruff and diff whitespace checks passed. This
  is targeted regression, not a new full-suite or CI claim.
- Frontend: ESLint, TypeScript and the production build passed. The production
  bundle was checked to target the local API on port 18523.
- Browser: an ordinary account using its existing saved profile completed the
  real automatic five-job flow. Show all jobs restored `Singapore`, `Newest`, page
  2 and the exact same three visible titles. Repeating the request reused the same
  run; reloading its saved URL also caused no extra provider call.
- Desktop 1280px and mobile 390px layouts were checked without horizontal overflow.
  The Jobs view has one recommendation action; the old sections are absent.
- The revised browser regression specifications include the unified flow and
  late-response cases. Their syntax was checked; the Playwright suite was **not
  executed locally** because its test package was unavailable. Manual browser
  acceptance above is separate evidence.

The one explicitly authorized provider call completed in live mode with
`ai-recommendation-v4-role-recall-evidence`: 5,497 input tokens and 5,683 output
tokens. No second provider call was made for the repeat or saved-page reload.
Raw inputs/results and personal resume data remain outside the repository.

## Content review and remaining limits

All 51 displayed JD quotations and 12 profile quotations exist in their supplied
sources. The result contains 4 supported conditions, 47 unknown conditions and no
explicit gaps; 15 of those rows describe duties. Unknown is not a rejection or a
defect count. The earlier ML infrastructure-construction overclaim is unknown in
this result. The Graviton undergraduate-cohort timing discrepancy is visible and
lowers its priority, without inventing degree completion or ineligibility.

The ranking remains relative relevance advice. BlockTech has eight unknown
conditions and no fully supported condition, yet is first after the Graviton
timing adjustment; this is not proof it is the applicant's best actionable match.
Some preferred conditions are omitted, one compound date/duration row does not
contain its entire support in that single row's quotation, and the single-quote
contract can leave distributed Python/framework evidence unknown. Quotation
existence does not prove complete or correct interpretation. Do not claim all
qualifications, all applicant conditions or recommendation accuracy are accepted.

No deployment, PR merge, real-employer email or application submission was made.

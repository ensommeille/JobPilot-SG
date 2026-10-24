# Recommendation and application reuse — 24 October 2026

## Later application-page simplification

The current local frontend is `index-C3j_g8tt.js` / `index-BnQzWNQy.css`.
The runtime, model pipeline and installed extension are unchanged by this UI update.
Preparation now shows a short channel description, saved-profile summary, PDF
choice and one continuation action. Complete profile data, setup and longer
instructions remain available in collapsed sections. Same-name PDFs lead with
upload time and retain their full filename in the selected-file summary.

InternSG has one explicit **Load application form** action before any iframe or
Fill control exists. Loading replaces that action with the fill controls directly
above the original form; it does not fill or submit anything. The ordinary real
account loaded the real Front-end Development Intern form successfully. Actual
Chrome filling remains unverified; the agent's in-app browser correctly refuses
filling without a Chrome extension connection.

For ATS and manual external channels, one reviewed continuation saves a draft
record, or recognizes the endpoint's existing-record conflict, before opening the
employer page in the same tab. Save failure keeps the page and PDF selection for
an explicit retry. No snapshot or PDF-binding persistence is claimed. The real
SimplifyNext Greenhouse application page opened successfully; it contained an
application form, zero filled applicant inputs, and the local record remained
`draft`. Returning to JobPilot retained the PDF selection.

Frontend lint, TypeScript and production build passed. Updated browser test
specifications passed syntax checking, including draft-only navigation and failed
save recovery; the complete automated Playwright suite was not run. Desktop
1280×900 and mobile 390×844 were checked together, followed by one correction for
mobile same-name PDF selection and a confirmation pass. No model calls, employer
submissions, deployment changes or PR merges were made for this UI update.

The earlier v9 verification below is retained as its own checkpoint.

This local update continues from `main` commit
`dd085f81e604b23ca3b464d2510afbedfddd0fc2`. The complete pre-change working
tree, Git refs, private SQLite data and runtime artifacts were archived before
editing. No deployment or PR merge was performed.

## What changed

- One **Recommend to me** action replaces browse results; **Show all jobs**
  restores public search, filters, sorting and page, including after a detail
  visit. Only validated public browse parameters enter the URL.
- Four action states replace repetitive per-job review labels: prioritize,
  consider, check an eligibility condition, or lower priority. Ordinary missing
  skill evidence is not automatically an eligibility barrier. The first view
  shows at most two reasons; original-source evidence remains expandable.
- v9 checks actual assessments: a tool name or project title does not establish
  building, training, fine-tuning or a specific use of that tool. Compound AND
  requirements need complete evidence. Degree citations retain the entire
  original education line, including abbreviated degree titles and dates.
  Explicit zero-year/fresh-graduate routes do not become positive minimum-years
  barriers.
- Application channels appear before continuing. Supported InternSG,
  Greenhouse and Lever pages offer extension assistance; other employer pages
  clearly require manual completion. A channel hint is not proof of an active
  extension connection or a compatible form on every page.
- Preparation reuses the current user's saved profile and private original PDF.
  One available PDF is selected automatically; multiple PDFs require a choice.
  Same-name files show upload time and a short identifier. External file upload,
  employer questions, consent, CAPTCHA and final submission remain manual.
- Extension 0.8.3 supports the local `15523` platform / `18523` API pair. A
  read-only connection probe checks the exact environment, current account and
  expiry. Its minimal connection metadata contains no token, contact details,
  resume or form contents. The registered extension ID is process configuration,
  not a value committed to source or saved in a workspace seed.

## Real five-job verification

Run `de97a91b-de22-4438-87d8-144cbb313bb5` completed with
`execution_mode=live`, `is_current=true`, prompt
`ai-recommendation-v9-evidence-scope` and advice `action-advice-v3`. Input hash:
`583026371e64d229d46653cfa9a1bab5804c9629eb9e3d71a7336eccb0d48aea`.
It used the existing ordinary account's reviewed real-resume profile and five
real saved jobs; no contact details or PDF bytes entered the recommendation input.

- SimplifyNext Full Stack Developer and AI Engineer: **Worth considering**.
- Pensees AI Software Engineer Intern: confirm onsite work conditions.
- ShopBack Product Builder Intern: confirm the full-time six-month commitment.
- Cantina Machine Learning Intern: confirm intake timing and onsite commitment.

All 50 JD quotes and 40 profile quotes independently match their own original
source field. There are 14 supported requirements, 36 unknown and zero verified
gaps; none of these five jobs is labeled priority. This is not proof that every
model interpretation is correct. Some capabilities remain conservatively unknown.
The public `requires_review=true` remains an analysis-level limitation, not a
repeated action label that prevents useful advice.

Independent content review confirmed that the earlier training/fine-tuning/tool
usage overclaims were no longer supported, and education quotes were complete.
It found one misleading timing explanation: a yearless saved availability window
had been called a conflicting start date. The validator had already downgraded
the gap to unknown but appended a correction to the old assertion.

The free correction now replaces that unsupported explanation, including its
associated warning, with a clearly marked **Server evidence correction**.
Current list results, detail assessments and advice share the same conservative
copy. Two previously downgraded reasons are corrected; outcomes and quotes remain
unchanged. Original model audit files and stored run columns were hash-verified
unchanged. No model rerun was needed for this correction.

The first v9 attempt (`04b21e2d-9632-49e1-8c58-750b0ef36c27`) hit the original
12,000 output-token limit and remains failed with `incomplete_output`; partial
results are not shown. The bounded runtime is now 20,000 output tokens / 75
seconds, with zero automatic retries. The successful batch used 33,976 input and
11,792 output tokens. Budget changes produce a distinct input identity; failed
runs are not overwritten or silently retried.

## Validation and limits

- Complete backend regression before the final bounded fixes: **1,531 passed**,
  with external networking blocked and zero external attempts.
- Afterward: 71 recommendation/budget tests, 47 shared-contract tests, 19 local
  helper tests, and 179 conservative-correction tests passed offline. Counts
  overlap; they are not additional unique full-suite totals.
- Frontend lint, TypeScript, production build and design detector passed. Final
  bundle: `index-CzIJp61-.js` / `index-BzycZhHy.css`, API `127.0.0.1:18523`.
- Nine browser-state serialization and invalid-input assertions ran in Node.
  Browser test specifications were updated and syntax-checked. The complete
  automated Playwright suite was not run locally.
- Manual browser acceptance uses the ordinary real-resume account. Desktop
  1280×900 and mobile 390×844 layouts were inspected in a bounded pass.
- The existing Chrome extension folder was backed up and updated in place from
  0.8.0 to 0.8.3; all 12 runtime-file hashes matched. The user confirmed reload
  and connection. Server metadata confirmed the expected extension ID and the
  same real-resume account. The user also confirmed that explicitly loading the
  original InternSG page enables Fill. This proves connection and the load gate,
  not completed filling.
- The initially hidden load step was confusing in real Chrome acceptance. A
  **Load the original form first** link now sits beside disabled Fill and focuses
  the actual load button. The website is not loaded and answers are not sent by
  that link. The original form remains the single explicit load action.
- Real Chrome form filling remains a separate manual acceptance step until the
  user confirms the filled fields. The connected Chrome browser is unavailable
  to the agent's UI tools; fixture tests cannot replace this step.

The catalog remains 180 concrete vacancies (92 InternSG, 88 official ATS) plus
one separately classified programme overview. Application routes are 92 InternSG,
62 supported ATS, 26 manual external and one test-email programme. These are route
counts, not a claim that all external forms have been tested. No real employer
application or email was submitted. User-created local preparation records are
retained and are not treated as submission receipts.

See [machine-readable verification](handoff/verification-recommendation-application-20261024.json)
and the preceding [catalog/JD acceptance](LOCAL_JOB_DISCOVERY_ACCEPTANCE_20261024.md).
Raw model input/output, personal PDFs, account credentials and database backups
remain outside the repository.

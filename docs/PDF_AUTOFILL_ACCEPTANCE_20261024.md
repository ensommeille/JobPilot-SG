# PDF-first application autofill — local 0.9.0 acceptance

This checkpoint extends the local 0.8.4 application assistant. It does not deploy,
merge a PR, or submit an employer application. Earlier recommendation and
catalog checkpoints remain historical records.

## Result

- A saved PDF is explicitly read once for reusable application facts. Subsequent
  reads reuse the matching PDF hash and prompt version, including after restart.
- Autofill uses one owner-scoped snapshot combining saved Profile answers,
  additional answers and grounded PDF facts. Existing Profile answers take
  priority. The original Profile/recommendation input is preserved.
- The Profile page starts with PDF upload and reuse; the long Profile form is
  optional and collapsed. Missing details can be saved individually. Evidence
  and corrections are collapsed, with no per-answer confirmation checkboxes.
- Fill approves the current preview once, performs a free fingerprint check,
  and fills supported empty fields. Existing website answers are preserved.
  Successful fields leave the ready count; PDF attachment remains available.
- Ordinary selects, exact telephone calling-code choices, education degree
  taxonomy, month choices, async school/city choices, and supported date fields
  are handled. Async search must select one actual exact option and retain it
  after blur; search text alone is not a successful selection. Ambiguous choices
  are skipped, including a shared +1 calling code without an explicit country.
- Ashby hosted applications are now supported alongside InternSG, Greenhouse
  and Lever. This adds a form adapter to existing public job sources, not a new
  scraping source. Ashby formless application containers and anonymous date
  fields use their observed DOM; the site date display is MM/DD/YYYY.
- Unfamiliar ordinary questions may use a bounded model mapping to an existing
  fact key. It cannot generate a new applicant answer. Only question text and
  available key definitions are sent; private fact values and the PDF are not
  part of the mapping payload. Mapping failures are cached without auto-retry.
- Attach saved PDF is a separate explicit action. It releases only the currently
  selected owned PDF after checking its ID, hash, MIME, signature, size and exact
  target page. A unique CV field is required. This action can upload immediately;
  it reports file selection and asks the user to check the original site's
  upload status. It never claims employer receipt or application submission.

## Actual saved PDF and live-model evidence

The existing saved NUS PDF was used, without changing its bytes or source text.
Two actual model calls were made in this checkpoint:

1. PDF fact extraction returned ten facts. Strict validation rejected the whole
   raw output: an isolated location was treated as current residence, and the
   skills value recomposed four source lines into a new comma list.
2. A form-mapping call mapped an unfamiliar education-institution question to the
   existing school key. The identical second request reused the cached mapping.

The original failed extraction and private audit were retained. Independent
source review kept eight valid original facts, removed the residence inference,
and changed the skills value to the exact original block. All nine corrected
facts passed the same strict grounding helper and were saved in a separate
review record tied to the PDF hash. No paid extraction retry was made. Prompt
wording was clarified for skill blocks and isolated location headers; validation
was not relaxed.

The account now exposes 17 canonical reusable answers: 12 existing Profile
answers plus five PDF-backed additions (school, degree, discipline, education
start year and telephone calling code). Four other verified facts are covered
by existing Profile values. The UI says the PDF facts were reviewed. It does
not imply the first model output passed unattended acceptance.

The remaining 13 generic missing keys are optional until a form asks for them.
They include residence, full internship dates, expected stipend and work
arrangement. The PDF does not establish them. An availability range without a
year is not silently converted to a full date, project repository links are
not invented into a personal GitHub profile, and a current degree is not
assumed to be a completed qualification.

Declarations, consent, CAPTCHA, eligibility/visa answers, highest/completed
degree questions and employer-specific subjective questions remain personal
answers. Unsupported controls and ambiguous options are reported rather than
counted as filled.

## Verification and its limits

- 117 selected backend tests passed: facts/grounding/cache, owner isolation,
  explicit action validation, PDF byte access, extension authentication,
  migration preservation, application URL contracts and local model budgets.
- 42 Node tests passed, including actual serialized adapter DOM regressions for
  Greenhouse React selects, async readback, Ashby dates and explicit file
  attachment. These are offline DOM tests, not Chrome employer-page acceptance.
- TypeScript, frontend ESLint, production build, JavaScript/spec syntax, Ruff
  and diff checks passed. Built assets: `index-tlEHfKNY.js`,
  `index-D1EE5oiv.css` (140 modules).
- IAB verified the actual local Profile with the saved PDF, 17 ready answers,
  evidence/review indication and individual missing-detail editing, at desktop
  and 390px width. No horizontal overflow was found. A later final refresh hit
  a browser-control timeout; backend post-restart cache verification passed.
- Actual popup modules were exercised in an explicitly fictional local fixture:
  Read -> 8 ready -> Fill -> 0 ready/8 already filled -> independent Attach.
  All Chrome/API/ATS responses in this UI fixture were stubbed; no real employer
  received data. The operations log and screenshots identify it as a fixture.
- Public Greenhouse and Ashby form structure was inspected anonymously. No user
  PDF or applicant contact details were sent to those sites in this checkpoint.
- A full Playwright suite and actual Chrome 0.9.0 filling remain unverified.
  Earlier user-assisted Chrome checks were for the previous version. Do not
  claim all fields, all ATS sites or 100% coverage.

## Local handoff

- Web: `http://127.0.0.1:15523`; API: `http://127.0.0.1:18523`.
- Local SQLite migration: `20261024_0011`. Backup of the pre-migration database
  and installed 0.8.4 extension is in the task's archive directory recorded in
  `work/pdf-autofill-backup.json` outside this repository.
- Protected original columns in six tables (Profile, PDF metadata/bytes/text,
  applications, AI recommendation runs, extension grants) compare equal with
  the backup. Old PDF suggestion keys remain unchanged. Only the new autofill
  record/review and selection metadata were added. SQLite integrity is `ok`.
- The installed extension directory was updated in place to 0.9.0, retaining
  ID `jnhpbdlhnajnomkldhnpdojholeocnlo`. All 13 runtime files were hash-verified,
  manifest copied last, and permissions/CSP/connectable origins unchanged.
  Reload that extension and refresh the original form before the next test.
- A shared bounded live runtime remains available for explicit user actions.
  Credentials exist only in process memory. Its fresh runtime audit starts
  empty; the two completed calls remain in the separate private acceptance audit.
- No deployment changes, PR merge, application submission, employer email or
  real-employer PDF upload occurred.

For the short machine-readable result see
[verification-pdf-autofill-20261024.json](handoff/verification-pdf-autofill-20261024.json).

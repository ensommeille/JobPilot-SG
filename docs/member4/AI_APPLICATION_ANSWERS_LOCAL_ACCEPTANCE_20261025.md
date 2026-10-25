# Local application answer preparation — 25 October 2026

Local, uncommitted branch: `feat/ai-application-drafts`, based on
`9c0d3109a3990d8a023dc35ba083632c24a915cc`. This feature has not been pushed to
PR #55, merged, or deployed. No employer application, email or applicant file
upload was performed in this acceptance.

## Behavior

- Opening the connected extension automatically inspects a supported form and
  displays saved PDF/Profile facts. No normal Read/Generate step or per-answer
  checkbox is needed. One Fill approves the visible answers.
- InternSG, Greenhouse (including EU), Lever and Ashby share the preparation
  service. Unknown ordinary questions can map to existing facts. Supported
  introduction, experience, motivation and cover-letter questions receive editable
  source-based drafts. Arbitrary questions/websites are not covered.
- The platform preparation page prewarms common drafts. Continue and Fill remain
  usable while optional AI preparation runs. Saved answers are folded and drafts
  editable in the extension's bounded 440 px preview with a visible Fill footer.
- Late results cannot overwrite edits, cleared values, an earlier Fill, or another
  account/document/profile. Existing employer-page answers are preserved.
- Greenhouse's verified Cover Letter text entry opens only during Fill.
  Inspection does not click it or upload files. PDF attachment remains separate.
- Work eligibility, declarations, missing salary/date facts, CAPTCHA and final
  submission are not invented or automatically completed.

## Contract and limits

`POST /browser-assistant/prepare-answers` handles current form descriptors;
`POST /browser-assistant/prepare-answers/warm` handles common job drafts. Both load
the authenticated owner's sources on the server; clients cannot submit CV/JD facts.

The model selects existing fact keys and exact source IDs. The server constructs
short evidence-based excerpts rather than polished persuasive prose. Drafts do
not change Profile, verified PDF extraction, or canonical JDs.

The persistent cache binds owner, profile fingerprint, selected PDF hash,
application URL, JD/source hash and version. Verified question-to-fact mappings
can cross sources; job drafts cannot. Same-job warm/form concurrency makes one
provider request; two different jobs started together may each require a batch.

Backend preparation has an 8-second model limit; clients have an 8.2-second total
deadline. Saved answers do not wait. Polling/page returns use `cache_only`, which
cannot start provider work. Real failures are retained without automatic paid
retry; unavailable configuration does not poison a never-attempted context.

## Real model evidence

The ordinary account's existing selected, reviewed PDF and three real saved jobs
were used. Private audits/applicant text remain outside the checkout; no key was
saved. The initial version returned empty draft arrays for three calls:
Greenhouse 2,219 ms, InternSG 1,594 ms, Lever 1,844 ms. These were diagnostic
failures, not successful drafted-answer acceptance; cached reads were 15–31 ms.

The investigation fixed a single-line JD being discarded, an empty-array prompt
example with no explicit warm draft tasks, and project bullets split by PDF line
wraps. Exact contiguous activity excerpts now exclude titles/tool lists as proof
of work. `application-answers-v2-explicit-tasks` isolates old caches and rejects
omitted required draft tasks.

One additional paid call tested the corrected version with the real SimplifyNext
Full Stack Developer (Graduate) JD: `ready`, `live`, two saved answers plus one new
motivation draft, zero pending answers and six citations. Full preparation was
**2,047 ms**; the later form cache read was **31 ms**, with no provider call.
A new DB session reused the result without calling again. This is a measurement,
not a speed guarantee or proof that every employer question can be filled.

Final-version paid acceptance covers this Greenhouse context. Final-version
InternSG/Lever/Ashby coverage is regression coverage; actual installed Chrome
acceptance remains a separate follow-up.

## Verification and local state

- Preparation/API/cache/migration module: 53 tests passed. Final targeted
  preparation/helper/schema run: 61 passed.
- The broad backend run passed 1,683 tests and found one stale exact-table
  assertion that omitted the new cache table. That assertion was corrected and
  passed in the final 61-test run. The complete broad suite was not rerun after
  the assertion-only fix; later preparation changes are covered by that final
  targeted run. Do not describe this as an all-green CI run.
- Extension: 78 Node tests and syntax checks passed.
- Complete frontend ESLint, TypeScript and production build passed with
  `VITE_API_BASE_URL=http://127.0.0.1:18523`.
- Browser suite statically collected 287 cases; collection is not execution.
- CUA exercised actual popup modules with fictional Chrome/API/form fixtures:
  automatic preparation, one Fill, nine fields, zero submissions. Wide and compact
  layouts were inspected. This does not prove filling on real Chrome/employer DOM.
- UI mechanical checks and Ruff passed. Migration `20261025_0012` adds only
  `answer_preparations`; SQLite integrity is `ok`. Hashes of seven protected
  existing account/profile/PDF/application/grant/recommendation tables match backup.
- Installed extension updated in place to **0.10.0**, with 15 runtime file hashes
  verified and unchanged permissions, CSP, origins and extension ID.
- Local API restarted on `127.0.0.1:18523`; frontend remains
  `http://127.0.0.1:15523`. Hosted deployment and PR state were unchanged.

Reload JobPilot in Chrome's extensions page and refresh the local platform. The
API restart uses a fresh JWT secret, so web sign-in may be needed again. Reconnect
the extension only if expired. Open a supported original form, inspect its
automatically prepared preview, click Fill once, and stop before attachment or
submission.

Baseline source, DB and installed extension were archived in the task workspace's
`archives/JobPilot_before_ai_answers_20261025-111027` before edits.

## Follow-up: embedded InternSG route compatibility, 0.10.1

User acceptance exposed a real integration gap: the preparation page carries
`?resume=UUID`, while both extension parent-page checks rejected every query.
The extension now permits only no query or one exact `resume=UUID` parameter.
Unknown/duplicate/empty/encoded parameters, fragments and credentials remain
rejected; the full parent URL, account, Profile fingerprint and embedded document
must still match across inspection and Fill.

Actual serialized verifier regressions cover the normal selected-PDF route and
pre-credential rejection of invalid routes. The real bridge handler is exercised
with a stable selected-PDF route (Fill succeeds) and a changed selection (zero
writes). All 81 Node tests and syntax checks passed. Installed runtime files were
updated in place to 0.10.1 with hashes verified and permissions unchanged. The
previous 0.10.0 runtime was separately archived before replacement. No model call,
backend restart, deployment, PR change or employer write was needed for this fix.
Chrome reload and the user's real-form follow-up remain necessary.

## Follow-up: real Talent Acquisition Intern form, 0.10.2 / preparation v3

The user reported empty-looking previews and a disabled Fill with an uncertain
result at `https://job-boards.greenhouse.io/simplifynext/jobs/5174810007`.
Read-only CUA inspection confirmed that this is a different real form from the
Full Stack Developer case, including optional `preferred_name`, nameless inputs,
Phone/Country and an internship-period text question. No applicant data was
entered into the employer form during this investigation.

Three confirmed defects were fixed:

1. Saved answers were collapsed above unanswered fields, making a populated
   preview look empty. They now open by default. The action footer exposes an
   explicit Refresh recovery after a failed Fill, and clears stale progress text.
2. React-select expects its control's mousedown interaction; a bare input click
   did not reliably open real options. The reader now opens only the unique
   verified control, preserves existing selection and verifies the chosen value.
   A serialized mousedown-only regression covers the real phone dropdown shape.
3. Two real provider replies had valid IDs/references but motivation excerpts
   exceeded the final 900-character limit, rejecting their entire preparation
   batch. Version `application-answers-v3-whole-source-budget` validates every original
   reference first and then chooses complete selected passages within the 700
   source-character budget. It preserves at least one profile and one JD passage
   for motivation. Invalid references and oversized minimum pairs still fail.
   Both original raw replies pass offline replay without changing their audits.

The exact internship-period label now reuses saved availability. Preferred names,
unrecorded start/end months, graduation dates, current residence and declarations
are not invented.

The injection function now returns bounded structured preflight failures, and
the popup validates the bound Chrome document. A confirmed no-write rejection is
distinguished from a missing/uncertain response. There is no automatic retry.
The exact original cause of the user's whole-batch Fill failure is **not yet
confirmed**: the observed seven-field serialized chain passes offline, and no
actual installed Chrome success is claimed pending the user's 0.10.2 retry.

Verification: 86 Node tests, syntax checks, 90 targeted backend tests and Ruff
passed; UI detector returned no findings. Browser collection found 288 cases;
these were not executed as a real Chrome run. CUA confirmed visible saved facts
and error/refresh states in fictional API/Chrome fixtures. The saved recovery
screenshot was subsequently opened and confirmed to show the settled error state
and visible Refresh action. It is fixture evidence, not real Chrome acceptance.

One authorized new live preparation used the user's saved PDF and this exact
Talent Acquisition Intern JD: `ready`, `live`, one new motivation draft plus two
saved answers, five citations, zero pending warm answers; 2,797 ms followed by a
47 ms cache read without a second call. This proves answer preparation, not
employer-page filling. Private artifacts remain outside the checkout.

Installed 0.10.1 files were archived before updating the existing directory to
0.10.2; 15 runtime hashes and unchanged permissions were verified. The local API
was restarted with v3. The user's extension reconnection changed grant records
since the initial baseline; the other six protected tables still match that
baseline. No deployment, PR merge, employer submission or file upload occurred.

## Follow-up: confirmed preflight rejection and 0.10.3 diagnostics

The user's real Chrome retry of 0.10.2 still did not fill the form and returned
`invalid_review:fill_preflight`. This confirms rejection before any employer
field write. The exact differing field/property is not yet known; offline
seven-answer serialization checks do not establish that this real case is fixed.

Version 0.10.3 adds bounded stable field IDs and fixed mismatch categories to
that error. It retains the same validation and does not skip mismatched answers.
The popup shows its loaded version and missing text answers have explicit hints,
including `Your LinkedIn URL`. These are HTML placeholders with empty values;
they are excluded from the approved Fill payload, not invented personal URLs.
The next real Chrome run must identify the differing field or demonstrate that
filling persists. No additional model call is needed for this diagnostic step.

All 90 extension Node tests passed, including serialized field/property and
approval-shape rejection diagnostics, loaded saved-answer rendering and the
missing-LinkedIn placeholder's exclusion from the Fill payload. Syntax checks
passed. Installed 0.10.2 was archived before replacing the same extension's 15
runtime files with 0.10.3; hashes and unchanged permissions were verified. The
user was asked to reload and provide the new field-specific result. No new
employer write, model call, deployment or PR action was performed for this step.

## Follow-up: cover-letter null binding and editable links, 0.10.4

The next Chrome error identified `field:lflj1e/evidence_key`, the exact hash of
`gh:cover_letter_text`. The adapter now treats missing/null as the same unbound
fact classification. A serialized actual reader -> popup preparation/approval ->
transport omitting null -> reader Fill regression reproduces the prior error and
passes after the fix, for virtual and expanded cover-letter states. Differing
non-null classifications and changed controls still reject before any write.
Chromium's argument converter explicitly supports stripping null object members;
this supports the transport explanation, without claiming direct instrumentation
of the user's installed Chrome build. See [Chromium argument conversion](https://github.com/chromium/chromium/blob/main/extensions/renderer/bindings/argument_spec.cc).

Missing professional links became actual editable template values rather than
HTML placeholders, as explicitly requested. They are labelled unfinished, not
saved to Profile, and excluded from grounded-ready counts. All 93 Node tests and
syntax checks passed. The 0.10.4 runtime was installed with hashes/permissions
verified. Actual Chrome control was interrupted by its URL-verification guard;
no installed Chrome acceptance was claimed. The user's later Lever screenshot
does show name, email, phone and literal LinkedIn template text copied, while
location, company and the combined GitHub/Portfolio question remained blank.

## Follow-up: Lever ordinary text and Ashby container selection, 0.10.5

Read-only inspection of the exact public applications confirmed two additional
integration defects:

- ShopBack's visible location input is ordinary text, plus a hidden
  `selectedLocation` field. Its wrapping HTML label includes loading and geocoder
  errors, while the same row's unique `.application-label` is stable. The reader
  now uses that stable caption for a unique visible answer control, recognizes
  current company/location, and never writes the hidden location entity.
- BlockTech's Ashby page has two visible `.ashby-application-form-container`
  elements: the actual application and a separate resume parser. The prior global
  uniqueness check returned an empty scope. The reader now anchors to the unique
  name/email container. A maximum two-second read-only hydration wait ends in an
  explicit loading/recovery message rather than a falsely successful empty scan.

Ordinary available text questions now receive explicit editable template values
when no saved fact is available. Untouched templates for unknown/narrative
questions can still be replaced by an exact mapping or cited draft; existing
facts and user edits win. Known missing-fact templates do not trigger a model
request just to produce generic text. Declarations, unsupported choices and
missing numeric/date facts remain manual. Template generation is not AI evidence.

Copied text is distinguished from a website choice or format correction still
required. In particular, a literal URL template can be present while the site's
native URL validation remains invalid. It is not reported as a valid real link
or as proof that the complete application is ready to submit.

A read-only serving-audit check found six provider calls already present: five
application-answer preparations and one recommendation. InternSG, Greenhouse,
Lever and Ashby each had three valid common drafts; the extra Lever fact-mapping
batch had no reliable mapping for six ordinary questions. There was no timeout
or exhausted budget. No new paid call was made for this repair.

Verification: all 103 extension Node tests and syntax checks passed. This includes
the serialized two-container Ashby layout with 26 real controls, bounded hydration,
Lever's dynamic-label/hidden-location case, literal text copying, exact combined
link reuse, untouched-template AI replacement, user-edit protection, and optional
website-choice/format-correction result validation. The UI detector had no
findings. CUA exercised the production popup modules against clearly fictional
Chrome/API data at wide and compact sizes; one explicit Fill copied 13 answers
and correctly retained one website location choice. That fixture made no real API,
model, employer, upload or submission request. The actual public employer pages
were inspected read-only; no actual installed Chrome Fill success is claimed.

Installed 0.10.4 was archived before the existing directory was updated in place
to 0.10.5. All 15 runtime hashes matched, with unchanged ID, permissions, CSP and
allowed origins. Chrome reload and real-form user acceptance remain necessary.
Local API/frontend were not restarted for this repair; deployment and PR state
were unchanged.

## Follow-up: actual-question PDF answering, 0.10.6

The previous version was incomplete: templates made some inputs nonempty, but
known missing facts did not reach the model and a common-draft warm-up could
occupy the preparation context before the actual questions were known. This
revision sends the current supported unanswered questions, including missing
company/location and ordinary GPA/year text questions, with a separate bounded
view of the selected PDF's full text, contact header, links and section context.
Saved facts and user edits still win. Common-draft generation now requires an
explicit warm request; platform pages only make free cache reads. Actual form
requests neither request nor accept unsolicited common drafts.

The model chooses a disposition and exact supporting excerpts for each question;
the server assembles editable answers and validates their source membership and
scope. A literal location in the pre-section resume contact header can answer a
broad current-location question, while school/employer locations and telephone
codes cannot establish residence. The original failed live response had valid
contact-header location evidence; rejecting it for lacking the word "current"
was too restrictive. Semantic uncertainty now withholds that question alone.
Malformed output, altered/unissued citations, duplicate IDs and missing question
dispositions still reject the whole batch. The cache validation version changed
to `application-answers-v4-scoped-field-validation`, preserving old failed records.

Model-confirmed missing ordinary text becomes a real editable pending value,
including `Your LinkedIn URL` or `To be confirmed`; Fill copies it. A timeout,
unanalysed question or incomplete PDF coverage gets separately labelled
unfinished text, never a claim that the model proved absence. Native numeric/date
controls, declarations, consent and unsupported choices cannot take arbitrary
text. One batch is capped at 40 questions; overflow ordinary text explicitly
receives unanalysed pending values without another paid request. If Fill is
clicked early, it awaits this same batch within the approximately 8.2-second
overall budget, preserves edits and sends one fill operation.

Two paid calls were made during this investigation. The first returned grounded
evidence but failed the old contact-header scope validation; its raw audit and
failed cache were preserved. Free revalidation of that original response passed
after the scoped correction. A separate final real call then validated the new
actual-question-only request end to end, rather than counting that replay as a
fresh live success. It used the current selected original PDF and six real
ShopBack/Lever questions plus one explicitly identified generic project probe:

- `execution_mode=live`, `status=partial`, `error_code=null`, seven analysed fields.
- Three evidence-based editable answers: contact-header location, a real project
  repository for the broad GitHub/Portfolio question, and actual project activity
  for the separate probe. Four genuine missing items: company, LinkedIn, GPA and
  year of study. All seven had values; every positive citation matched its source.
- One call, 3,188 ms end to end; provider latency 2,036 ms. No common tasks or
  drafts were requested/returned. Cache and fresh-session durable reads made no
  further call. `partial` describes the four pending facts, not a failed call.
- All six protected user/profile/PDF/application/grant tables remained unchanged;
  no employer page write, attachment upload or application submission occurred.

Final verification: 139 targeted backend tests, 111 extension Node tests, Ruff,
JavaScript syntax checks, frontend ESLint, TypeScript and production build passed.
Browser-spec syntax checks passed; the full browser suite was not executed.
CUA exercised the production popup modules with explicitly fictional Chrome/API
data at wide and compact sizes: automatic preparation, real input values and one
Fill with 15 copied values plus one remaining website location choice. This is
fixture evidence, not installed Chrome employer-form acceptance.

The local API was restarted with v4, the frontend rebuilt, and the existing
installed extension directory updated to 0.10.6. All 15 runtime hashes matched,
with unchanged permissions, CSP, origins and extension identity. Both local web
and API health checks returned 200; protected tables still matched after restart.
Chrome must reload the extension and refresh the employer page. Actual installed
Chrome filling on the user's form remains the final user-assisted acceptance.
No deployment, PR publication/merge or real employer submission was performed.

## Follow-up: user-confirmed Lever and Ashby shared option groups, 0.10.7

The user reported that the exact ShopBack/Lever application works after the
0.10.6 update. Treat this as user-assisted real Chrome acceptance for that page,
not acceptance of every source. The supplied BlockTech/Ashby Chrome screenshot
still showed `ambiguous_fields:read_fields` before any answer preview or model
preparation could start.

Read-only inspection of the exact public, empty BlockTech application identified
the cause: three radio groups contain ten options with unique IDs but shared
group names. The reader's name-first keys generated repeated manual-answer IDs,
which the final uniqueness check correctly rejected. The four unlabelled
education-date selects were skipped and were not the immediate collision.

The fix only excludes Ashby same-name groups consisting entirely of one manual
input type (radio or checkbox) from writable answer records; their labels remain
listed as manual questions. It does not create positional write targets or select
an answer. Mixed radio/text names, duplicate ordinary controls, identity ambiguity
and every existing fill-preflight guard remain unchanged. An independent review
against the archived installed 0.10.6 found no unrelated adapter changes.

Verification: all 113 extension Node tests and syntax checks passed. The new
captured-control regression verifies six unique text answers, no radio/select
events and a forged group answer rejected before the first text write. A separate
offline jsdom replay used the complete captured public form HTML: the archived
0.10.6 reader reproduced the exact reported error; the fixed production reader
returned nine descriptors and copied six fictional values that persisted. The
literal LinkedIn template was correctly reported as needing native URL correction.
No radio/checkbox selection, file attachment, submission or network attempt
occurred. This replay uses a DOM library with mocked layout; it is not real Chrome
or React event-persistence acceptance. The new static browser fixture was added
and collected, but was not executed as a browser run.

The installed extension was archived at 0.10.6 and updated in place to 0.10.7;
all 15 runtime hashes matched and permissions/origins/identity stayed unchanged.
No model call, API restart, deployment or PR action was needed for this repair.
The remaining acceptance is the user's Chrome reload and retry on this exact
Ashby page. School/location searches, unlabelled education date dropdowns, personal
choices and submission remain website actions in this version.

## Follow-up: Ashby choices and automatic fit, 0.10.8

Ashby school/city searches now bind to the input's actual `aria-controls`
listbox. Search waits for async options, compares a unique exact primary school
name or city label, clicks that option, requires the menu to close, and verifies
the selected value twice after blur. A highlighted option or typed query alone
is insufficient. The observed school result includes country/domain text; only
its unique primary-name span supplies the school label. The saved name
`National University of Singapore (NUS)` can match the canonical full name only
through an exact initials check. Campus/country suffixes and inconsistent
acronyms are not discarded, and duplicate canonical candidates still reject.

The actual education group's anonymous selects now have stable semantic child
keys from the exact labelled start/end containers and month/year option meaning.
They are labelled Education start/end month/year for model context. Reordering
the controls never swaps dates; changed labels, duplicate groups or repeated
month/year controls fail preflight before other answers are written. Existing
values remain protected. The public page was inspected manually, including its
NUS and Singapore selections, to observe the component; no submission or upload
was performed. This is not acceptance of installed-extension automation.

Ordinary choice preparation uses the same single question batch and selected
PDF. A model may supply exact cited text plus a choice mapping to one existing
option, or a literal query for an empty searchable combobox. Visible option
meaning must match the source; an opaque value is not a country-name translation.
Generic degree levels can normalize equivalent spellings without converting
M.Tech. to a specific different master's degree or asserting graduation.
Education dates require the same reviewed school/degree entry and endpoint;
an ongoing course cannot supply an invented end date. Unknown typed choices and
protected personal declarations remain unset.

One new real paid call used the current original PDF, six actual Ashby controls
and one separately labelled native-degree probe. It returned in 3,985 ms with
`execution_mode=live`, `status=partial`, no top-level error. School and degree
were saved projections; the model selected the current NUS entry's start year,
correctly marked three absent date parts missing, and cited the correct contact
header for Singapore. That city's optional choice metadata was null, so v5
withheld it despite correct evidence. The original response and partial cache
were preserved.

Version `application-answers-v5.1-literal-query-preparation` accepts this narrow
case only for an empty searchable combobox with a single short complete literal
excerpt. It prepares the unchanged query and retains all source/scope checks;
it never chooses a closed-list option. The original live reply was revalidated
for free with a recorded-response provider: the fresh request payload and source
catalog exactly matched the original, external connections were blocked, and a
new v5.1 cache was created with original-response SHA/provenance. The city query
now passes, while the three genuinely missing dates remain unset. The original
audit/partial record and six protected user-data tables were unchanged. This was
not a second paid call or a fresh live generation.

Job detail now reads saved advice automatically, starts at most one analysis for
an eligible current context, and polls existing work without another paid start.
The authenticated free assessment endpoint supplies a canonical context hash
bound to current normalized profile, job, prompt and source revision. A session
coordinator survives StrictMode/remount/reload, preserves uncertain-start markers,
handles account changes and does not automatically retry failed work. Existing
results are reused. The result immediately shows high/partial/limited alignment
or insufficient evidence, supported/gap/unknown counts and short reasons; source
quotes are optional. No match percentage or hiring probability was invented.
Fit is placed directly below the job header, before application-channel help.

Verification: 183 answer/autofill backend tests, 53 action-advice/context tests,
all 131 extension/helper/coordinator Node tests, Ruff, JavaScript syntax, frontend
ESLint, TypeScript and production build passed. Full browser suites were not run.
Offline replay of the complete captured Ashby HTML filled twelve fictional
values, including both explicit search selections and four native date parts,
without radio/checkbox/file/submission/network actions. Layout and the search
component were simulated. React's observed empty select properties were restored
because outerHTML does not serialize them. This is not real Chrome acceptance.
CUA exercised the production job-detail build with an isolated fictional API on
desktop and a 390-pixel frame: two contexts caused two mock starts and seven free
reads across reloads, with zero real model calls. Both high and partial evidence
states were visible without Analyze/Check gates. A separate QA build/API was used;
no fictional jobs or users were added to the real local database.

The previous installed extension/served frontend were archived. The local API
was restarted with v5.1 and its context/choice schema verified; API and web health
checks returned 200 and protected tables still matched. The production frontend
targets port 18523; the installed extension is 0.10.8 with all 15 runtime hashes
verified and unchanged permissions, CSP, identity and origins. Chrome reload and
refresh on the actual form remain necessary. The current PDF has an explicit
start year but lacks start month and end dates, so those cannot be filled as known
facts. No deployment, PR publication/merge, real application submission or file
upload occurred.

## Follow-up: ordinary choices and relevant fit evidence, 0.10.9

The user's BlockTech screenshot was a real saved DeepSeek result, not a missing
model integration. Its whole-requirement assessments were uncertain, while
individual Python and computing-discipline conditions had positive evidence.
The old resolver discarded those positive condition checks and the presentation
reduced the result to zero whole rows supported. This was misleading about
relevance. Version `ai-recommendation-v10-partial-fit-evidence` preserves cited
condition checks and separate related project activity. A partial condition never
promotes an entire AND requirement. Python or a computing degree alone does not
establish data structures/algorithms, performance or production experience.

The primary job-detail view now shows the backend's application advice and at
most two reasons. It no longer computes a second fit label or displays the
supported/gap/unknown count strip. Quotes and individual conditions remain in
the optional evidence disclosure. Automatic saved-result reads and the existing
bounded analysis coordinator are retained.

One new paid live call used this ordinary user's current saved profile and the
exact active BlockTech software internship JD. Run
`48f1398a-3360-4c49-b0ae-0474a7d1ced8` succeeded with DeepSeek Flash and v10;
the free detail read reused it without another call. The headline is
"Relevant background, but a stretch application". Python, computing education
and actual project activities have exact source quotes. Rust/C++, DSA, cohort
status and the May 2027 full-time internship commitment are not established by
the saved evidence. These are unconfirmed conditions, not declarations that the
user lacks the abilities. The institutional-prestige wording remains conservative
and should not be treated as a separate requirement to prove an NUS ranking.
Independent review verified all 13 public quotes and the 19 raw source ranges;
no low-latency, algorithmic-trading or production claim was added. The original
13:35 run, PDF, profile, application and extension-grant records were preserved.

Ashby ordinary radio groups and its Still Student checkbox are now writable
choice descriptors with stable question identity, exact option binding and
post-fill readback. Current-student Yes requires the same ongoing education
entry and is processed before dependent dates; conflicting end-date answers are
rejected and existing dates are protected. School/city searches and anonymous
education dates retain their previous binding checks. M.Tech. may match a generic
master's level but cannot be converted into MSc; country codes cannot override a
contradictory visible option label.

Lever's ordinary internship-type choice is supported. The reviewed school name
can establish University without requiring a literal full-school-name match to
that category. Five genuinely personal preferences can be saved once using the
existing Profile facts form: internship commitment/type, full-time start year,
discovery source and its Other detail. They have no automatic default. School
dates cannot establish full-time availability; NUS enrollment cannot establish a
career-fair referral. Other text is enabled only for its actual Other parent.
Visa, consent, accuracy attestations and unsupported personal declarations remain
manual. Cache version `application-answers-v6-ordinary-education-choices` prevents
reuse of prior option mappings.

Verification includes 227 answer/profile/autofill backend cases, 250
recommendation/evidence backend cases and all 138 extension/helper Node cases,
plus Ruff, JavaScript syntax and the
frontend's ESLint, TypeScript and production build. Desktop and 390-pixel layout
checks rendered the actual saved v10 BlockTech payload through an isolated local
read-only API: no fictional assessment, model call or real user-record mutation
was used by that rendering check. This verifies the presentation, not an
authenticated installed-Chrome end-to-end flow. The full browser suite was not
executed.

The existing extension was archived and updated in place to 0.10.9 with all 15
runtime hashes verified and unchanged permissions/CSP/origins/identity. The local
API was restarted with v6/v10 and the production frontend still uses port 18523.
Health checks passed; the new result remains available through a free read and
all six protected user-data tables match the pre-restart snapshot. Actual Chrome
acceptance requires reloading the extension and refreshing the employer page.
No deployment, PR publication/merge, real application submission or file upload
was performed in this follow-up.

Final captured-public-HTML integration replay passed all four scenarios without
changing production code: Ashby copied 13 fictional values, including the three
explicitly supplied preference radios, school/city selections and current-student
state; its end-date fields remained empty and disabled. Conflicting student/end
date approvals were refused before writing; pre-existing dates were protected.
Lever copied seven fictional values, including saved commitment/type/discovery
choices and a University value with explicit fictional education evidence.
Visa, truthfulness and marketing controls were unchanged. This uses jsdom with
simulated layout, search and React-dependent student/date behavior and restored
observed native select properties. It made zero model/network/submission/DB
operations, and does not replace installed-Chrome acceptance on either employer
page.

## Follow-up: homepage guide and application recommendations, v11

The Jobs homepage now has a How to use button. Its four-step guide is collapsed
by default and stays in normal page flow, with a second-level extension
connection section, Close/Escape handling and responsive columns. The job detail
page no longer renders the large ApplicationChannelInfo help block. Existing
Prepare application, original-posting and application-record actions remain.

Current advice renders only Application recommendation, a verdict badge, a short
summary, Strengths and Things to consider (at most three points per group).
Requirement counts, quotations, unknown/supported rows and audit-language notes
are removed from the product view. Model/time metadata remains in a small About
this analysis disclosure. Legacy results do not acquire a client-invented verdict.

`ai-recommendation-v11-career-application-judgment` requires a new structured model
career_fit object for every job. It assesses direct/adjacent/low/undetermined
professional direction and proposes an application action independently of whole
requirement counts. Strengths reference actual validated conditions or project
activities. Job/profile focus phrases must be literal excerpts from their bound
source ranges; arbitrary model summaries cannot turn a degree into algorithms or
production expertise. Ordinary incomplete details become practical considerations;
explicit conflicting requirements and final priority caps remain server checks.
The public ActionAdvice v5 adds application_recommendation with verdict, summary,
strengths and considerations. Both batch and job-detail APIs use this projection.

One paid DeepSeek Flash batch used the existing user's current profile and three
active real JDs. Run `ba508dfd-4ab8-4ad0-a4aa-f72fd322640c` succeeded in live mode;
identical batch and free detail reads reused it. The accepted final decisions are
Talent Acquisition Intern: not_priority; BlockTech Software Engineer Internship:
consider; SimplifyNext AI Engineer Graduate: consider. Actual review found that
the initial AI Engineer priority included a REST API clause explicitly labelled
beneficial. The missing optional marker was fixed, so that clause no longer
counts as a required core basis. Important algorithms/data-structure and ML
fundamental preparation now precedes cloud/deployment extras. A free current
projection corrected the display without another provider call or any edit to
the stored model result or its original audit files. Six protected user tables
and all earlier runs were unchanged.

Verification: the full v11 AI suite passed 272 cases, then the final projection
changes passed 151 relevant cases. All 141 extension/frontend helper Node cases,
Ruff, frontend ESLint/TypeScript/production build and affected spec collection
passed. Full browser test suites were not run. CUA checked desktop and 390-pixel
layouts, guide opening/closing/keyboard focus, distinct real job decisions and
removal of repeated help through a separate read-only API serving the actual
saved three-job payload. It did not call a provider or submit a form. This is UI
rendering acceptance, not a new installed-Chrome filling acceptance.

The existing local API was restarted with v11 and the frontend targets API18523.
No extension update or new permissions were needed in this follow-up. No
deployment, PR publication/merge, employer submission or PDF upload occurred.

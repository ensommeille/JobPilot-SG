# Local extension acceptance — 24 October 2026

The local extension is now 0.8.4. No deployment, PR merge, paid model call,
employer submission or real application email was performed in this change.
Changes are in the existing working branch; this record does not claim merge readiness.

## Behavior

- Profile saves optional first/given and last/family names explicitly. The extension
  no longer splits a display name by word order. Missing parts remain blank.
- ATS per-answer confirmation boxes are removed. One explicit **Fill application
  form** approves the currently displayed, frozen answers. Changes to the saved
  profile invalidate that preview. Account, document, URL and occupied-field checks remain.
- The popup is 440px wide with a 580px maximum height. One preview/settings region
  scrolls; the current Fill action remains outside it. Names are side by side,
  duplicate source explanations are reduced, and reading brings the answers into view.
- Native single-selects explicitly labelled nationality or country of study can
  use the corresponding saved country, only with one exact option match. Ambiguous
  options, changed option meanings, existing answers and unsupported questions are
  not overwritten. There is no telephone, residence or eligibility inference.
- Lever's actual sibling question labels are recognized only within a unique,
  single-control row. This permits its explicit availability question to reuse
  saved availability. A combined GitHub/Portfolio question stays manual.
- The exact official `job-boards.eu.greenhouse.io` hosted-form domain is supported
  in both backend and extension. Near-match hosts and mismatched job query IDs remain rejected.
- The popup's legacy sending controls are hidden and disabled at runtime. The
  extension keeps the same permissions. It does not attach the saved PDF automatically.

## Real forms selected for demonstration

These three application forms were opened and inspected live on 24 October 2026.
They are existing active vacancies in the local catalog, not fixtures. Selection
is for demonstrating form reuse, not a claim that the candidate meets each job's requirements.
Forms and availability can change after this observation.

1. **InternSG — Nested Technologies, Front-end Development Intern**
   - Local: <http://127.0.0.1:15523/jobs/342839f6-ba60-4119-9e32-f81d5c3477c7>
   - Original: <https://www.internsg.com/job-apply/271393/>
   - The seven reusable details are name, email, phone, availability, introduction,
     nationality and study country. The live page says the employer may request
     a full resume later. Complete CAPTCHA and final submission manually.
   - Earlier 0.8.3 fill acceptance was **user-reported in Chrome**: all values correct
     and persisted after clicking blank. A new 0.8.4 Chrome run has not been claimed.
2. **Greenhouse — StraitsX, Software Engineer Intern - Card Issuing Team**
   - Local: <http://127.0.0.1:15523/jobs/602f07bb-e07b-44ec-9878-29dd13cc5a16>
   - Original: <https://job-boards.eu.greenhouse.io/straitsx/jobs/4942133101>
   - Proposed reuse: explicit first/last names, email, phone, and a separately saved
     LinkedIn/GitHub URL when present. Blank saved facts remain blank.
   - Manual: custom telephone-country and city widgets, CV attachment, notice
     period, six-month commitment and PDPA choice. Telephone country is not nationality.
   - This live form has fewer extra education/document questions than the inspected
     SimplifyNext Full Stack Graduate and Graviton Software Developer forms.
3. **Lever — ShopBack, Software Engineer Intern (H1 2027)**
   - Local: <http://127.0.0.1:15523/jobs/05ed8aab-8abf-4e1f-b6bd-182443074fa6>
   - Original: <https://jobs.lever.co/shopback-2/1804a30e-2d2e-4631-9e85-614c91806ddf/apply>
   - Proposed reuse: full name, email, phone, saved LinkedIn URL and explicitly
     labelled availability. Its GitHub/Portfolio combination stays manual.
   - Manual: CV, location/current company, commitment period, credit-bearing status,
     citizenship/visa status, institution category, source and declarations/consent.
     Optional GPA/year-of-study questions are not invented.
   - The saved availability must actually suit H1 2027 and the employer's six-month
     requirement before any real application. A prefilled value is not a qualification check.
   - Inspected alternatives at Palantir and CSIT require substantially more manual
     questions; CSIT additionally asks for national identity details. Neither was
     chosen to make a misleading nearly-automatic demo.

For these existing catalog sources no new source was registered and no fake vacancy
was added. Neither ATS form is completely automatic. Ordinary native-country select
support is verified separately in isolated adapter tests; the observed Greenhouse
country/city/school widgets are custom comboboxes and are still manual.

## Validation and local state

- Backend: 66 distinct targeted tests passed, including profile ownership,
  restricted extension authorization, name migration, atomic PATCH and exact ATS
  URL contracts. The first run had two Windows temporary-directory setup errors;
  those two tests passed using a fresh workspace-local temp directory. An existing
  Starlette deprecation warning remains.
- Extension: 29 Node tests passed, including the actual serialized adapter in an
  isolated DOM, country option meaning, Lever labels, frozen approval, no name
  guessing, changed profiles, exact host validation and fill-only popup structure.
- Frontend lint, TypeScript/Vite build, targeted Ruff, changed JS/spec syntax and
  `git diff --check` passed. The new bundle is `index-NfFnS1cz.js`.
- In-app browser: real local Profile loaded the separately saved name parts;
  1280px and 390px profile layouts did not overflow, and narrow-screen names stacked.
- Popup UI: actual shipped markup/modules ran against a clearly fictional local
  Chrome/API fixture. At 440×580 and 360×580, first/last/email were visible,
  the Fill button stayed visible and there was no horizontal overflow. One click
  without per-field checkboxes produced a **fixture-only** `Filled 5; skipped 0`
  result. This is UI integration evidence, not real employer/Chrome fill acceptance.
- Database 0009→0010 ran after an online backup. Integrity check passed. Hashes of
  the old protected profile columns, saved PDFs, applications, AI recommendation
  runs and extension grants remained unchanged (apart from profile update timestamp).
  Only the confirmed name parts were saved through owner-authenticated PATCH.
- API remains loopback-only at 18523; frontend remains at 15523. Existing cached
  recommendations still load. This task made zero model requests.
- The existing installed extension directory was backed up. Thirteen runtime files
  were copied and SHA-256 verified, manifest last, keeping the existing directory,
  ID and permissions. **Chrome must reload version 0.8.4 before using the new code.**

## Remaining acceptance

Chrome control is not available through the connected browser tool; the native
controller could not establish a policy-verified current URL. It was not bypassed.
Consequently real Greenhouse and Lever filling, blur/rerender persistence and the
new 0.8.4 InternSG run remain user-assisted acceptance, not completed claims.

Reload JobPilot in `chrome://extensions`, reopen a real application, choose
**Read form & load saved details**, review/edit the preview and click **Fill application
form** once. Click a blank part of the original form to check values persist.
Stop before consent, CAPTCHA, uploads or any employer submission during this demo.
Do not reuse an old preview after editing Profile. Unsupported or genuinely
employer-specific answers remain manual; this version does not promise universal autofill.

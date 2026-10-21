# Greenhouse and Lever public sources — review and fill

Status: implemented on `feat/public-ats-review-fill`; installed-extension acceptance of selected basic fields and profile-backed LinkedIn fields was completed on four hosted original-site forms across Greenhouse and Lever on 20 October 2026. Other question types and companies still need their own acceptance. This is a JobPilot project feature, not a record of anyone's personal applications.

## What it does

An administrator can register a public, exact HTTPS API board URL as a `json` source. JobPilot reads internship postings, stores normalized job data and an original hosted application link. No employer login is used. The source `name` should be the employer name shown in JobPilot.

Supported board URL shapes:

- Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{board}`
- Lever: `https://api.lever.co/v0/postings/{site}` or `https://api.eu.lever.co/v0/postings/{site}`

The existing admin source endpoint is `POST /sources` with `name`, `source_type: "json"`, `base_url`, and `enabled: true`. `POST /sources/{id}/run` accepts `max_links` and `max_details` (1–100, with details no greater than links). The adapter checks the provider's robots policy, refuses redirects to other hosts, limits response size, and does not fetch arbitrary company domains.

On a supported original-site application page, open the installed JobPilot extension. Its **Greenhouse / Lever — review & fill** section reads visible, explicitly labelled text questions and limited saved profile evidence. It can propose answers for name/email/phone and certain common LinkedIn/GitHub, availability, education, experience, skills and introduction questions. The popup shows each original question, suggestion and source. Each nonempty answer needs its own confirmation checkbox; changing the answer clears the checkbox. Only confirmed empty fields are filled. The extension does **not** parse or upload a résumé file; facts must first be saved in the JobPilot profile. Unsupported, sensitive or employer-specific questions are manual. It will not click Apply/Submit, solve CAPTCHA, accept legal terms or upload files. Any actual employer submission remains a manual user action. JobPilot does not create a submitted application record from filling a form.

## Scope and verification

For the 0.8.2 common-question expansion, backend tests passed 751 with one Docker-CLI-dependent test skipped inside the isolated test container; Ruff passed. Extension tests passed 100 with 110 existing environment-dependent tests skipped; the targeted popup and ATS tests passed after the manual-question indicator change. These are automated fixture/API results, distinct from the narrow installed-Chrome check below.

The API and extension use separate allowlists for source and form domains. A Greenhouse board may redirect its application URL to a custom company domain; the extension deliberately refuses that page, so the applicant fills it manually. This is not universal Greenhouse form support.

On 19 October 2026 an isolated four-service Docker smoke test registered public Figma/Greenhouse and ShopBack/Lever boards and ran bounded ingestion. Both source runs succeeded; two postings per source were stored alongside two sandbox posts. Read-only browser inspection found the expected basic contact fields on one hosted Greenhouse and one hosted Lever page. No live employer form was filled or submitted during this smoke test. Browser unit tests use synthetic fixtures; they are not evidence of live employer acceptance. The recommendation pipeline still requires valid requirement extraction and separate matching validation; ingestion alone is not proof of a successful recommendation.

### Installed Chrome acceptance — 20 October 2026

With explicit user approval, Chrome loaded the unpacked extension from this branch as version `0.8.1` (ID `nehlleiobnlajcfgcgldimgjlbiadnjk`) alongside the existing `0.8.0` extension. It connected to the isolated `127.0.0.1:5174` JobPilot demo and `127.0.0.1:8002` API as `admin@jobpilot.sg`. The isolated profile contained only fictional test details: `JobPilot Test Applicant`, `jobpilot-acceptance@example.com`, and `00000000`. The demo login had expired between test sessions; signing in again restored the extension connection without a code change.

| Hosted original-site form | Extension result | Independently observed on original page | Not done |
| --- | --- | --- | --- |
| [Figma / Greenhouse, Data Engineer Intern (2027)](https://job-boards.greenhouse.io/figma/jobs/6178851004?gh_jid=6178851004) | `Filled 4; skipped 0. ... Nothing was submitted.` | First Name `JobPilot`, Last Name `Test Applicant`, Email `jobpilot-acceptance@example.com`, Phone `00000000` | No résumé, custom question, country/location, CAPTCHA, consent, or final Submit |
| [ShopBack / Lever, Software Engineer Intern (H1 2027)](https://jobs.lever.co/shopback-2/1804a30e-2d2e-4631-9e85-614c91806ddf/apply) | `Filled 3; skipped 0. ... Nothing was submitted.` | Full name `JobPilot Test Applicant`, Email `jobpilot-acceptance@example.com`, Phone `00000000`; current location and company remained blank | No résumé, custom question, declaration checkbox, or final Submit |

This verifies the installed extension's limited **review-and-fill** behavior on two live, directly hosted ATS pages, not a complete employer application or a production deployment. The positions are test surfaces only and are not personal job recommendations. Their content and availability may change. The extension did not create a JobPilot submitted-application record, because no employer submission was attempted.

### New question-type acceptance — installed Chrome 0.8.2, 20 October 2026

The isolated backend was rebuilt and its `/health` returned 200; the new `/browser-assistant/ats-evidence` endpoint rejected an unauthenticated request with 401. The extension was reloaded from this worktree and Chrome showed version 0.8.2, with the same extension ID. A synthetic LinkedIn URL was saved in the isolated `admin@jobpilot.sg` demo profile. On the same hosted Figma Greenhouse form, the extension showed the exact **LinkedIn Profile** question, proposed the URL with source `JobPilot profile · LinkedIn link`, and required its own checkbox. After confirmation it reported `Filled 1; skipped 0. ... Nothing was submitted.` The original-site LinkedIn input independently displayed the same synthetic URL; existing name/email/phone stayed populated, while the employer-specific motivation field and résumé remained untouched. The original page still displayed its Submit button, which was **not clicked**. This verifies one common custom text question on one live hosted form, not all question categories or complete employer delivery.

Evidence: [installed extension result](assets/ats-question-live-popup-20261020.jpg) and [original-site LinkedIn field](assets/ats-question-live-original-20261020.jpg). Both contain only synthetic test data. The popup screenshot was taken before the manual-question list was condensed into a disclosure control; the fill result is unchanged.

### Additional company acceptance — installed Chrome 0.8.2, 20 October 2026

The same isolated demo and fictional applicant details were used on two more directly hosted original-site forms. Every filled answer was individually checked in the extension before filling; no employer application was submitted.

| Hosted original-site form | Extension result | Independently observed on original page | Still manual |
| --- | --- | --- | --- |
| [Palantir Technologies / Lever, Software Engineer Internship](https://jobs.lever.co/palantir/3531977a-9b2f-40a0-a486-4eeb38e75fc1/apply) | Full name, email, phone and LinkedIn URL selected; `Filled 4; skipped 0. ... Nothing was submitted.` | Fictional name and LinkedIn URL displayed; email and phone were populated in the browser accessibility state. | Résumé, current location, work authorization, citizenship/PR, school/degree and long answers. |
| [Appian Corporation / Greenhouse, Software Engineering Intern](https://job-boards.greenhouse.io/appian/jobs/8041237) | First name, last name, email, phone and LinkedIn Profile selected; `Filled 5; skipped 0. ... Nothing was submitted.` | Fictional name and LinkedIn URL displayed; email and phone were populated in the accessibility state. Role-specific motivation, address and authorization stayed empty. A second read labelled all five filled fields `Already filled on the website; left unchanged.` | Résumé, transcript, writing sample, selectors and other required questions. |

Evidence: [Palantir popup](assets/ats-palantir-popup-20261020.jpg), [Palantir original page](assets/ats-palantir-original-20261020.jpg), [Appian popup](assets/ats-appian-popup-20261020.jpg), [Appian original page](assets/ats-appian-original-20261020.jpg). Screenshots contain only synthetic data and show a field region or extension result, **not** a submission receipt. Palantir's popup listed four manual questions despite the form having many other unanswered radio/select/checkbox fields. Appian listed 19 but also had unsupported uploads. The scan only considers bounded visible text inputs and text areas, so the count is **not** a complete-form status. The popup copy has since been changed to say `scanned fields` and warn that other unanswered controls may be omitted; these screenshots predate that wording change. These jobs were test surfaces, not personal job recommendations.

## Manual acceptance checklist

1. Pull the branch and rebuild the backend/frontend and reload the unpacked extension. To test without disturbing a separate `5173/8000` JobPilot checkout, the extension also offers **Isolated ATS acceptance** at `127.0.0.1:5174` with API `127.0.0.1:8002`; configure the backend's approved extension ID and web origin for that pair.
2. Log in to the local demo, register and run a current public board with the admin API, and confirm the source run plus imported jobs.
3. Open a hosted Greenhouse/Lever apply link, connect the extension to the local JobPilot account, and review contact fields plus any recognized common text questions and their profile evidence. Check the explicit manual-question list. Use test-only details on a test or explicitly authorized form.
4. Confirm only the individually checked empty fields are populated. Verify that unsupported custom/legal questions, uploads, consent and final Submit remain untouched. Do not send a synthetic application to an employer.
5. Verify a custom-domain redirect or changed/unrecognized page is refused rather than silently filled.

The October 19 hosted-page candidates for this test were a [Figma Greenhouse form](https://job-boards.greenhouse.io/figma/jobs/6178851004?gh_jid=6178851004) and a [ShopBack Lever software-engineering form](https://jobs.lever.co/shopback-2/1804a30e-2d2e-4631-9e85-614c91806ddf/apply). Both resolved to their hosted ATS domain and displayed basic contact fields when inspected. These are test surfaces, not personal job recommendations; check their availability again before a later acceptance run.

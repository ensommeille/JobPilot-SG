# Greenhouse and Lever public sources — review and fill

Status: implemented locally on `feat/public-ats-review-fill` on 19 October 2026. This is a JobPilot project feature, not a record of anyone's personal applications.

## What it does

An administrator can register a public, exact HTTPS API board URL as a `json` source. JobPilot reads internship postings, stores normalized job data and an original hosted application link. No employer login is used. The source `name` should be the employer name shown in JobPilot.

Supported board URL shapes:

- Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{board}`
- Lever: `https://api.lever.co/v0/postings/{site}` or `https://api.eu.lever.co/v0/postings/{site}`

The existing admin source endpoint is `POST /sources` with `name`, `source_type: "json"`, `base_url`, and `enabled: true`. `POST /sources/{id}/run` accepts `max_links` and `max_details` (1–100, with details no greater than links). The adapter checks the provider's robots policy, refuses redirects to other hosts, limits response size, and does not fetch arbitrary company domains.

On a supported original-site application page, open the installed JobPilot extension. Its **Greenhouse / Lever — review & fill** section reads the visible field labels and loads limited saved contact details from the connected JobPilot profile. Review or edit them in the popup, then click **Fill reviewed fields only**. The extension fills only empty, unambiguous first/last/full name, email and phone fields on exact Greenhouse or Lever hosted pages. It will not click Apply/Submit, solve CAPTCHA, accept legal terms, upload a résumé, or fill custom questions. Any actual employer submission remains a manual user action. JobPilot does not create a submitted application record from filling a form.

## Scope and verification

The API and extension use separate allowlists for source and form domains. A Greenhouse board may redirect its application URL to a custom company domain; the extension deliberately refuses that page, so the applicant fills it manually. This is not universal Greenhouse form support.

On 19 October 2026 an isolated four-service Docker smoke test registered public Figma/Greenhouse and ShopBack/Lever boards and ran bounded ingestion. Both source runs succeeded; two postings per source were stored alongside two sandbox posts. Read-only browser inspection found the expected basic contact fields on one hosted Greenhouse and one hosted Lever page. No live employer form was filled or submitted during this smoke test. Browser unit tests use synthetic fixtures; they are not evidence of live employer acceptance. The recommendation pipeline still requires valid requirement extraction and separate matching validation; ingestion alone is not proof of a successful recommendation.

## Manual acceptance checklist

1. Pull the branch and rebuild the backend/frontend and reload the unpacked extension.
2. Log in to the local demo, register and run a current public board with the admin API, and confirm the source run plus imported jobs.
3. Open a hosted Greenhouse/Lever apply link, connect the extension to the local JobPilot account, and review basic contact fields. Use test-only details on a test or explicitly authorized form.
4. Confirm only the reviewed empty fields are populated; custom questions, uploads, consent and final Submit remain untouched. Do not send a synthetic application to an employer.
5. Verify a custom-domain redirect or changed/unrecognized page is refused rather than silently filled.

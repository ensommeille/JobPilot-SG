# Controlled demonstration and acceptance runbook (draft)

This is a **proposed** reproducible walkthrough for the final team demo. It is not a record that the complete Docker, installed-extension or employer-site journey was rerun on this branch. Use a new disposable local Compose project and fictional accounts/data. Never use a real employer application for acceptance testing; leave CAPTCHA, legal consent and final Submit to the human user.

## Preparation and safety

1. Use a clean checkout of the reviewed commit. Copy the repository `.env.example` to an untracked `.env`. Set new local JWT and demo-administrator passwords. Do not display, copy into slides or commit these values. Keep all `LLM_*` variables unset for the stable offline walkthrough.
2. Choose unused localhost ports and a unique Compose project name; keep the frontend build-time `VITE_API_BASE_URL` aligned with the published backend port. If demonstrating the installed extension, use its separately reviewed origin/port pairing instead of assuming custom ports are accepted.
3. From the repository root, run `docker compose -p jobpilot-course-demo up -d --build`. Check `docker compose -p jobpilot-course-demo ps`, backend startup logs and `/health`. The backend container runs migrations and idempotent demo seeding before serving. Repeat `docker compose -p jobpilot-course-demo exec -T backend python -m app.demo_seed` and confirm it creates no duplicate demo jobs/forms. Use a project name that does not target an existing team volume. Stop with `docker compose -p jobpilot-course-demo stop`; do not delete volumes during review.
4. The normal seed creates two clearly synthetic sandbox jobs and one configured platform form. To show a **positive** evidence-backed recommendation without relying on a paid model or live source, use the guarded `scripts/seed_acceptance_fixture.py` only on a freshly disposable database as described in `docs/member3/CLEAN_DEPLOYMENT_ACCEPTANCE.md`. Label the extraction `ACCEPTANCE ONLY`. Without that fixture, show the honest no-extraction/no-candidate state instead of inventing a match.

## Walkthrough

| Step | User action | What to show and say | Acceptance observation |
|---|---|---|---|
| D1 | Sign in to a fictional local account; save name, contact, education and explicit skills | Profile is the user's editable source of reusable details; user-written introduction is not AI-generated | Refresh profile and confirm saved values; sign out/switch account later to show isolation |
| D2 | Open Jobs; filter and request recommendations | Show that browsing/filter counts cover only the first 100 results returned for a search; distinguish evidence-backed suggestions and sandbox versus saved InternSG source | Expected candidates only when a current valid extraction exists; no forced recommendation |
| D3 | Open a job detail; favorite it; visit Favorites and return | Show source attribution and correct title/company/detail route | Favorite persists and is account-specific |
| D4 | Expand match analysis | Show quoted JD requirement, profile evidence and unknown/gap reason separately | Stale/missing extraction stays unavailable or explicitly limited, not silently refreshed |
| D5 | Open the seeded **sandbox** platform form, or a controlled extension fixture | Re-read current saved profile, review suggestions, preserve occupied original-site fields | No external employer form is submitted by this step |
| D6 | Confirm and save the configured sandbox form | Label the result “JobPilot record saved,” not “employer received application” | Internal history contains an assistant record; source and fixture status remain clear |
| D7 | Open My Applications and navigate pages; show allowed status controls on a separately controlled **manual** record | Manual statuses are user-reported. An assistant record cannot be relabeled as real delivery through this UI | Pagination uses server `total/pages`; invalid transitions are unavailable; 409 shows existing record |
| D8 | Simulate one network error and retry, then switch/sign out | Explain late-response/account guards | Private records disappear on account change; retry recovers only the current account |
| D9 | Show a representative crawl/extraction record and its failure/recovery state | Separate real source HTML, deterministic extraction and optional model output | No claim of live source or paid model use unless that run's logs prove it |
| D10 | Show the matching test names, workflow jobs and the current branch's CI result | Connect user flow to design and automated checks | CI/build is separate from local deployment and automated release |

For D7's manual path, use the isolated browser test `extension/tests/manual-application-record.spec.js` or a controlled local form that the demonstrator actually submitted. Do **not** tick “I personally submitted” for an employer or synthetic site where no submission occurred. The seeded assistant form and a manual record cannot coexist for the same account/job because of the unique application constraint. Do not change historical record semantics merely to make the demo look continuous.

## Failure and backup material

- If InternSG or the model API is unavailable, use stored fixtures, the saved source URL/JD and offline test evidence. Explain which result is synthetic.
- If the installed extension is unavailable, show its isolated browser flow as a distinct test artifact; do not call it installed-Chrome validation.
- If an application save times out or returns 409, inspect history before retrying. A delayed response is not proof that no record was created.
- Capture desktop and mobile screenshots, a redacted CI run URL, the exact commit SHA and a short offline video only after the final reviewed build. Keep any tokens, personal profiles and model keys out of backup material.

## Verification log for this branch

| Check | Current observation |
|---|---|
| Backend suite and coverage | Re-run on 16 October: 578 passed, 1 deprecation warning, 93% rounded branch-aware coverage on local macOS Python 3.12. This is local source verification, not a deployed run. |
| Frontend build and lint | Passed after the final application-record and job-list-favorite edits (15 October) |
| Frontend dependency audit | `npm audit --audit-level=high` exited 0 with zero vulnerabilities; this branch adds the same gate to frontend CI, not yet run remotely |
| Targeted browser application and favorite tests | Application history/manual-record, favorite-load/retry and recommendation tests passed after their respective changes; the complete suite result below supersedes the earlier targeted runs |
| Mobile profile-to-job flow | Failed once due new button overflow; after the responsive fix, all 19 tests in `profile-flow.spec.js` passed |
| Full browser suite | Re-run on 16 October with the local frontend test server: **194 passed, 6 skipped**. Skipped cases require the native installed extension or actual InternSG widget libraries and remain unverified in this suite |
| Other local checks | Frontend and extension `npm audit --audit-level=high` reported zero vulnerabilities; extension syntax checks, backend Ruff, structure check, Compose configuration and UI detector passed. Remote CI has not run on this branch |
| Isolated clean Docker/API smoke | A new `jobpilot-course-check-20261015` project built all four services, migrated PostgreSQL through `20261014_0004`, seeded two sandbox jobs/one form, returned `/health` OK, then repeat seed created zero duplicates. A fictional account created a draft via the real API, listed one record, moved it to `withdrawn`, and duplicate create returned 409. Services were stopped; the isolated volume was retained. This was **API smoke**, not a frontend/installed-extension journey |
| Live InternSG source and browser read-only check | On 15 October, a separate `jobpilot-installed-check-20261015` four-service Compose project migrated and passed `/health`; an explicitly bounded InternSG run found 8 links, inserted 5 real jobs, and reported 0 failures. In the user's Chrome, the JobPilot page for the crawled Recruit Express posting embedded its exact `https://www.internsg.com/job-apply/271139` page. After the external frame finished loading, the real job heading, name field, and Submit button were visible; an independent InternSG application page also displayed the form, country controls, rich-text editor and CAPTCHA. This establishes source-to-embedded-form loading, **not** extension filling or employer submission. |
| Installed Chrome extension / real-field fill | After the earlier pending-grant snapshot, the user reported completing extension authorization and a controlled original-site fill. The extension reported **“Filled 6; skipped 0. Nothing was submitted.”** The user checked the visible form fields and left CAPTCHA untouched; no JobPilot application record was created. This is evidence of one installed-browser fill attempt, not a repeatable acceptance run on this unmerged branch or employer receipt. Recheck on the final reviewed build and retain redacted evidence. |
| Employer receipt | Not tested; final Submit/CAPTCHA remain exclusively with the human user. No JobPilot record is evidence of employer receipt. |

Update this table from actual final commands and the reviewed commit before using it in the report. The historical main CI success at [run 38601502966](https://github.com/ensommeille/JobPilot-SG/actions/runs/38601502966) does not cover this unpushed branch.

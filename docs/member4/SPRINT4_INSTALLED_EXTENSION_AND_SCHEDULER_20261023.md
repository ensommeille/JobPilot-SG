# Sprint 4 acceptance addendum — 23 Oct 2026

This is a bounded local acceptance record, not an employer-submission receipt or a
claim that the team's deployment has been updated.

## Installed Chrome extension on a live InternSG form

- Extension: unpacked JobPilot SG — Review & Fill 0.8.2, ID
  `nehlleiobnlajcfgcgldimgjlbiadnjk`. The installed source was refreshed after
  the Quill adapter change. The test account was disposable and synthetic.
- Local JobPilot deployment: `http://127.0.0.1:5174` with its isolated API on
  port 8002. Popup displayed **Connected to JobPilot** and **Ready for InternSG
  applications**.
- Original site: `https://www.internsg.com/job-apply/271198/`, displayed as
  **Technical Interns — EP Technology Pte Ltd** on 23 Oct 2026. This URL and
  form are live-site observations, not a guarantee of future availability.
- Before filling: name, email, phone, availability and executive-summary
  editor were empty. The site's nationality and campus widgets displayed China
  and Singapore as defaults, but the synthetic JobPilot profile did not specify
  those values; the extension did **not** count or replace them.
- After explicit review and fill: popup reported **Filled 5. Remaining drafts
  are retained. Nothing was submitted.** The five fields were name, email,
  contact number, availability and executive summary. The visible Quill editor
  and hidden `applicant_summary` textarea both contained the synthetic summary.
- CAPTCHA remained unchecked; its response was empty. The site Submit button
  was not clicked. The ordinary JobPilot account's Applications page displayed
  **No applications yet**. No employer delivery or application-record creation
  is claimed. The filled original-site page should not be submitted because all
  values are fictional.
- The previous adapter recognized only Froala. The current InternSG page uses
  Quill 2.0.3, with `.isg-quill-box` following the hidden textarea. The new
  adapter resolves only that exact widget, writes literal text through Quill,
  and requires the site's hidden textarea to synchronize before reporting a
  successful summary fill. A changed or unavailable widget fails closed.

Browser observation was made in the user's Chrome after explicit permission
for access to the JobPilot test site and InternSG. Screenshots were inspected
in-session; this record intentionally excludes personal data and CAPTCHA images.

## Scheduler startup

The optional Compose `scheduler` profile existed but a fresh isolated startup
failed before polling: its container lacked required `JWT_SECRET_KEY`, and it
could race the backend's database migration. The Compose fix gives it the same
non-production secret setting as the backend and waits for a healthy backend
before starting. The backend healthcheck calls its local `/health` endpoint.

Re-test in disposable Compose project `jobpilot-s4-scheduler-smoke-20261023`:

1. Started an isolated PostgreSQL, Redis and backend on non-default local ports.
2. Ran the scheduler CLI in **preview** mode: exit 0, `Due sources: 0`.
3. Started the actual `--apply --watch` scheduler service: container remained
   running and logged `Due sources: 0`; there were no crawl or model calls.
4. Stopped and removed only that disposable project and its synthetic volume.

The worker remains **off by default**. A team operator must first configure a
public source and schedule, then explicitly start one instance with
`docker compose --profile scheduler up -d scheduler`. This local smoke check
does not prove that the worker is running in a shared/team deployment, nor that
a scheduled public fetch succeeds there. No team deployment URL or host is
recorded in the repository.

## Regression scope

- Quill success and fail-closed sync tests: 2 passed.
- Final single-invocation extension/frontend suite with local Vite UI, cached
  widget libraries and disposable native-extension profile: **232 passed**.
  An earlier fixture-path mistake was corrected before this clean run.
- The scheduler smoke ran in containers. Python unit tests are unchanged by
  this Compose-only fix and are not claimed as rerun in this addendum.

## Still requiring team action

- Human sign-off on the saved Stripe requirement extraction's semantic
  corrections remains pending; mechanical quote/hash validation is not a
  human judgment of applicant requirements. The exact questions and source
  quotes are in [the Sprint 4 closeout sheet](SPRINT4_REVIEW_RETRO_AND_SEMANTIC_SIGNOFF_20261023.md).
- Sprint 4 review, retrospective and Definition-of-Done closure require the
  actual team meeting, recorded decisions and unresolved-item owners.
- Update the presentation status and capture a backup recording from the final
  demonstrable build. The [recording runbook](SPRINT4_BACKUP_VIDEO_RUNBOOK_20261023.md)
  specifies the two required videos; it is not itself a recording. Neither a
  local scheduler smoke check nor a synthetic filled form is a production or
  employer-submission demonstration.

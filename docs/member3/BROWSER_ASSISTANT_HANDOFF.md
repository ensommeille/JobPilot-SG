# InternSG browser assistant — implementation checkpoint

Date: 2026-10-13. Branch: `feat/internsg-browser-assistant`.
Base: `main` at `7721b19`. Local changes only; no PR, push or merge in this task.

## Delivered

### Version 0.6.1: profile-to-application flow hardening (2026-10-14)

Current checkpoint: see [PROFILE_APPLICATION_FLOW_CHECK.md](PROFILE_APPLICATION_FLOW_CHECK.md).
Profile maintenance, evidence-led recommendations, correct application entry,
fresh profile reuse, account-bound asynchronous operations and truthful application
history are verified together. Existing profile/provider JSON contracts and database
schema are unchanged in this pass. The 0.6.0 connection contract remains compatible.
The prior checkpoints below are historical; use the linked flow check for current
test evidence and limits. Reload the existing unpacked extension to activate 0.6.1;
do not install it from a different folder if preserving its ID/local data is required.

### Version 0.6.0: connect through platform login (2026-10-14)

The popup password form is removed. Explicit platform approval grants a restricted
session through single-use PKCE exchange; platform logout revokes its child grants,
while extension disconnect preserves platform login. Public changes were approved
by the user. Existing login response and member 4 provider contracts are unchanged.
See EXTENSION_AUTH_CONTRACT.md for new endpoints, migration and deployment settings.

Backend regression: 319 passed, approximately 93% branch-inclusive coverage.
Browser fixture regression: 55 passed, including frontend, revocation/offline guards
and actual widget libraries in an isolated test form. Frontend build/lint, backend
Ruff check and changed-file formatting passed. Repository-wide formatting still
reports 13 pre-existing files; unrelated formatting was deliberately preserved.
No real application was submitted. User-provided installed extension ID is configured
only in the ignored local demo launcher; fixture IDs must not be used for deployment.
Actual installed Chrome approval flow still needs user acceptance testing.
The existing local demo database was backed up and migrated to 20261014_0004;
`alembic check` reports no pending model/schema differences. A real local HTTP
smoke using the existing fictional test account passed login, installed-ID code
authorization/exchange, restricted-scope rejection and server logout revocation.
The user's own account/profile was not reset. The restarted demo uses a fresh
signing key, so users must sign into the platform again. The v0.6.0 distribution
is in ignored `output/jobpilot-review-fill-0.6.0.zip`.
Local changes are not pushed. Historical checkpoints below describe older versions.

### Version 0.5.0: reusable platform profile (2026-10-14)

Latest behavior supersedes local-fallback instructions below. Four optional profile
fields and migration 20261014_0003 are now implemented with user approval. Platform
profile is the source for each application; old local data requires explicit import,
never overwrites platform values and is not used as a fallback. Shared login is not
implemented. See REUSABLE_PROFILE_CONTRACT.md for deployment and integration details.
45 browser tests passed with optional frontend/widget suites enabled. Local demo
database backed up and upgraded with accounts preserved; renewed login is required.
Full backend regression: 310 passed, approximately 93% branch-inclusive coverage;
Ruff, frontend build/lint and extension syntax checks passed. Initial Windows temp
permission/long-path failures were resolved by a fresh short test temp directory,
without disabling or changing production behavior. SQLite migration preservation
and PostgreSQL SQL compilation passed; live PostgreSQL remains untested.

### Version 0.4.1: user-written introductions only

At the user's request, removed summary-generation UI, consent, request handlers,
provider calls and the dedicated backend opt-in setting. The draft endpoint now
returns `summary_status=manual_only`; legacy `generate_summary` parameters return
422. Shared LLM providers and job extraction are unchanged. Existing local saved
summaries remain intact and reusable under the same API/account storage key.
Verification: 35 extension tests passed, six optional integration/widget tests
skipped; 16 backend endpoint tests passed; syntax, Ruff and formatting passed.
Popup screenshot inspected. The running isolated demo backend was not restarted
because its launcher creates a new database/session; source removal takes effect
on the next backend restart. Its existing live-generation flag is disabled.
Reload the unpacked extension to activate the UI change immediately.


### Version 0.4.0 embedded pilot (latest checkpoint)

Added a JobPilot application route with explicit third-party loading, a sandboxed
InternSG iframe and an original-page fallback. Only active jobs with validated
backend apply URLs expose this entry. A development-only preview route supports
local verification without inserting database records. Existing M4 flows remain
unchanged. The extension requests explicit InternSG host access and targets the
matching child document; embedded parents are localhost/127.0.0.1 only. No JWT
bridge, iframe protection removal, CAPTCHA automation or delivery claim is added.

Current verification: 41 Playwright tests passed with optional frontend/widget
suites enabled; frontend build/lint and extension syntax passed. Live read-only
iframe verification found the form, Froala editor and CAPTCHA frame, with no
POST/submission. User screenshots previously confirmed direct-page country and
rich-text filling after v0.3.1; installed-extension embedded filling remains to
be accepted manually. No real model calls or employer submissions this update.
Two high-severity findings remain in the unchanged frontend dependency lockfile.
This checkpoint supersedes older acceptance/count statements below; backend's
310-test result below is historical and was not rerun for this frontend update.
No commit, push or merge performed. See extension/README.md for local instructions.

### Version 0.3.1 hotfix (2026-10-13)

User reported repeated country-change rejection without visible site edits. Reproduced
the same rejection with identical country values but reordered snapshot properties.
Replaced JSON-string equality with strict per-field value comparison; all five fields
remain required, and real differences still block replacement. Added two offline
regressions plus an actual CountrySelect-library regression. 35 extension tests passed
with optional downloaded widget libraries enabled; syntax and diff checks passed.
The user's installed Chrome flow still needs retesting. No application was submitted.

### Version 0.3.0 update (2026-10-13)

Supersedes earlier statements that the extension never activates Submit. Filling still
does not submit. A separate final-review flow captures the actual original-site recipient
and answers, requires explicit single-application authorization, verifies CAPTCHA was
completed manually, and clicks the real site button without bypassing site validation.
Two-minute fingerprint-bound approval rejects changed answers/recipient. Web Locks and
a durable per-account/job local reservation prevent competing or uncertain repeat attempts.
No automatic retry; a definite pre-click rejection releases the reservation.

32 extension tests passed with the optional actual-widget-library checks enabled (30 offline
tests plus 2 library tests). New tests cover explicit confirmation, changed/expired approval,
CAPTCHA absence/expiry, incomplete forms, foreign actions, duplicate controls, competing
reservations, interrupted navigation, and conservative result handling. Syntax checks pass.
No real employer submission was performed. Recognized website messages are displayed, but
delivery remains unverified until the user checks the original result. No backend application
record is marked submitted. This is not an unattended/bulk-application workflow.

Installed Chrome acceptance of v0.3 and the real site's successful receipt contract remain
unverified. Test only with fictional intercepted forms; do not submit fake employer applications.

### Version 0.2.0 update (2026-10-13)

Supersedes the initial manual-country limitation below. Added explicit account-scoped
local supplementary profile storage (API origin + backend user ID), delete controls,
Froala rich-text insertion/backing-textarea synchronization, and jointly confirmed
nationality/study-country replacement through CountrySelect, including hidden codes
and the linked checkbox. Ordinary existing text remains protected. Per-field reasons
cover missing data, unavailable controls, changed values, limits and failed synchronization.
No backend/schema/Member 4 contract changes were needed for this update.

Extension verification: 23 tests with the optional actual-library checks enabled;
21 offline tests plus 2 tests using downloaded public widget libraries in isolated forms.
No employer submissions, CAPTCHA automation or paid model calls. Version 0.2.0 still
needs installed-extension acceptance on the user's current real page. The user supplied
screenshots showing successful v0.1 installation and real-page name/email filling;
that evidence does not establish v0.2 rich-text/country acceptance.

- Installable-source Chrome MV3 extension with JobPilot login, temporary session storage,
  active-tab field inspection, editable previews and individual approval before filling.
- Five supported InternSG field IDs: name, email, phone, availability and resume summary.
  Existing page answers are never overwritten. Unconfirmed/skipped drafts remain in the
  open popup after partial filling; successful fields are marked rather than refilled.
- A separately authenticated `/browser-assistant/draft` endpoint reads only the caller's
  profile. No client-supplied model/key/endpoint or arbitrary page fetch is accepted.
- Optional DeepSeek summary generation through the existing provider interface, disabled
  by default. Dedicated click/consent, strict output validation, timeout, no retries,
  max 2048 output tokens, local per-user/global attempt caps, and manual fallback.
- Original form URL and Chrome document ID bind filling to the inspected document.
  Duplicate IDs, wrong types, hidden/read-only/disabled controls and foreign form origins
  are rejected/skipped. No submit action, CAPTCHA automation or consent checkbox changes.
- CI job added for extension syntax, browser fixture tests and npm dependency audit.
  Existing form assistant contracts, profile schema and database migrations are untouched.

## Verification actually performed

- Backend: **310 passed**, 92.49% branch-inclusive coverage; Ruff clean.
- New backend suite: 25 tests. New module coverage: 97% (statement + branch).
- Extension: **17 Playwright tests passed**, including real Chromium DOM execution
  on intercepted synthetic HTML. Popup tests stub Chrome APIs and backend responses.
- Extension JS syntax check and npm audit passed (0 vulnerabilities reported).
- UI screenshots checked at 420px; independent UI review resolved partial-fill draft loss
  and returned ship for the UI/fixture scope. No shipping image assets.
- Initial full pytest run had Windows temp-directory permission setup errors. Re-running
  with a fresh `PYTEST_DEBUG_TEMPROOT` produced the passing result without disabling tests.
- Existing Starlette/httpx deprecation warning remains.

## Not yet acceptance-tested

- Actual installed-extension permission prompt, popup viewport and injection lifecycle.
  Full downloaded Chromium launch failed on this host; installed Chrome did not load an
  unpacked extension via command line, and its CDP load method was unavailable. DOM and
  mocked-popup tests do not replace this check.
- Version 0.2 rich-text/country filling on a real InternSG page (v0.1 name/email filling
  was subsequently demonstrated by the user's screenshots).
- Live DeepSeek call with a newly rotated key. The exposed key was not saved or used.
- Public deployment, remote CI, hosted HTTPS API and multi-worker quotas.

## Next acceptance steps

1. Load `extension` unpacked in Chrome manually and use the updated local backend.
2. Use a fictional test account/profile. Verify initial unsupported-page errors, sign-in
   and API-origin permission. Open an approved InternSG original application page.
3. Inspect, preview, edit and approve selected answers. Verify exact values, preservation
   of existing answers and partial-fill drafts. Do not submit a fictional application.
4. Configure a rotated DeepSeek key in backend `.env`, explicitly enable the browser
   summary setting, and verify one bounded summary generation with fictional evidence.
5. Keep CAPTCHA/consent/submission manual. Treat external receipt as unverified; never
   create a "submitted" application record merely because values were filled.

See `extension/README.md` for installation and configuration. The quota is in-memory,
single-process and reset on restart: use it for local demonstrations, not as a production
billing guarantee. Production rollout needs durable quotas, abuse controls and audit design.

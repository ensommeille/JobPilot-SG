# JobPilot SG — Review & Fill (InternSG pilot)

## Version 0.6.1: platform login and reusable profile

The platform profile is now the source for name, email, phone, user-written
introduction, availability, nationality and study country. Each **Read page &
load profile** refreshes from the authenticated account. Application-specific
edits are not silently saved back. Missing or cleared platform values are never
filled from an old device copy. There is no AI introduction generation.

## Local setup and use

1. Back up your database, install backend dependencies and run
   `python -m alembic upgrade head` from `backend` before starting the new backend.
   Migration `20261014_0003` adds four nullable profile columns; `20261014_0004`
   adds authorization grants and platform-token revocations.
2. Sign into JobPilot, open **Profile**, maintain the **Reusable application
   details** section and choose **Save Profile**. These details are saved to
   the account in the backend database.
3. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**
   and select this directory. Existing users should reload the extension
   (version 0.6.1), then reopen its popup. Keep the same directory and extension
   ID to preserve device copies. Register its 32-letter ID in the backend
   `EXTENSION_CLIENT_IDS=["your-installed-extension-id"]` environment setting.
   The default empty list intentionally rejects connections.
4. Choose your deployment and **Connect through JobPilot** in the extension.
   Grant API access; the opened platform tab asks you to confirm the current account.
   If needed, sign in ON THE PLATFORM. There is no extension password form.
   Return to the application and reopen the popup after confirmation.
   Local demo: `http://127.0.0.1:5173` → API `http://127.0.0.1:8001`;
   normal development: `http://localhost:5173` → API `http://localhost:8000`.
   These exact pairs are allowlisted. Other deployments need coordinated configuration.
   Default Docker Compose uses the **localhost** pair; opening its frontend at
   `127.0.0.1:5173` does not change the extension's fixed API port from 8001 to 8000.
   Custom Compose ports are suitable for isolated API/deployment checks, but do not
   automatically become supported extension deployments.
5. Open a supported InternSG original application page, or use the local JobPilot
   embedded application route. Choose **Read page & load profile**, review each
   answer, then **Fill confirmed answers**. Countries require a separate explicit
   replacement confirmation, including the linked study-country checkbox.
6. Repeat on another job: saved platform details are loaded again, not re-entered.
   CAPTCHA, attachments and consent remain manual. Test data must never be
   submitted to a real employer.

The frontend local demo is `http://127.0.0.1:5173`.
The development-only route `/jobs/internsg-preview/apply-external` loads a REAL
InternSG form without adding a database job; it is not a sandbox employer.
Actual active jobs expose `/jobs/:id/apply-external` only with a validated
backend `apply_url`. No URL is guessed from a job ID.

## Importing previous device details

Expand **Previous device details — review and import**. Review the visible text
and stored country codes, check the import confirmation, then choose
**Import reviewed details to JobPilot**. The backend only writes empty fields;
existing platform values are preserved and listed as skipped. Import is authenticated,
account-scoped and repeat-safe. There is no automatic import or overwrite.
Read the application again afterwards. The device copy is retained until the user
chooses **Delete saved details**; this never deletes platform data or submission
attempt protection. Old local save controls are retained for migration, not used
as an automatic fallback for applications.

Device copies are keyed by API origin and backend user ID, not encrypted as a vault
or cloud-synced. Avoid saving them on a shared computer. Restricted opaque sessions
are kept in trusted extension session storage, not in the original page. Connections
last at most eight hours and never longer than the platform token; browser restart,
expiry or logout requires reconnecting, not a second password form. Platform logout
revokes the associated connection server-side. Disconnecting the extension does not
log out the platform. See [the auth contract](../docs/member3/EXTENSION_AUTH_CONTRACT.md).

## Embedded mode

Explicitly load the original site in JobPilot, then open the extension and choose
**Enable embedded InternSG access**. The pilot allows only localhost/127.0.0.1
parents on the application route and exactly one marked InternSG frame. Remote
deployment needs a reviewed allowlist change.

Frame discovery reads location metadata only. Reading/writing binds to the matching
child document ID, and writes recheck the parent context. No JWT bridge, proxy,
frame-protection stripping or CAPTCHA bypass is used. The iframe is sandboxed
without top navigation, and **Open original application** remains a fallback.
An iframe load event is not proof of a ready form or successful delivery.

## Filling and submission boundaries

Supported fields are name, email, contact, availability, Froala resume summary,
and CountrySelect nationality/study country. Rich text is inserted as escaped
plain text with line breaks and backing-field synchronization. Existing text
is preserved, including edits made after inspection. Missing, ambiguous, hidden,
unsupported or changed controls fail closed or show a reason; re-read after navigation.

Filling never submits. The separate **Review website answers before sending**
flow checks actual page contents and recipient, requires manual CAPTCHA and
explicit authorization, and expires after two minutes. A SHA-256 fingerprint
binds the review to form contents and destination. The site button is clicked
once; no raw POST replay, `form.submit()`, CAPTCHA solving or automatic retry.

A Web Lock and durable account/job-scoped local reservation guard duplicate
extension attempts. Definite no-click releases it; interrupted/unknown outcomes
retain it and block retry. Clearing storage, another device/account or manual
submission is outside this protection. Never assume an unknown result failed.

**Check original page result** displays site text only; delivery remains unverified.
Neither a URL change nor apparent success text creates a submitted JobPilot record.
No real employer submission was performed for acceptance.

## Verification

```powershell
npm ci
npx playwright install chromium
npm run check
npm test
```

For frontend journeys, set `FRONTEND_BASE_URL` to a running local Vite server.
CI sets it to `http://127.0.0.1:5197` and sets `PLAYWRIGHT_START_FRONTEND=1`
to start the test server automatically after installing frontend dependencies.
Set `WIDGET_ASSET_DIR` to the directory containing `jquery.js` (3.7.1),
`country.js` (CountrySelect 2.1.0), and `froala.js` (4.0.7) for the three optional
downloaded-widget-library cases. The PR publication checkpoint passed 99 cases
with these three explicitly skipped; the earlier local run covered those three.
Tests use intercepted pages and mocked Chrome APIs; they do not replace installed
Chrome permission/child-frame acceptance. The real embedded form/editor/CAPTCHA
previously loaded in read-only verification; no real submission is verified.
See [the flow check](../docs/member3/PROFILE_APPLICATION_FLOW_CHECK.md) for detailed
test evidence and remaining acceptance boundaries. The clean-deployment pass
updates two vulnerable frontend build dependencies to compatible patched versions;
it does not expand the extension's origin permissions or submission authority.

## Team contract

See `docs/member3/REUSABLE_PROFILE_CONTRACT.md` for public fields, backward
compatibility, migration/deployment order and import semantics.
The draft endpoint reads only the authenticated account and never calls a model.
Member 4's shared provider, mapping endpoints and job extraction are unchanged.
Source terms, hosted deployment and installed-extension acceptance still need review.

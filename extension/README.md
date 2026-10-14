# JobPilot SG — Review & Fill (InternSG pilot)

## Version 0.8.0: a compact companion and one-click filling

The platform profile is now the source for name, email, phone, user-written
introduction, availability, nationality and study country. Each **Read page &
load profile** refreshes from the authenticated account. Application-specific
edits are not silently saved back. Missing or cleared platform values are never
filled from an old device copy. There is no AI introduction generation.

The popup now prioritizes connection status and returning to JobPilot. Host
access is requested only when missing; settings, old-device import and original-site
fallback tools are progressively disclosed rather than all shown at once.
On the platform, **Fill application form** checks the original form and fills
the displayed eligible answers in one explicit action. There are no per-answer
confirmation checkboxes. The action also approves the displayed nationality and
study-country replacement; it does not authorize submission.

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
   (version 0.8.0), then reopen its popup. Keep the same directory and extension
   ID to preserve device copies. Register its 32-letter ID in the backend
   `EXTENSION_CLIENT_IDS=["your-installed-extension-id"]` environment setting.
   The default empty list intentionally rejects connections.
4. Choose **Connect through JobPilot** in the extension. The local demo is the
   default; change deployment under **Connection settings** only when needed.
   Grant platform and API access; the opened platform tab asks you to confirm the current account.
   If needed, sign in ON THE PLATFORM. There is no extension password form.
   Return to the application and reopen the popup after confirmation.
   Local demo: `http://127.0.0.1:5173` → API `http://127.0.0.1:8001`;
   normal development: `http://localhost:5173` → API `http://localhost:8000`.
   These exact pairs are allowlisted. Other deployments need coordinated configuration.
   Default Docker Compose uses the **localhost** pair; opening its frontend at
   `127.0.0.1:5173` does not change the extension's fixed API port from 8001 to 8000.
   Custom Compose ports are suitable for isolated API/deployment checks, but do not
   automatically become supported extension deployments.
5. Open an active job in JobPilot and choose **Prepare application**. Review or
   edit its reusable answers, load the original application explicitly, and choose
   **Fill application form** once. The form check runs automatically before filling.
   This approves the displayed country choices together with the text answers;
   missing or unsupported details receive reasons instead of invented values.
6. Repeat on another job: saved platform details are loaded again, not re-entered.
   CAPTCHA, attachments and consent remain manual. Test data must never be
   submitted to a real employer.

The frontend local demo is `http://127.0.0.1:5173`.
The development-only route `/jobs/internsg-preview/apply-external` loads a REAL
InternSG form without adding a database job; it is not a sandbox employer.
Actual active jobs expose `/jobs/:id/apply-external` only with a validated
backend `apply_url`. No URL is guessed from a job ID.

## Importing previous device details

Within the popup settings, expand **Previous device details — review and import**. Review the visible text
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

## Platform-owned review bridge

See the [platform application bridge contract](../docs/member3/PLATFORM_APPLICATION_BRIDGE.md)
for the v1 message shapes, fingerprint algorithm and team acceptance checklist.

On a real active job's `/jobs/<UUID>/apply-external` page, JobPilot can display
saved profile answers, inspect the loaded original form, and fill eligible answers
after one explicit **Fill application form** action. Grant **Enable embedded InternSG access** once in
the connected popup to grant both the platform host and InternSG hosts. The
development-only `internsg-preview` route is intentionally excluded from this bridge.
The existing popup remains available; no backend API or database changes are required.

Only version-1 `application-inspect` and `application-fill` messages are supported.
The extension binds the request to the browser-supplied top document and tab, the
exact deployment pair, the active backend job's application URL, and exactly one
matching direct child document. It independently validates the restricted extension
session and the platform account. A read-only function in the platform's isolated
world sends its JWT only to that deployment's fixed API; only account identity and
SHA-256 fingerprints leave that function. No JWT is passed to the background worker,
the original site, or message responses.

Inspection returns only supported field metadata and country options, never existing
answers, raw HTML, CAPTCHA data or credentials. The request must carry the fingerprint
of the platform draft being reviewed. The resulting review lasts five minutes, is
single-use and is lost safely on service-worker restart. It binds platform and
extension identity, saved details, job, parent document and child document. Changed
details, logout, navigation, replacement frames and mismatched accounts require a
fresh review. The platform obtains that review inside each explicit fill operation,
using a snapshot of the answers displayed when the user clicked. It does not reuse
the click to retry after failure. The country control snapshot stays private inside the extension;
webpages cannot supply or override it.

Filling uses the same fixed adapters as the popup, retains occupied-field protection
and explicit country replacement, and revalidates before each adapter dispatch.
Operations have an 18-second deadline; a late-injected fill is refused. A lost or
interrupted reply may follow a partial fill: inspect the original form, never retry
automatically, and never assume no changes occurred. This bridge has no submission
command and never imports the submission helper. CAPTCHA, consent, attachments and
the original site's final Submit action remain manual. Filling does not create an
application record or prove delivery. Synthetic acceptance tests do not submit to
real employers.

## Filling and submission boundaries

Supported fields are name, email, contact, availability, Froala resume summary,
and CountrySelect nationality/study country. Rich text is inserted as escaped
plain text with line breaks and backing-field synchronization. Existing text
is preserved, including edits made after inspection. Missing, ambiguous, hidden,
unsupported or changed controls fail closed or show a reason; re-read after navigation.

Filling never submits. Under **Original-site tools**, the collapsed
**Advanced: send from the original site** section retains the separate
**Review website answers before sending**
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

## Red Froala notice on the original form

An "Unlicensed copy of the Froala Editor" notice inside the InternSG frame is
the original site's editor activation message, not a JobPilot validation error
or a delivery result. JobPilot uses its own plain-text introduction editor; the
extension accesses InternSG's already-created Froala instance without changing
its license or hiding the notice. Public source confirms that InternSG supplies
an activation key, but does not establish why activation is failing in the
reported browser context. InternSG/Froala must verify that configuration.

Keep the original notice visible. Use **Open original application** if the
embedded editor cannot be used, then verify the actual page; opening it directly
is not a guaranteed license fix. Do not submit test data, purchase a license for
the user, or strip the warning. See the
[investigation and evidence limits](../docs/member3/PLATFORM_APPLICATION_BRIDGE.md#original-site-froala-notice--investigated-2026-10-14).

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

# Platform application review and fill bridge

Extension version: **0.8.0**. Webpage/extension message version: **1**.

## Purpose and user flow

JobPilot owns the preparation workflow: maintain a profile once, choose a job,
review reusable answers on the platform, and fill the displayed eligible answers
with one explicit action. InternSG remains the original application destination. This feature does
not submit an application or claim that an employer received it.

1. Save reusable application details in **Profile**: name, contact email, phone,
   availability, user-written introduction, nationality and country of study.
2. For an active job with a supported InternSG application URL, choose
   **Prepare application**. Saved answers load in JobPilot; the original site
   is not loaded automatically. Missing or explicitly cleared details stay blank.
3. Review or edit the answers. These edits are application-specific and do not
   overwrite the saved profile. **Update my saved profile** provides a return
   path; **Reload saved details** intentionally replaces one-off edits.
4. Choose **Load InternSG application here**, then **Fill application form**.
   That explicit click snapshots the displayed answers and country choices,
   checks the current form, and fills eligible fields. Loading alone never fills.
5. There are no per-field checkboxes. The button's adjacent disclosure explains
   that the displayed nationality and study-country choices replace the original
   country selections, while existing text stays unchanged. Missing, occupied and
   unsupported answers receive reasons. Editing after completion clears the old
   report, and any retry requires a new user click and a fresh form check.
6. Inspect the actual original form. Complete CAPTCHA, consent, attachments and
   any final Submit action yourself. Never submit fictional test data to a real employer.

The previous popup workflow remains available. Its separately authorized sending
controls are not called by this platform bridge. No AI introduction generation or
paid model call is part of this feature.

## Install/update and one-time permissions

- Existing users: open `chrome://extensions`, reload the existing JobPilot
  installation from the same directory, and verify version **0.8.0**. Keep its
  original extension ID; do not remove/reinstall just to update it.
- New installations: load the repository's `extension` directory unpacked and
  register its 32-letter ID using the existing backend `EXTENSION_CLIENT_IDS`
  setting. This feature adds no registration endpoint.
- In the popup, choose **Connect through JobPilot**. The local demo is the
  default; use **Connection settings** only to select a different supported deployment.
  Approve platform/API access and confirm the account on JobPilot. Sign in on
  the platform if needed; no password is entered in the popup.
- In the connected popup, choose **Enable embedded InternSG access**. Approve
  access to the connected platform and the InternSG hosts, then return to the
  application page and fill the form. The permission action is shown only when
  access is missing; settings and fallback tools stay collapsed in normal use.
  Permissions are reused until revoked.
  Session expiry, logout or browser restart can still require reconnecting.

The allowlisted deployment pairs are exact:

- `http://127.0.0.1:5173` → `http://127.0.0.1:8001`
- `http://localhost:5173` → `http://localhost:8000`

Custom ports, HTTPS/remote deployments and other origins require coordinated
allowlist changes. Changing only the frontend API environment variable does not
change the extension's pairing. The webpage cannot supply an API URL.

## Version-1 message contract

Messages use `chrome.runtime.sendMessage(extensionId, message)`. Only trusted
top-level `/jobs/<UUID>/apply-external` pages can use this bridge. The development
`/jobs/internsg-preview/apply-external` route is intentionally excluded.
The extension verifies the backend job is active and its `apply_url` exactly
matches the single marked, direct-child InternSG iframe.
The loaded iframe may canonicalize only the trailing slash on the same HTTPS
origin and numeric application path. Its actual URL and document are then bound
to the review; adapters still require an exact match before writing. Host,
application ID, query and fragment changes are not accepted as canonicalization.

Inspection request:

```json
{
  "kind": "application-inspect",
  "version": 1,
  "job_id": "12345678-1234-1234-1234-123456789012",
  "page_url": "https://www.internsg.com/job-apply/123/",
  "profile_fingerprint": "<64-character lowercase SHA-256 hex>"
}
```

The fingerprint describes the **saved draft**, not application-specific edits.
Both sides hash UTF-8 `JSON.stringify` output using this exact key order and
empty-string normalization:

```javascript
const ids = ['applicant_name', 'applicant_email', 'applicant_contact',
  'applicant_period', 'applicant_summary'];
const canonical = {
  values: Object.fromEntries(ids.map(id => [id, draft.values[id] || ''])),
  countries: {nationality: draft.countries.nationality || '',
    campus: draft.countries.campus || ''},
};
// profile_fingerprint = lowercase hex SHA-256(JSON.stringify(canonical))
```

Inspection returns `ok: true`, `version: 1`, an opaque UUID `review_id`,
`expires_at` in **Unix milliseconds**, and:

- `fields`: the five supported text fields, each with `id`, fixed `label`,
  `maxLength`, `occupied`, and optional boolean `unavailable` / `widget`.
- `countries`: supported `{code, name}` choices; `countries_available` and an
  optional `country_reason`. Labels are generated in the trusted extension,
  not copied from arbitrary source-page text.

No original answers, country selection snapshot, credentials, HTML or CAPTCHA
data are returned. A stale saved-draft fingerprint requires reloading details.

Fill request:

```json
{
  "kind": "application-fill",
  "version": 1,
  "job_id": "12345678-1234-1234-1234-123456789012",
  "page_url": "https://www.internsg.com/job-apply/123/",
  "review_id": "<UUID returned by inspection>",
  "approved": [
    {"id": "applicant_name", "value": "User-confirmed name", "confirmed": true},
    {"id": "applicant_countries", "value": "{\"nationality\":\"cn\",\"campus\":\"sg\"}", "confirmed": true}
  ]
}
```

Only the five known text IDs and `applicant_countries` are accepted, once each.
Each approved item contains exactly `id`, `value`, and `confirmed: true`.
The flag records inclusion in the user's explicit batch-fill action, not a
requirement for a separate checkbox for every field. Rendering, draft loading,
iframe loading and inspecting alone never authorize a fill.
Country `value` is a JSON string containing exactly `nationality` and `campus`.
The expected original-country state is private to the extension, never supplied
by the webpage. Unknown keys, arbitrary selectors/scripts/tab/frame IDs, URL
overrides and submission instructions are rejected.

Successful fill response:
`{ok: true, filled: [ids], skipped: [ids], reasons: {id: reason}, submitted: false}`.
Errors return `{ok: false, error: string}`. `ok` describes the bridge operation,
not delivery. No application status or database record is marked as sent.

## Identity, freshness and failure boundaries

The extension validates its restricted `jpx_` session server-side. Separately, a
read-only function runs in the trusted platform document's **isolated world**,
uses that origin's platform JWT with the fixed API, and verifies `/users/me`,
`/jobs/{job_id}` and `/browser-assistant/draft`. It returns identity,
session/profile hashes and the verified current parent URL. The JWT is not returned to the background worker or
forwarded to InternSG. A caller-supplied user ID is not an identity proof.

Chrome sender metadata supplies the trusted origin, tab and document identity,
not the current SPA route. The isolated function reads the document's current
location and validates the exact job route without a query or fragment, both
before and after account verification. The worker independently validates this
URL and binds it to the review. This supports navigation from the job list even
when Chrome's sender URL still names the initially loaded page.

Reviews bind both identities, saved details, job/URL, originating tab, top document
and child document. A review lasts at most five minutes and is consumed before
filling begins, including failed attempts. Reviews are kept only in memory;
service-worker restart invalidates them earlier. Reinspection replaces older
reviews for that tab. Logout, profile changes, document replacement and navigation
require a fresh check. The frontend clears private drafts on account changes.

Each adapter dispatch revalidates the context. Existing text is not overwritten;
country replacement requires explicit confirmation and unchanged inspected widget
state. Rich text is escaped plain text with line breaks. The 18-second operation
deadline includes background queuing, and adapters reject late execution. The
frontend's response timeout is not proof that nothing was filled: some confirmed
answers may already have been written. Check the original form, do not retry
automatically, and do not undo user edits to conceal an uncertain outcome.

This feature reuses existing HTTP APIs, profile columns and authentication grants.
It adds **no backend endpoint, shared Provider contract or database migration**.
The new interface is the strictly scoped webpage/extension message protocol above.
There is no submit command, CAPTCHA bypass, hidden POST replay or real-delivery
claim. Browser-origin compromise and arbitrary malicious changes to trusted
JobPilot code are not prevented merely by a `confirmed` flag.

## Verification and remaining acceptance

Relevant suites: `extension/tests/application-bridge.spec.js`,
`platform-application-security.spec.js`, `platform-application-flow.spec.js`, plus
the existing popup, frame, field and widget regressions. These use synthetic
pages/mocked APIs and verify account isolation, stale-profile rejection, one-use
reviews, document targeting, confirmed-only filling and no submission.

Before release, verify the installed extension in real Chrome: its actual host
permission prompts, the platform/API pairing and CORS, and `allFrames` discovery
on an embedded InternSG page containing third-party CAPTCHA frames. Browser
privacy settings or source-site changes may prevent embedding/widget access;
**Open original application** remains the fallback. Automated fixtures do not
prove this live-browser acceptance or successful employer delivery. Test totals
belong in the final verified release report, not assumed here.

### Local verification checkpoint — 2026-10-14

- Frontend ESLint and TypeScript/Vite production build: passed.
- Extension JavaScript syntax checks and `git diff --check`: passed.
- Full isolated frontend/extension suite: **159 passed**, including the three
  local CountrySelect/Froala library cases (none skipped).
- Existing backend compatibility tests for browser drafts, extension auth,
  reusable profiles, profile-to-application flow and jobs: **46 passed**.
  One existing Starlette TestClient/httpx deprecation warning was reported.
- Desktop and mobile application-preview screenshots were inspected; long
  user-written text remains editable and the viewport has no horizontal overflow.
- Regression coverage includes clearing old fill reports after editing or frame
  navigation, and warning of uncertain outcomes when navigation interrupts filling.

These are local automated results, not a new remote CI run or installed-Chrome
acceptance. No paid model, production database mutation or real employer submission
was used. The existing normal frontend/backend services were not restarted for
this feature; the isolated test server is separate.

### Version 0.7.1 compatibility fix — 2026-10-14

- Replaced cached sender-path validation with current-route verification inside
  the originating document's isolated world. Origin, account, job and document
  binding remain mandatory; navigation invalidates an existing review.
- Accepted only same-origin/same-job trailing-slash canonicalization for the
  embedded form. The real frame URL is pinned for all adapter calls.
- Targeted browser bridge tests: **20 passed**. Independent bridge security
  tests: **17 passed**. Frontend lint/build and extension syntax checks passed.
- The complete regression run reported **172 passed**, two opt-in tests skipped,
  and four negative tests whose expected error wording was being corrected.
  The production guard correctly rejected all four targets; after correcting
  those assertions, the explicit `--last-failed` rerun passed **4/4**. Thus all
  **176 enabled cases** have passing results across the full run and rerun.
- Two native external-messaging probes in `application-sender.spec.js` are
  explicitly enabled with `PLAYWRIGHT_NATIVE_EXTENSION=1`. They require full
  Playwright Chromium; this machine returned `spawn UNKNOWN` before opening any
  page, although the headless-shell fixture suite worked. No real MessageSender
  observation or installed-user-extension acceptance is claimed from that attempt.

Reload the existing unpacked extension to version 0.7.1 and refresh the platform
page before checking the form again. A worker reload invalidates old reviews;
saved platform profile data is unchanged. If the restricted connection expired,
reconnect through the already-signed-in platform. Do not submit a real application
as part of this verification.

### Version 0.8.0 interaction refinement — 2026-10-14

- The normal popup shows a single primary connection/platform action. Embedded
  access appears only when missing; settings, migration and fallback tools are
  collapsed, and the existing final-send controls are nested separately.
- Both platform and fallback filling use the answers captured at the explicit
  click, with no individual confirmation checkboxes. Platform filling performs
  a fresh inspection internally; fallback filling retains its inspected target
  and country-state guard. Busy controls cannot silently add later edits.
- Popup fill responses must partition the approved fields exactly and report
  `submitted: false`. Invalid or interrupted post-dispatch replies warn that
  some answers may already be filled and require checking the original page;
  no automatic retry is performed.
- Targeted platform/profile tests: **43 passed**. Targeted popup tests:
  **28 passed**. Frontend lint/build, extension syntax and whitespace checks passed.
- Complete isolated regression run: **188 passed**, **2 opt-in native-extension
  probes skipped**, and one popup test read its result before asynchronous
  completion. Only the test wait was corrected: disabled controls indicate busy
  as well as completed state, so the assertion now waits for the final fill
  report. The subsequent popup run passed **27/27** non-capture cases, and the
  country/partial-fill cases passed **20/20** across ten repetitions each.
  All **189 enabled cases** therefore have passing results across the full run
  and focused reruns. No additional visual capture round was needed.
- One batched visual review covered desktop/mobile preparation and 420px popup
  disconnected, ready, permission-missing and expanded-fallback states. The
  scoped finish review found no blocking UI issue; the source detector returned
  `[]`. No new assets, dependencies, HTTP API changes or database changes were needed.

These results use synthetic pages and mocked APIs, not real employer delivery.
The installed user's Chrome extension must be reloaded to **0.8.0**, then the
JobPilot page refreshed. Saved profile data and the extension ID stay unchanged.
No real application was submitted during this refinement.
The isolated Vite test server on port 5197 was stopped afterwards; normal user
services on ports 5173 and 8001 were left running unchanged.

### Original-site Froala notice — investigated 2026-10-14

The user observed the red editor message "Unlicensed copy of the Froala Editor"
inside the original InternSG iframe. Froala's [official FAQ](https://cart.froala.com/)
describes the red unlicensed banner as an editor-license activation notice.
It is not a JobPilot profile validation message, nor proof that a submission
succeeded or failed.

Evidence gathered without filling or submitting a real form:

- `ApplicationPreparation.tsx` uses a normal textarea. The frontend has no Froala
  dependency, and `InternSGApplication.tsx` loads the original URL directly.
- `extension/widgets.js` finds the existing `window.FroalaEditor.INSTANCES` entry
  and uses its `html.get` / `html.set` APIs. It does not initialize a new editor,
  change the activation settings or suppress the vendor notice.
- A read-only GET of the [original application page](https://www.internsg.com/job-apply/271088/)
  returned HTTP 200 and referenced InternSG-hosted Froala 4.0.7 and
  [its own initialization script](https://cdn.internsg.com/wp-content/themes/internsg-child/pods/js/min/jobs-apply.min.js?ver=2.1).
  That script creates the summary editor with a `key` option already present.
  No key value or downloaded vendor source is included in this repository.

Public source does not prove whether that key is valid, compatible with the
loaded version, or affected by this embedded browser context. The
[official activation explanation](https://wysiwyg-editor.froala.help/hc/en-us/articles/115000394945-What-is-an-Activation-Key)
discusses domain-specific activation, but does not establish the cause for this
site. A direct-versus-embedded live-browser comparison and vendor confirmation
have not been completed. Do not claim embedding always causes the banner, that
the applicant must purchase a license, or that a direct opening fixes it.

Release disposition: document this external limitation; retain the original
notice and the existing **Open original application** fallback. Do not remove
license checks, alter vendor assets, or inject another key. Complete resolution
requires InternSG/Froala to verify the site's permitted configuration. No claim
of successful employer delivery is made.

### Version 0.8.0 closeout verification — 2026-10-14

- Final focused extension/browser batch: **89 passed** with local real-widget
  assets enabled. It covers the platform application flow, popup, bridge,
  page adapter and widget adapter. All pages and API responses are isolated
  test fixtures; this is not a real-employer submission test.
- A new job A-to-B regression checks all seven saved profile fields. Unsaved
  edits made for A do not leak into B, switching jobs does not load or fill an
  external form automatically, and B's explicit fill is bound to B's job ID
  and application URL.
- Occupied text fields, text edited after inspection and existing rich-text
  summaries remain unchanged. Countries are the disclosed exception: an
  explicit fill approves the displayed nationality/study-country pair, but
  a changed original country snapshot blocks replacement.
- A synthetic vendor-notice regression checks that filling the editable summary
  preserves a visible notice outside it. This verifies the mutation boundary;
  it does not validate InternSG's license or reproduce its activation failure.
- Focused backend compatibility batch: **46 passed** (browser assistant,
  extension authentication, reusable profiles, profile-to-application flow and
  job endpoints). Frontend lint/build, extension syntax and whitespace checks
  also passed. These are current focused results, not a new full-backend count.
- Incremental source review found no confirmed P1/P2 blocker. This is not a full
  security audit. No new public HTTP API or database change was needed for this
  closeout; existing PR #25 authentication and application-availability
  safeguards are preserved.

The installed native Chrome extension's complete 0.8.0 journey remains a manual
verification gap; fixture tests do not close it. No paid model call, CAPTCHA
automation or real employer submission was performed. The temporary test
frontend was stopped, leaving normal user services unchanged.

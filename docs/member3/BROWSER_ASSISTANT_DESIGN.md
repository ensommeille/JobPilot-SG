# Browser assistant surface brief

Mode: Operate. User-approved flow on 2026-10-13. Inherit frontend/src/index.css.

Version 0.5 (2026-10-14): existing ProfilePage layout is preserved with one reusable
application-details section. Optional countries have no inferred defaults. Failed
initial loading blocks saving; failed writes retain user input. Desktop and 390px
mobile screenshots verified alongside persistence/error tests. Extension device
details are now a reviewed import source only, not a second automatic profile.

Version 0.4.1 supersedes optional-summary-generation references below: introductions
are user-written only. Preserve the local reusable-summary editor and account
isolation; remove AI consent and generation controls without changing the layout.

Version 0.4 adds an opt-in original-site iframe within the JobPilot application
route, with explicit third-party disclosure and an always-available original-page
fallback. Loading is not submission. Local-only extension frame targeting uses
explicit host permission and document binding, not a token/message bridge.
The responsive navbar adjustment is scoped to the new page. Existing typography,
colors and buttons are reused; no new visual system or dependencies were added.

## Direction contract

THESIS: Review editable answers before modifying the original application page.
OWN-WORLD: Existing JobPilot teal, off-white surfaces, system sans, plain labeled controls.
STORY: Sign in, inspect the target, optionally request a summary, approve each answer,
fill, and return to the employer-facing page for manual verification and submission.
FIRST VIEWPORT: Compact extension popup with product title, safety boundary, sign-in
or target identification, field editors, and an explicit fill action after approval.
FORM: User-pinned narrow extension; no concept seed or new visual world.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
the verdict, DESIGN.md, and every shipping raster carrying its provenance

No raster assets. Preserve incumbent tokens. Review targets include expired login,
unsupported page, no fields, model failure, navigation, user edits and partial filling.

## Implementation and review evidence

The implemented popup is 420px wide and extends the existing JobPilot identity:
primary teal (#0f6e63), off-white background (#f6f7f5), dark text (#1c2421),
system-ui / Segoe UI sans typography, labeled controls and visible keyboard focus.
Incumbent frontend tokens remain authoritative; this surface record fulfills the
documentation step for the narrow extension without creating a global DESIGN.md.
No raster assets ship in the popup; the screenshots below are review evidence only.

Review evidence (2026-10-13): [login screenshot](../../output/browser-assistant-login.png)
and [answer review screenshot](../../output/browser-assistant-review.png), captured
at the shipped 420px width; detector findings `[]`; 17 Playwright fixture tests passed.
The reviewer verdict is ship within the UI/fixture scope after resolving partial-fill
draft loss: completed fields are disabled, skipped answers retain their drafts and
require renewed confirmation, and remaining drafts stay available in the open popup.

An installed Chrome popup, live InternSG behavior and live DeepSeek generation have
not been validated. These fixture results do not establish live acceptance. No
external application was submitted; CAPTCHA, consent and submission remain manual.
# Version 0.2 scope amendment — 2026-10-13

The user approved local supplementary data storage isolated by API origin and account ID.
Nationality and study-country replacement is now supported together with explicit confirmation;
it is the sole exception to the initial no-overwrite policy. Page changes invalidate that
confirmation. Froala is filled through its page-owned API with escaped plain text and
backing-textarea verification. MAIN-world injection receives only approved answers and
country state, never JWTs or provider keys. CAPTCHA, legal consent and submission stay manual.
This amendment supersedes initial manual-country limitations in the historical design below.

# Version 0.3 scope amendment — explicit single-application submission

The user requested extending the pilot toward submission. A separate final review and
authorization now allows clicking the original site's Submit button after manual CAPTCHA.
This supersedes all earlier blanket no-submit constraints below. Fill and draft operations
still never submit. Local durable attempt reservations prevent automatic retries after
uncertain outcomes. Website messages do not establish delivery; the platform application
status is not changed. No real employer application was sent during development.

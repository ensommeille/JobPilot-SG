# Profile → recommendations → application reuse: flow check

Checkpoint: 2026-10-14. This pass checks the existing end-to-end workflow and fixes
local integration defects. It does not introduce a new public JSON contract,
database schema, model provider, or employer-submission channel.

## Expected user workflow

1. Sign in to JobPilot and maintain the profile: contact details, explicit skills,
   user-written introduction, availability, nationality, and country of study.
   Save before moving to recommendations. Unsaved edits are not recommendation input.
2. Open Jobs and explicitly request recommendations. Review the paired profile/JD
   evidence, then open a job for its full description and optional match analysis.
   After editing the profile, request recommendations or analysis again; existing
   results are snapshots, not a live qualification assessment.
3. Choose the application route actually supported by that job. A canonical InternSG
   application URL opens the embedded original form with an original-page fallback.
   Jobs without a configured platform form no longer advertise the platform AI-form
   entry as if it were available. Unsupported application URLs are not guessed.
4. For InternSG, connect the extension through JobPilot approval when needed; an
   existing valid connection is reused without a second password form. Read the
   application to load the current account's latest saved profile, review or edit
   the proposed answers, and confirm filling. Re-read after changing saved details.
5. Review the original site's actual answers. CAPTCHA, consent, final authorization,
   and external delivery remain separate from profile reuse or recommendation.
   A configured platform/sandbox form instead saves an internal JobPilot record;
   its success screen does not claim delivery to an employer.

## Fixes and safeguards

- **Account-bound operations:** profile loading/saving and configured-form mapping/
  saving pin the initiating credential. Account changes clear private state and
  cancel outstanding requests; late responses cannot populate the new account's
  form or claim its save succeeded. Route changes discard the previous job's form.
  An old request's authentication failure does not sign out a newer session.
- **Connection and embedded privacy:** a pending login replacement cannot overwrite
  an intervening account change. Switching accounts closes the embedded original
  form, requiring an explicit fresh load. Extension operations recheck their
  session after asynchronous boundaries; old callbacks cannot restore private
  drafts or dispatch the next widget write. Already-dispatched external operations
  and already-filled external answers are not rolled back.
- **Application history:** assistant records show "Record saved"; manual entries
  show "Reported applied". Dates are record dates. User-tracked statuses are not
  presented as verified employer receipt or progress.
- **Private responses:** profile GET/PUT and browser draft responses now declare
  `Cache-Control: no-store`. Matching/recommendation responses already do so.
- **Profile maintenance:** labeled controls, bounded skills/text input, link checks,
  validation feedback, and retained edits on save failure improve recovery. Saving
  is blocked after a failed load or account change until the correct profile loads.
- **Preset compatibility:** `Excel (Advanced)` now identifies the named Excel skill,
  retaining the original entry as evidence. The parenthesized level is not verified
  or converted into a qualification claim. Ordinary prose, negative statements,
  and learning-only conflicts do not become affirmative evidence.
- **Fresh application reuse:** each browser draft reads the saved profile, including
  the four reusable application fields. Explicitly clearing a value prevents it
  from appearing in subsequent drafts; old local copies do not silently restore it.
  This does not erase answers already present on an external webpage. Existing
  website content remains protected by the adapter's review/overwrite rules.
- **Configured-form recovery:** unavailable mapping produces a valid empty manual
  draft, so reviewed handwritten answers can still be recorded. Editing every field
  now supplies nonempty confirmed IDs accepted by the existing backend contract.
  A save with an uncertain response asks the user to check application history
  before retrying. Ordinary requests/save have a 15-second timeout; mapping has 60.
  Native field validity is checked before the browser saves a record: malformed
  email/URL answers stay editable and trigger no save request. This client-side
  guard does not change the backend's existing edited-value validation contract.
- **Honest supported controls:** configured platform forms support text, textarea,
  email, tel, URL, number, and date controls without options. Select, file, checkbox,
  other unsupported types, and option-bearing controls fail closed with guidance
  to the original application instructions, instead of being rendered as fake text
  inputs. The current seeded fixture uses text/email/textarea.
- **Scoped interface work:** the existing JobPilot identity is retained. Changes
  focus on operating-state copy, usable entry points, labels, and responsive
  navigation/layout defects; this is not a redesign.

## Verification evidence

The full backend run passed **541 tests**. The five new cross-module API journeys
in `backend/tests/test_profile_to_application_flow.py` exercise:

1. Save/read a profile → evidence-led natural-language recommendation → job detail
   → PKCE extension connection → reuse the same profile on two application URLs.
2. Change skills/contact/application details → fresh recommendations and draft;
   explicitly clear fields → no stale profile fallback.
3. Log out account A → its extension is revoked → account B's recommendations and
   draft contain only B's data.
4. Restricted extension credentials cannot write platform state, access matching/
   recommendations, or select another account through a request field.
5. Change the JD without refreshing extraction → recommendations reject stale
   evidence, while reusable profile data remains intact.

These journeys use isolated databases and synthetic fixtures through the actual
application routes. They assert that draft/recommendation activity creates no
application record or new extraction. They are not employer delivery tests.

Browser validation covered **102 distinct cases**: the full 101-case suite passed,
then the added invalid-email/no-save-request regression passed separately. Isolated
browser cases cover profile/account races, navigation and entry points, mapping
failure, edited-only confirmation, stale mapping/save responses, unsupported
controls, and responsive layouts. The new configured-form file is
`extension/tests/application-form-flow.spec.js`. Browser API responses are fixtures,
not the user's installed Chrome extension or a live employer transaction.

Validation makes no paid model calls and sends no application to a real employer.
Existing real user profiles, production/team databases, and provider credentials
are not changed by these test scenarios. Frontend build and lint passed again after
the last input guard.

The final focused rerun passed all 11 non-screenshot form/history cases, including
the new email guard. Backend Ruff lint, changed-file formatting, extension syntax
checks and git diff whitespace checks also passed. Unrelated repository-wide
formatting drift was not rewritten. Batched desktop/mobile screenshots and an
independent finish review found no blocking in-scope presentation issue.

Read-only replay against the existing local saved JD/extraction data passed eight
additional scenarios: natural-language Excel, AutoCAD, Microsoft Office and Canva
produce evidence-backed candidates; unrelated Python, general traits, negated
Excel and learning-only AutoCAD do not force matches. There are ten non-mock
extractions and one excluded mock fixture. No profiles or stored jobs were changed
by this replay (see ignored output/natural-acceptance.json).

The existing local backend was restarted with the verified code, no migrations
and no paid background work. Health is OK and all 11 existing jobs remain available.
The local launcher rotates its signing key at restart, so existing browser sessions
need one fresh platform sign-in/reconnection. This is a development restart effect,
not a requirement to sign in again for every application. Reload the existing
unpacked extension for 0.6.1. No GitHub commit, push or merge was performed.

## Remaining boundaries

Recommendations still use a bounded explicit-skill vocabulary and current stored
extraction evidence. A shared skill is not proof of proficiency, years, eligibility,
or the entire requirement; no reliable intersection means no forced recommendation.
Resume files and unrelated profile prose are not parsed for recommendation.

Concurrent full-profile PUT edits by the **same account** remain last-write-wins;
this pass adds no optimistic-lock version or merge API. Existing replacement
semantics remain unchanged, including preservation of omitted new application fields.

The configured platform form's provider snapshot still contains the legacy profile
fields. The InternSG browser draft separately includes introduction, availability,
nationality, and study country. This pass does not expand the shared provider
contract or claim that every platform form reuses these newer fields.

Installed-extension acceptance remains manual: confirm the deployed extension ID,
connection permissions, live widget behavior, embedded-page support and browser
policy, actual profile reuse, and CAPTCHA display. A real applicant must review
and authorize any real submission. A saved internal record, filled page, button
click, or frame navigation is not proof that an employer received an application.

Related contracts: [Reusable profile](REUSABLE_PROFILE_CONTRACT.md),
[Extension connection](EXTENSION_AUTH_CONTRACT.md),
[Recommendations](RECOMMENDATIONS_CONTRACT.md), and
[Match analysis](MATCH_ANALYSIS_CONTRACT.md).

## PR publication verification

The subsequent publishing pass reran all 541 backend tests with branch coverage:
92.66%, above the unchanged 85% CI gate. The CI-equivalent browser command passed
99 cases; three optional downloaded-widget-library checks are explicitly skipped
when WIDGET_ASSET_DIR is absent. Those three were covered in the earlier local
verification. All frontend journey suites now run in CI: the extension job installs
and starts Vite with a fixture API URL, rather than silently skipping these suites.
No API keys or production backend are needed. Extension npm audit found zero
vulnerabilities. This checkpoint is being submitted on a feature branch for review,
not merged directly into main.

## Clean deployment follow-up

The subsequent clean-deployment pass verified a new PostgreSQL volume and actual
HTTP routes in isolated Docker services, including persistent profile updates,
recommendation states, PKCE connection, draft reuse and logout revocation. See
[Clean deployment acceptance](CLEAN_DEPLOYMENT_ACCEPTANCE.md) for the exact fixes,
test counts, deployment origins and reproducible commands. No model was called and
no application was submitted to an employer.

Installed Chrome acceptance is still incomplete. Computer Use stopped the browser
part of this pass because it could not reliably determine the current browser URL.
No later browser input was issued in that turn. The container/API checks do not
prove extension loading, permission prompts, popup operation or live InternSG
widget compatibility. Existing local user data and development services were not
replaced by the disposable deployment.

## PR 25 integration verification (14 October 2026)

PR #25 was reviewed, received a scoped favorite-session fix, and merged through
normal approval and eight successful CI checks as main commit `f7b394e`. PR #28
then merged that main history without rebasing or force-pushing. The three
conflicts were resolved in authentication dependencies, frontend session helpers,
and job details; both PRs' functionality was retained.

Job details now refresh account-specific favorite state after a session or route
change. Requests retain their original credentials, stale responses cannot replace
the new account's state, and failures remain retryable. The authoritative
`assistant_form_available` flag controls the configured platform form, with a
compatibility lookup only when the field is missing. A false flag does not disable
the distinct InternSG original-form flow. Closed jobs remain blocked.

Optional job-detail authentication uses the same active-user and revoked-token
checks as required authentication. Restricted extension credentials remain limited
to their browser-assistant endpoints. Platform logout still revokes extension
grants. No additional migration or provider-contract change was introduced by this
integration; PR #28's already-proposed profile and extension-auth migrations remain.

Local verification passed 570 backend tests with 92.67% branch-enabled coverage,
117 isolated Chromium tests (including the three downloaded widget-library cases),
frontend build and ESLint, backend Ruff, extension syntax checks, and both npm
audits with zero reported vulnerabilities. New regression coverage includes
cross-tab account changes, delayed responses, anonymous access, restricted-token
scope, logout revocation, nested job serialization, and application availability.
Two old UI assertions expected an account-change banner that is now cleared by
the page remount; they were replaced with stronger checks for removal of unique
private evidence and the credentials used by a fresh explicit analysis.

Desktop/mobile fixture inspection confirmed the existing #28 responsive navigation
was retained. This was a scoped integration review, not a full security audit.
These browser tests do not establish installed Chrome extension acceptance or
real employer delivery. No paid model request or real application was sent.

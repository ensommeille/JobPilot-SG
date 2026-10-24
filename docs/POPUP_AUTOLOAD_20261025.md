# Local extension 0.9.2 — automatic preview, explicit Fill

The connected extension now loads the current supported application and saved
PDF/Profile facts when the popup opens. The normal path is **open -> preview ->
Fill**. Neither previous Read button is visible initially. Refresh form remains
a secondary recovery action after a failed load, stale preview or fill attempt.

## Behavior and boundaries

- Startup and Refresh perform form inspection and free saved-fact GET requests.
  They do not call form-plan, analyze a PDF, request new permissions, attach files,
  change answers or submit applications. Existing dropdown selection guards are
  retained while inspecting options.
- Ordinary fields use the same saved facts and local matching rules. Unfamiliar
  questions remain manual; their copy distinguishes an unmatched question from a
  genuinely missing saved fact. No model is silently called to improve coverage.
- ATS and direct InternSG URLs must match the canonical supported route, scheme,
  host and query/hash rules. Embedded InternSG is limited to the connected
  platform origin and approved application route with existing permission.
  Unrelated sites are not inspected.
- The initial tab and URL are captured before awaits. Responses are checked
  against the active tab and document identity before publication. Fill and
  explicit Attach check the document and fact fingerprint again. Changed or
  obsolete automatic responses cannot publish a usable preview.
- Duplicate connection events do not repeat the scan. A new account waits for an
  old operation to finish, discards its result and loads its own facts. An old
  authentication failure cannot sign out the new account.
- Fill approves only the visible snapshot and is the only normal form-writing
  action. PDF attachment remains a separate explicit action; submission stays
  disabled. Existing website answers are preserved.
- The 440px width, 580px cap, single scrolling preview and fixed Fill action remain.

## Verification

All 60 extension Node tests passed. This includes nine tests of the actual popup
entrypoint covering automatic ATS/direct InternSG/approved embedded entry,
duplicate events, account changes, same-URL replacement documents, navigation,
free Refresh, stale fingerprints and explicit Fill. Syntax and diff checks passed.
Relevant Playwright fixtures were updated and syntax checked; Playwright was not
run. No backend or frontend application source changed in this checkpoint, so
their prior test counts are not presented as new runs.

CUA also exercised the actual popup modules served locally with fictional
Chrome/API responses. Without clicking Read, one inspection and one saved-facts
read produced seven ready answers and one deliberately unmatched question. No
fill, file request, paid mapping or permission request happened on opening.
One Fill click filled those seven answers and reported no submission. The
unrelated-page scenario performed no inspection or profile-facts read.
Operations logs and the screenshot are saved under this task's
`outputs/JobPilot_popup_autoload_20261025` directory. These UI stubs do not prove
real Chrome employer-page filling; that post-install check remains pending.

No real applicant data was entered into employer forms, no PDF uploaded, no
application submitted and no paid model called during this checkpoint.

## Installation and handoff

The existing installed 0.9.1 extension was archived before the update. Version
0.9.2 was copied in place with the same ID
`jnhpbdlhnajnomkldhnpdojholeocnlo`; all fourteen runtime files and their relative
imports were verified. The new runtime file is `popup-autoload.js`. Manifest was
copied last; permissions, CSP and connectable origins are unchanged.

Backup/install records outside the repository:
`work/popup-autoload-backup.json` and `work/installed-extension-update-092-record.json`.
Reload the extension in Chrome, refresh the original application page and reopen
the popup. A connected account should see its preview without a Read click.
The local application/API were kept on ports 15523/18523. No deployment or PR
merge was performed, and no serving API restart was needed for this JS-only change.

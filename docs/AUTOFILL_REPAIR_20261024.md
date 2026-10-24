# Local 0.9.1: Greenhouse reader and one-step PDF preparation

This supersedes the 0.9.0 UI and reader checkpoint for the reported defects.
It does not constitute real Chrome acceptance after the fix, deployment or merge.

## Reported failure and verified cause

The user reported the original Greenhouse form at
https://job-boards.greenhouse.io/simplifynext/jobs/5026256007 while the extension
incorrectly reported that no supported form existed. Anonymous read-only DOM
inspection confirmed a valid `form#application-form`, named identity controls
and unnamed React-select validation helpers. Those helpers have no name/id,
`aria-hidden=true`, opacity zero and tabindex -1, but have client rectangles.

The reader's `keyOf` used `ashby && node.closest(...)` followed by
`row?.getAttribute(...)`. On Greenhouse, `row` was boolean false, and optional
chaining did not make its nonexistent method callable. The lookup of all keys
therefore threw `row?.getAttribute is not a function` while inspecting an otherwise
valid form. Chrome's missing result was then misreported by the old generic guard.

The regression now executes the actual serialized reader with the observed
unnamed helper structure, passes its result through a Chrome-style JSON wrapper,
and invokes the real popup parser and fact projection. It fails with the original
code and passes with the fix. The fix uses a null DOM-node fallback, excludes
non-answer helper controls, reports safe stage/code errors, retains document/URL
binding, and does not loosen supported-site restrictions. One unchanged dropdown
read failure need not discard usable name/email fields; an actual selection
mutation still fails closed. The public Chrome scripting API is documented at
[Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/scripting).

The same public DOM also exposed a separate CV targeting defect: file inputs are
labelled only `Attach`. The unique `#resume` field is now linked to the explicit
`#upload-label-resume` Resume/CV caption inside its own single-file `.file-upload`
wrapper. Cover-letter and transcript controls are not treated as CV targets.

## UI and reuse changes

- The extension root and body declare a definite 440px intrinsic width, without
  a viewport-relative body max-width that can preserve Chrome's narrow initial
  sizing. The 580px cap, single scrolling content region and fixed Fill action
  remain. A long fictional account was visually checked in the local popup.
- A new upload now performs save -> one explicit analysis -> free facts refresh.
  The file input explains AI use and possible billing before selection. There is
  no second Read for autofill action for a newly uploaded PDF.
- A deliberate saved-PDF selection reuses ready answers or prepares an unread PDF
  once. Opening Profile and refreshing are GET-only. An initially saved unread
  legacy file has a recovery Use this PDF action; ready/failed files do not show
  that CTA. Failed/interrupted preparation retains the file without auto-retry.
- A shared per-account UI action gate prevents upload and selection from starting
  competing analyses. The backend now serializes owner/hash reservations across
  different resume IDs too; real separate-session concurrency tests prove one
  call and one 409, then free reuse. Independently reviewed same-hash records take
  priority and retain their review metadata separately from the original output.
- The extension's Read form action remains explicit: it inspects the current
  employer form and can map unfamiliar questions. It does not re-extract the PDF.

## Verification

- 121 selected backend tests passed, including separate-session concurrent
  same-document and same-hash different-document reservations and review reuse.
- 48 extension Node tests passed, including serialized-reader/Chrome-result/
  popup-parser integration and the exact Greenhouse attachment caption structure.
- Frontend TypeScript, ESLint and production build passed; current production
  assets are `index-WYqhNoPt.js` and `index-D1EE5oiv.css` (140 modules).
- Relevant browser spec syntax, Node syntax, Ruff, detector and diff checks passed.
  Full Playwright was not run.
- The actual frontend was separately built against a loopback-only fictional API
  on port 15525. CUA selected one generated fictional PDF through the real file
  chooser. The trace proved one upload POST, one analysis POST, automatic facts
  refresh and nine synthetic ready answers. A later refresh made only a GET.
  The fixture has no model, upstream API or real database. No original user PDF
  was uploaded during this verification.
- Desktop and 390px Profile checks found no horizontal overflow or Read for
  autofill button after completion. The actual popup modules with fictional
  Chrome/API responses measured root/body width 440px and height 580px with a
  long account. These UI fixtures do not prove real employer-page injection.
- The real saved PDF remains selected and ready after the serving API restart.
  No additional paid model call or business-data correction was made by the
  agent in this repair. The successful user-triggered PDF analysis present before
  the repair was preserved.

## Handoff

The installed directory was backed up before replacement, then updated to 0.9.1
in place, retaining extension ID `jnhpbdlhnajnomkldhnpdojholeocnlo`. Thirteen runtime
files were hash-verified; manifest copied last. Permissions, CSP and connectable
origins did not change. Backup and installation records are outside the repository
at `work/autofill-repair-backup.json` and
`work/installed-extension-update-091-record.json` in this task workspace.

The production local UI/API remain at ports 15523/18523. Reload the Chrome
extension, refresh the original Greenhouse form and reopen the popup for the real
post-fix check. The saved PDF need not be uploaded or analyzed again. If the local
service restart invalidated the platform login, use the existing account.

No deployment, PR merge, employer email, real employer PDF upload or application
submission was performed. The separate UI fixture servers are stopped after QA.

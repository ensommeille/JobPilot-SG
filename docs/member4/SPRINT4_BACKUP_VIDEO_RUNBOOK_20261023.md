# Sprint 4 presentation backup recordings — capture checklist

Prepared 23 Oct 2026. **No recording is attached yet.** Capture both videos from
the final pinned demo build after the team approves the sequence. A slide deck,
test screenshot or synthetic form-fill log is not a substitute for a video.

## Before both recordings

1. Agree on one repository commit and one demo configuration; show the commit
   SHA at the start of each recording. Do not describe a Draft PR as merged.
2. Use only a disposable applicant account, fictional profile and public job
   descriptions. Hide API keys, tokens, real resumes, private e-mail and host
   credentials. Do not show CAPTCHA answers.
3. Rehearse full-screen browser zoom, audio, cursor visibility and slide
   switching. Record the date and the build/branch in a title card.
4. Play each exported MP4 from start to finish, with sound, on the presentation
   laptop; note duration, format and file checksum in the table below.

## Video A — CI/CD, target 10–12 minutes

| Time | Show | Verification line |
| --- | --- | --- |
| 0:00–1:00 | Pinned commit, PR and branch | Which code the run tested; merged versus Draft |
| 1:00–4:00 | GitHub Actions workflow and one completed run | Backend, frontend, security and container jobs; no secrets in logs |
| 4:00–6:30 | One test/report and its code change | What passed and what the test does **not** prove |
| 6:30–9:30 | Local Compose startup and `/health` | Local service health only; scheduler optional, team host unverified |
| 9:30–11:30 | Failure/recovery explanation and summary | A green pipeline is not production deployment |

## Video B — system demonstration, target 12–15 minutes

| Time | Show | Safety / evidence line |
| --- | --- | --- |
| 0:00–2:00 | Disposable sign-in and profile | Synthetic account, no private resume |
| 2:00–5:00 | Public job source, search/filter, favorite | Original source URL and job status |
| 5:00–8:00 | Source-backed comparison | Pending human review; unknown is not a failed qualification |
| 8:00–11:00 | Draft/review form in JobPilot | Draft is not an employer application |
| 11:00–13:30 | Installed extension on supported original form | Fill fictional fields only; show CAPTCHA empty and no Submit click |
| 13:30–15:00 | History/admin status and boundaries | No employer submission; scheduler local only if still so |

For the external form, use a page where the company has not removed the form;
confirm in advance that a fictional value cannot be mistaken for a real
application. Stop before CAPTCHA and final Submit. If the page has changed,
demonstrate the sandbox flow and label the limitation instead of improvising.

## Recording acceptance

| File | Date and pinned SHA | Duration | Playback checked by | SHA-256 |
| --- | --- | --- | --- | --- |
| CI/CD backup MP4 | **Pending** | **Pending** | **Pending** | **Pending** |
| System backup MP4 | **Pending** | **Pending** | **Pending** | **Pending** |

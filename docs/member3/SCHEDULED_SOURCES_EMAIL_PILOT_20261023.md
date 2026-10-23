# Scheduled sources and email application pilot

This change is implemented and verified locally against `7d1d6fe493d2a992ebcc13118f1c4fcd8271fabf`. It has not been deployed, pushed or merged. It does not require a model call.

## Source refresh

`python -m app.ingestion.scheduler --once|--loop --actor-id ADMIN_UUID` is an explicit worker, separate from FastAPI. It runs enabled sources whose stored `next_run_at` is due. Supported intervals are `every:6h`, `every:24h` and manual operation. Old arbitrary cron strings remain manual-only; new unsupported schedules are rejected.

Manual and scheduled collection share a database lease, renewable heartbeat and owner fencing. A crashed worker can be recovered without allowing its old process to overwrite newer results. Source configuration and final publication serialize their state updates. Disabling a source prevents new runs; a batch already in progress may finish saving, while the source remains disabled with no next scheduled time.

Successful checks update source and job timestamps. Metadata changes, including application URL and location, are saved even if the description hash is unchanged. A complete, successful, nonempty JSON feed can close disappeared jobs within this adapter's selected scope. Failed, empty, truncated or partial feeds preserve prior jobs. A refresh is not an extraction or recommendation and does not call an LLM.

The jobs page exposes successful-check and next-due times, source provider and active listing counts through `GET /job-sources/status`; diagnostic errors and private configuration remain admin-only. The worker must remain running on an awake computer. No OS task or hosted scheduler is installed by this change.

## Additional employer boards

The public ATS adapter now supports Ashby alongside Greenhouse and Lever. The reviewed catalog is explicit and opt-in, rather than an instruction to contact every board. Singapore location must appear in source location fields. Senior titles and unlisted Ashby posts are excluded. An internship marked full-time remains an internship. Identity uses source plus external posting ID.

Collection uses exact official HTTPS API hosts, bounded streamed responses, no redirects, and no requests to application pages. Ashby's exact published posting API has a narrow documented API access rule because its `robots.txt` returns 401; this does not bypass a 401/403 from the posting API or relax other providers' controls.

Fresh local collection on 23 October 2026 succeeded for four explicitly selected boards:

- BlockTech, Ashby: 3 Singapore early-career listings.
- Cantina, Ashby: 2.
- StraitsX, Greenhouse: 2.
- Graviton Research Capital campus, Greenhouse: 5.

These 12 listings include software, machine learning, quantitative and sales roles. They are not 12 software vacancies. Existing catalog entries such as InternSG and Lever remain available but were not fetched by this acceptance run. ATS application links continue to use their original application channels; this change does not claim native submission to Ashby, Greenhouse or Lever.

## Email application pilot

The official [SP Group careers page](https://www.spgroup.com.sg/about-us/careers) advertises an internship programme including Computing and Infocomm Technology and explicitly asks applicants to send their CV to its published internship email. The checked text and observation time are saved in `examples/sp-group-email-programme.json`. This is a programme entry, not an individually advertised software-engineer vacancy. Reopening the local workspace preserves that observation time instead of claiming a new check.

An admin-owned `EmailApplicationPolicy` links a posting to the verified instruction and address. Ordinary users cannot select a destination. A user edits the subject and message, attaches actual PDF bytes, saves, reviews the exact message and recipient, and explicitly confirms before sending. Resume filename metadata alone is insufficient. Edits, attachment changes, policy changes, source changes, contact changes or configuration changes invalidate the review token. Drafts and sent records belong to the authenticated account.

The default transport is disabled. The only enabled transport implemented here is `test_smtp`: numeric loopback SMTP, a fixed `.test` recipient, fixed sender, and no CC/BCC. It cannot be configured to send this pilot to the employer's address. A durable sending state and atomic transition prevent duplicate sends. Failed or ambiguous deliveries are not automatically retried. The UI distinguishes test mailbox acceptance from employer receipt.

Environment for the local pilot:

```text
JOBPILOT_EMAIL_MODE=test_smtp
JOBPILOT_TEST_SMTP_HOST=127.0.0.1
JOBPILOT_TEST_SMTP_PORT=1027
JOBPILOT_TEST_SMTP_RECIPIENT=applications@jobpilot.test
```

The stdlib `scripts/local_test_mailbox.py` performs actual loopback SMTP and persists MIME `.eml` plus envelope/hash JSON receipts. It has no relay. PDF upload is limited to 2 MiB with filename and basic PDF structure checks; this is not a claim of comprehensive PDF malware scanning.

## Reproduce locally

Use the normal backend environment and frontend dependencies. The acceptance helper creates a separate owned SQLite directory, synthetic bootstrap admin, random in-memory JWT secret and no model credentials. It refuses unrelated existing directories and never resets an owned database on resume.

1. In the repository root, create the new workspace and perform the four explicit read-only collections once:

   ```powershell
   python scripts/local_feature_workspace.py --workspace C:/ABSOLUTE/NEW/jobpilot-feature-acceptance --api-port 18523 --web-origin http://127.0.0.1:15523 --smtp-port 1027 --collect-live --seed-only
   ```

2. In another terminal, start the local mailbox after the workspace exists:

   ```powershell
   python scripts/local_test_mailbox.py --host 127.0.0.1 --port 1027 --directory C:/ABSOLUTE/NEW/jobpilot-feature-acceptance/mailbox
   ```

3. Resume the same API workspace without `--collect-live`:

   ```powershell
   python scripts/local_feature_workspace.py --workspace C:/ABSOLUTE/NEW/jobpilot-feature-acceptance --api-port 18523 --web-origin http://127.0.0.1:15523 --smtp-port 1027
   ```

4. In `frontend`, build with `VITE_API_BASE_URL=http://127.0.0.1:18523` and run `npm run preview -- --host 127.0.0.1 --port 15523 --strictPort`. Register an ordinary fictional test user, save their profile and open the SP Group programme. Select an actual fictional PDF, review, then send only to the displayed `.test` inbox. Confirm MIME bytes and the saved application record.

5. For scheduled operation, use a separate backend terminal with `DATABASE_URL` pointing to that workspace's `local.sqlite`, and the `admin_id` from its `seed.json`. Run `python -m app.ingestion.scheduler --loop --actor-id ADMIN_UUID --poll-seconds 60`. Configure model execution disabled. Do not point this acceptance worker at a production database. Fresh import sets next due to six hours later; repeated immediate ticks should print `[]` and add no crawl.

The serving helper blocks outbound networking after its one explicit seed phase; loopback SMTP remains possible. The separate scheduler is responsible for later public feed updates. Restarting the helper generates a fresh JWT secret, so existing test users must sign in again; their saved account data and email history persist.

## Acceptance evidence and limits

The delivered local evidence directory contains full test results, coverage, screenshots, public-source state and two independent MIME checks. An independent HTTP-only harness created ordinary A/B accounts and tested ownership, attachment bytes, stale review, recipient/confirmation injection, persistence and concurrent sending. Two simultaneous send requests returned 200 and 409 and produced one matching message. A separate browser account completed the same workflow; editing after preview removed the review and required a fresh review. The browser's final body and PDF were independently checked against the actual received MIME.

The actual worker loop ran repeated not-yet-due checks without increasing the four crawl rows. Due-time progression, lease contention, crash recovery, disabled-source concurrency and incomplete-feed retention are automated test cases. The local run did not wait six real hours and does not establish hosted uptime. No real employer was contacted, no paid model call was made, and no deployment configuration or PR merge was performed. Real employer SMTP delivery is a future integration, outside this test-only pilot.

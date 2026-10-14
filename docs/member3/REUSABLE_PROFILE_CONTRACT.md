# Reusable application profile — v0.5.0

Current flow verification and session hardening: [PROFILE_APPLICATION_FLOW_CHECK.md](PROFILE_APPLICATION_FLOW_CHECK.md).
The profile JSON fields below remain unchanged. Platform-approved extension
connection is now supported under [EXTENSION_AUTH_CONTRACT.md](EXTENSION_AUTH_CONTRACT.md);
the original v0.5.0 rollout notes below are historical.

Approved scope: 2026-10-14. Maintain application details once on JobPilot and reuse
them in the InternSG adapter. No authentication bridge or application-status change.

## Public profile additions

GET/PUT `/profile` now expose four nullable optional fields:

- `resume_summary`: user-authored plain text, at most 3,000 characters.
- `availability_period`: user-authored availability, at most 500 characters.
- `nationality`: lowercase ISO alpha-2 country code, or null.
- `study_country`: lowercase ISO alpha-2 country code, or null.

Uppercase country codes normalize to lowercase; unsupported codes fail validation.
Blank text normalizes to null. No country or introduction is inferred/generated.
Explicit null clears a field. An omitted NEW field preserves its stored value so
old clients cannot accidentally clear it. Existing fields retain the previous PUT
replacement behavior; this is not a general PATCH conversion. Concurrent full
profile edits remain last-write-wins; no general optimistic-locking API is claimed.

## Explicit import

POST `/profile/import-local`, using existing Bearer authentication:

```json
{
  "confirmed": true,
  "resume_summary": "My own introduction",
  "availability_period": "January to March 2027",
  "nationality": "cn",
  "study_country": "sg",
  "phone": "+65 0000 0000"
}
```

Only `confirmed: true` is accepted; other fields are optional, unknown fields are
rejected and no target account ID is accepted. The sample is fictional, not an
employer submission. Conditional database updates write only NULL destinations;
existing values are never overwritten. Blank incoming values are ignored. The
response contains `imported` and `skipped` field-name arrays, not private contents.
The operation commits all valid updates together; repeat imports preserve values.
No local data is uploaded merely by login, page inspection or saving a device copy.

## Browser adapter

POST `/browser-assistant/draft` returns `profile_source: "jobpilot"`, authenticated
profile `values`, and `countries: {nationality, campus}`. Text values respect the
requested field allowlist; the extension requests all five supported text fields
so a rich-text-only editor is also populated. No LLM calls. Approval before filling
is still required. Country codes not offered by a website require manual selection.

The extension refreshes the source on every read, with no old-device fallback.
Clearing a platform field therefore keeps it blank on the next application.
Per-application edits do not change saved profile data. Local copies remain for
explicit reviewed import and can be deleted separately. Sessions remain separate.

## Rollout and rollback

1. Back up the target database. Inspect migration heads before merging with team work.
2. Apply Alembic `20261014_0003` (parent `20260926_0002`). It adds nullable columns,
   without backfilling or changing existing records. Run `alembic upgrade head`.
3. Start the new backend, then deploy frontend and reload extension v0.5.0.
4. Test profile save/read, old-client preservation, explicit clear, account isolation,
   import conflict skipping and reuse on a second application.

An old backend is detected by the new UI/extension rather than silently accepting
unsupported profile reuse. Application rollback should normally leave the additive
columns in place. Migration downgrade deletes these FOUR NEW columns and their
contents: back them up first. Existing profile fields are preserved by downgrade.
SQLite upgrade/downgrade and PostgreSQL SQL compilation are tested; live PostgreSQL
migration/concurrency and installed Chrome acceptance remain team verification items.

## Local demo

The existing isolated SQLite demo was backed up and upgraded; accounts and prior
profile data were preserved. The backend restarts with a new session signing key,
so users must log in again. Frontend: `http://127.0.0.1:5173/profile`;
backend: `http://127.0.0.1:8001`. No production/team database was migrated.
No GitHub push or real application submission is part of this change.

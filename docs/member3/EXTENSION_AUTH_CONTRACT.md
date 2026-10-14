# Extension connection contract — v0.6.0

## Scope and compatibility

The user approved additive auth endpoints and two database tables for connecting
the browser assistant to an already authenticated JobPilot account. Existing
`POST /auth/login` payload/response and platform JWT consumers remain compatible.
Platform JWTs gain a unique `jti` claim; older unexpired tokens remain accepted.
CurrentUser now checks server-side revocation. Apply migrations before starting
this backend. No member 4 LLM contract is changed; no paid model calls are used.

## User flow

The popup requests API permission and opens the fixed platform connection page.
That page verifies the logged-in account and asks for explicit connection approval.
The backend returns a 90-second, single-use authorization code bound to a SHA-256
PKCE challenge, account, platform token and registered extension ID. The extension
exchanges it using a secret verifier held only in trusted session storage.
The webpage receives only completion status, never the extension token/verifier.
The platform JWT is sent only to its backend, never to the extension or InternSG.

The extension's opaque `jpx_` credential expires at the earlier of eight hours or
the parent JWT expiry. There is no automatic refresh. Reopening the popup reuses
the browser session; expiry/browser restart needs a new platform confirmation.
If the platform remains logged in, reconnecting does not require entering a password.
Each protected popup action revalidates the connection; offline validation blocks
the action. Existing page contents are not erased when a session is revoked.

## Additive HTTP endpoints

- `POST /auth/extension/authorize`: platform bearer + exact allowed Origin.
  JSON: `client_id`, `challenge` (43-character S256), `confirmed: true`.
  Returns `code`, `expires_in`. Unregistered ID/origin: 403; limit: 429.
- `POST /auth/extension/exchange`: JSON `client_id`, `code`, `verifier`;
  no platform bearer. Returns `access_token`, `token_type`, `user_id`,
  `email`, `expires_at`, `scopes`. Invalid/expired/replayed authorization: 401.
- `GET /auth/extension/session`: opaque bearer; returns identity and expiry.
- `POST /auth/extension/disconnect`: opaque bearer; revokes that grant, 204.
- `POST /auth/logout`: platform bearer; revokes that JWT and all its grants, 204.
  Already revoked/expired credentials return 401, treated by the UI as signed out.

All successful auth responses are no-store. Codes and credentials are stored as
SHA-256 digests in `extension_grants`; `revoked_access_tokens` stores parent token
digests and expiry. Conditional database updates allow only one code redemption.
Unexpired grants are capped at 20 per platform token, including revoked grants.
Old grant/revocation rows currently remain for retention; an operational cleanup
may delete expired rows only. No raw credential should be logged.

Only `POST /browser-assistant/draft` and `POST /profile/import-local` opt into the
restricted bearer, besides session/disconnect. Import still requires explicit
confirmation and fills empty fields only. Profile PUT, users/me, admin and other
platform endpoints reject opaque credentials. Removing an ID from the allowlist
also invalidates its sessions on subsequent validation.

## Deployment and migration

1. Back up the existing database and run `alembic upgrade head`.
   Revision `20261014_0004` follows the reusable-profile revision `20261014_0003`.
2. Set `EXTENSION_CLIENT_IDS` to a JSON list of actual installed/published IDs.
   The default is empty: fail closed. Do not change an unpacked extension's ID
   merely to match a test fixture; this would lose access to its existing storage.
3. Configure exact `EXTENSION_WEB_ORIGINS`, backend CORS, extension
   `connection.js` deployment pairs, and manifest externally_connectable patterns
   together for a new deployment. Remote deployment must use HTTPS.
4. Reload the existing extension directory, retaining its ID and local data.
5. Platform logout must call the new endpoint before clearing its token.
   Network/server failure leaves the platform signed in with a retry message;
   it must not claim that revocation succeeded. The UI also clears extension
   state by a trusted-origin message. Server revocation remains authoritative.

Disconnect revokes only the extension. Platform logout revokes only the current
platform token and its children, not other device logins. Account switching through
the supplied login flow revokes the previous token before saving the next.
Cross-tab token changes clear the extension's local connection. Direct manipulation
of localStorage by unrelated code is not a substitute for server logout.

Rollback: prefer retaining additive tables. Downgrading drops grant/revocation
records; rolling back the revocation-aware backend may re-enable old JWTs. Rotate
the signing key to invalidate tokens before such an auth rollback.

## Trust boundary and verification

Runtime messages require an exact deployment origin, top frame, connection path,
initiating tab, random state and five-minute local pending lifetime. The code is
not placed in a URL; the fragment contains only extension ID/state. API endpoints
are fixed in the extension, never selected by a webpage. Service-worker operations
are serialized with a Web Lock. Arbitrary pages, sibling tabs and other extensions
cannot complete a pending connection.

Tests cover backend scope isolation, PKCE mismatch/replay/expiry, disabled users,
logout/disconnect, allowlist removal, concurrent code redemption, old login response
compatibility, connection-message trust boundaries, explicit UI confirmation,
logout failure/retry and existing fill/profile behaviors. Browser fixture tests
do not constitute verification in the user's installed Chrome extension or proof
of employer delivery. No test submits to a real employer.

Chrome references: [Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
and [externally_connectable](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable).

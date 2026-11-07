# Paynamics Checkout (Workflow) — IBMC staging

BNI’s Paynamics onboarding specifies **Paynamics Checkout (Workflow)** — REST JSON with HTTP Basic authentication — not the legacy Responsive Payment Frontend (RPF) XML flow.

Official references in-repo:

- Sanitized Postman collection: `docs/paynamics/workflow.postman_collection.sanitized.json` (merchant credentials removed).
- Field notes: derived from that collection and TJ’s sanitized research notes.

Paynamics Wiki (`https://wiki.paynamics.net/en/API_Paygate`) sections **10.1–10.3** (create), **10.8–10.10** (query), and notification verification are **not** in the sanitized bundle. Do not assume sandbox/production hostname from examples alone.

## API shape (verified from Postman)

| Call | Method | Path |
| --- | --- | --- |
| Create transaction (`payment_action`: `url_link`) | `POST` | `{PAYNAMICS_API_BASE_URL}/paygate/transactions/` |
| Query status | `POST` | `{PAYNAMICS_API_BASE_URL}/paygate/transactions/query` |

Collection variable example host: `https://payin.payserv.net` — **sandbox vs production status UNCONFIRMED**. This repo **does not** call any Paynamics host until operators explicitly confirm account + host.

### SHA-512 signature concatenation (hex)

**Transaction** (Postman pre-request script):

`merchantid + request_id + notification_url + response_url + cancel_url + pmethod + payment_action + schedule + collection_method + deferred_period + deferred_time + dp_balance_info + amount + currency + descriptor_note + payment_notification_status + payment_notification_channel + mkey`

**Customer info:**

`fname + lname + mname + email + phone + mobile + dob + mkey`

**Query:**

`merchantid + request_id + org_trxid2 + mkey`

### Auth

- HTTP **Basic** (`PAYNAMICS_BASIC_AUTH_USER` / `PAYNAMICS_BASIC_AUTH_PASSWORD`) on API calls.
- `merchantid` + `mkey` used in signatures (collection variables); not a substitute for Basic auth.

## Fail-closed gates (server)

Live Paynamics HTTP is allowed only when **all** are set:

| Variable | Purpose |
| --- | --- |
| `PAYNAMICS_API_CALLS_ENABLED` | `true` — explicit opt-in to outbound API |
| `PAYNAMICS_API_ACCOUNT_CONFIRMED` | `true` — operator confirms correct sandbox/live host for BNI |
| `PAYNAMICS_API_BASE_URL` | Confirmed base URL (no default that triggers calls) |
| `PAYNAMICS_API_ENV` | `sandbox` unless `PAYNAMICS_ALLOW_PRODUCTION=true` |
| `PAYNAMICS_BASIC_AUTH_USER` / `PAYNAMICS_BASIC_AUTH_PASSWORD` | Wiki Basic credentials |
| `PAYNAMICS_MERCHANT_ID` / `PAYNAMICS_MERCHANT_KEY` | Signature `merchantid` / `mkey` |

Without these, checkout returns **503** and **no** provider request is sent.

## Settlement (fail-closed)

- Browser **return URL does not** mark payments paid.
- **Webhook** (`POST /api/webhooks/paynamics`): acknowledges valid JSON where possible; **does not settle** unless a verified notification contract is configured.
- Incoming **notification signature verification** is **not** defined in the sanitized Postman export. `PAYNAMICS_NOTIFICATION_VERIFY_CONTRACT` must be set from Paynamics Wiki / appsupport — until then `PAYNAMICS_SETTLEMENT_ENABLED` has no effect for real traffic.
- **Query reconciliation** may refresh status fields when API calls are enabled; query **response** verification is likewise **unverified** — query does not settle by default.

Mocked tests use `PAYNAMICS_NOTIFICATION_VERIFY_CONTRACT=workflow_mock_test_only` with `PAYNAMICS_ALLOW_TEST_SETTLEMENT=true` (CI only).

## Staging URLs (from `PUBLIC_WEB_URL`)

| Purpose | Path |
| --- | --- |
| Notification webhook | `{PUBLIC_WEB_URL}/api/webhooks/paynamics` |
| Buyer return (UX only) | `{PUBLIC_WEB_URL}/register?paynamicsRequest={request_id}` |
| Cancel (optional override) | `{PUBLIC_WEB_URL}/register` |

Exact host pending staging `PUBLIC_WEB_URL`.

## Configuration names (values via secrets only)

| Variable | Notes |
| --- | --- |
| `PAYNAMICS_PMETHOD` / `PAYNAMICS_PCHANNEL` | Confirm BNI-enabled codes with Paynamics (e.g. wallet `gc`, online banking channels in Postman) |
| `PAYNAMICS_COLLECTION_METHOD` | Default `single_pay` |
| `PAYNAMICS_PAYMENT_NOTIFICATION_STATUS` / `_CHANNEL` | Default `1` per collection samples |
| `PAYNAMICS_DESCRIPTOR` | Statement descriptor text |
| `PAYNAMICS_NOTIFICATION_URL` / `PAYNAMICS_CANCEL_URL` | Optional overrides |
| `PAYNAMICS_SETTLEMENT_ENABLED` | `true` only after verified notification contract |
| `PAYNAMICS_NOTIFICATION_VERIFY_CONTRACT` | e.g. wiki contract id once documented |
| `PAYNAMICS_QUERY_SETTLEMENT_ENABLED` | Off until query response verification is documented |

### Unverified (needs Paynamics Wiki / appsupport)

- Whether `https://payin.payserv.net` is BNI **test** or **live**
- Create-response field name for hosted link (code checks common keys; confirm §10.2)
- **Notification** payload JSON schema and **signature** rules
- **Query response** signature and settle rules
- IP / URL whitelist requirements — **not** stated in TJ’s onboarding emails; treat as **clarification** with Paynamics, not a documented mandatory step here

## Hosted link extraction

After create, the server looks for an HTTPS URL in candidate response fields (`redirect_url`, `payment_url`, nested `transaction.*`, etc.). If none, checkout fails closed.

## Admin

Enable **Paynamics** under Admin → Settings → Payment channels after configuration gates pass.

## Verification

| Command | Scope |
| --- | --- |
| `npm run verify:paynamics` | Mocked Workflow signatures, fail-closed gates, amount mismatch, unverified notification (no settle), test-only verified settle, replay/idempotency |
| `node server/verify-payments.js` | UPay / HitPay regression |

Provider sandbox E2E requires confirmed host + credentials + notification contract from Paynamics.

## Railway staging (non-production)

1. Deploy this branch to a staging service (not `main`).
2. Set Workflow env vars after Paynamics confirms sandbox host.
3. Set `PAYNAMICS_API_ACCOUNT_CONFIRMED=true` and `PAYNAMICS_API_CALLS_ENABLED=true` only then.
4. Enable channel in admin; use test products if `ALLOW_TEST_REGISTRATION=true`.

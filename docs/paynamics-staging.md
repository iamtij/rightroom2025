# Paynamics Checkout (Workflow) — IBMC staging

BNI onboarding: **Paynamics Checkout (Workflow)** — REST JSON, HTTP Basic auth, SHA-512 signatures.

Canonical contract extract: `docs/paynamics/wiki-contracts-extract.md`  
Postman reference: `docs/paynamics/workflow.postman_collection.sanitized.json`

## Staging safe mode (shared mail/SMS/backup credentials)

Before Paynamics sandbox testing on Railway staging that still has real Resend, Semaphore, or backup S3 variables, set **`IBMC_STAGING_SAFE_MODE=true`** (`docs/staging-safe-mode.md`). Paynamics Workflow API calls are **not** suppressed.

## Test endpoints (Wiki §1.6 — confirmed)

| Call | URL |
| --- | --- |
| Create | `https://payin.payserv.net/paygate/transactions/` |
| Query | `https://payin.payserv.net/paygate/transactions/query` |

Wiki does **not** publish a Workflow **production** host. User-confirmed pasted prod credentials must **not** be used on this host without a separate Paynamics live endpoint/account.

## Fail-closed API gates

Outbound calls require **all** of:

- `PAYNAMICS_API_CALLS_ENABLED=true`
- `PAYNAMICS_API_ACCOUNT_CONFIRMED=true` (parent confirms BNI **test** package)
- `PAYNAMICS_API_BASE_URL=https://payin.payserv.net` (sandbox mode only matches this origin)
- `PAYNAMICS_API_ENV=sandbox` (required; there is no env override for production or non-test API hosts)
- `PAYNAMICS_BASIC_AUTH_USER` / `PAYNAMICS_BASIC_AUTH_PASSWORD`
- `PAYNAMICS_MERCHANT_ID` / `PAYNAMICS_MERCHANT_KEY` (signatures only — not Basic auth)

## Hosted redirect (§10.2)

- Create response hosted URL is **`payment_action_info`** only (not speculative keys).
- Initial response **§10.3 signature** must validate before redirect.
- **`payment_action_info` is not in the response signature concatenation** — even with a valid signature, redirect only proceeds on **HTTPS** URLs whose host matches `PAYNAMICS_PAYMENT_HOST_ALLOWLIST` (default `payserv.net`).

## Settlement (disabled)

| Path | Behavior |
| --- | --- |
| Browser `response_url` | UX only — never settles |
| `POST /api/webhooks/paynamics` | Updates status fields when merchant/request/amount/currency match; **never** `recordPayment` |
| Query poll | `QM001` = query succeeded, **not paid**; may refresh inner status when present |

There is **no** env flag to enable production settlement. `recordPayment` is only reachable via `settlePaynamics` inside `applyPaynamicsStatus` when both `allowSettle: true` **and** `IBMC_PAYNAMICS_UNIT_TEST_ALLOW_SETTLE=true` (set only in `server/verify-paynamics.js`). HTTP handlers always pass `allowSettle: false`.

Webhook HTTP method, body schema, ACK/retry, and query-**response** signature formula remain **unverified** in wiki — ask Paynamics before enabling settlement.

## Staging URLs (`PUBLIC_WEB_URL`)

| Purpose | Path |
| --- | --- |
| Notification | `{PUBLIC_WEB_URL}/api/webhooks/paynamics` |
| Return (UX) | `{PUBLIC_WEB_URL}/register?paynamicsRequest={request_id}` |
| Cancel | `{PUBLIC_WEB_URL}/register` (override via `PAYNAMICS_CANCEL_URL`) |

## Configuration names (secrets via platform only)

`PAYNAMICS_API_BASE_URL`, `PAYNAMICS_API_CALLS_ENABLED`, `PAYNAMICS_API_ACCOUNT_CONFIRMED`, `PAYNAMICS_API_ENV`, `PAYNAMICS_BASIC_AUTH_USER`, `PAYNAMICS_BASIC_AUTH_PASSWORD`, `PAYNAMICS_MERCHANT_ID`, `PAYNAMICS_MERCHANT_KEY`, `PAYNAMICS_PMETHOD`, `PAYNAMICS_PCHANNEL`, `PAYNAMICS_PAYMENT_HOST_ALLOWLIST`, `PAYNAMICS_NOTIFICATION_URL`, `PAYNAMICS_CANCEL_URL`, billing/descriptor defaults in `.env.example`.

## Provider clarification still needed

1. Notification webhook: HTTP method, JSON schema, required ACK body/status, retry semantics  
2. Query response: authoritative JSON shape for transaction status after `QM001`  
3. Query/notification **response signature** verification rule (§10.9 XML wording vs JSON)  
4. `payment_action_info` length beyond published `ans..50`  
5. Whether amount/currency appear on unsigned notification fields  
6. IP/URL whitelist — **not** in TJ onboarding emails; confirm with Paynamics if required  

## Verification

| Command | Type |
| --- | --- |
| `npm run verify:paynamics` | Mocked: §10.3 signatures, `payment_action_info`, host allowlist, QM001≠paid, settlement disabled, amount/merchant checks |
| `node server/verify-payments.js` | UPay/HitPay regression |

Sandbox E2E: parent provisions **test** Basic auth + merchant id/key on staging after `PAYNAMICS_API_ACCOUNT_CONFIRMED=true`.

## Railway staging (non-production)

1. Deploy PR branch service (not `main`).
2. Set test Workflow vars; **never** prod credentials from user paste.
3. `PAYNAMICS_API_BASE_URL=https://payin.payserv.net`, `PAYNAMICS_API_ENV=sandbox`.
4. Enable Paynamics channel in admin after gates pass.

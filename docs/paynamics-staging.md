# Paynamics Checkout (Workflow) — IBMC staging

BNI onboarding: **Paynamics Checkout (Workflow)** — REST JSON, HTTP Basic auth, SHA-512 signatures.

Canonical contract extract: `docs/paynamics/wiki-contracts-extract.md`  
Postman reference: `docs/paynamics/workflow.postman_collection.sanitized.json`

## Local dev (`npm run dev` on localhost)

Vite serves the UI and mounts the API from the same process (`vite.config.ts` → `createApi()`), so **server env vars come from `.env` in the repo root** (via `dotenv` in `server/api.js`). The browser calls `/api/*` on the same origin (e.g. `http://localhost:3000`).

| Check | Endpoint / action |
| --- | --- |
| Turnstile exposed? | `GET /api/registration-options` → `turnstileConfigured`, `turnstileSiteKey` (empty when either key missing) |
| Paynamics readiness | `GET /api/payment-channels` → `paynamics.checkoutMode` (`off` \| `sandbox` \| `live`), `apiAdmissionAllowed`, `apiAdmissionReason` |
| Channel visible | Paynamics must be **enabled in admin** (`payment_channels`) even when API gates pass |

Paynamics on localhost still requires the fail-closed env gates in this doc (sandbox: `PAYNAMICS_API_CALLS_ENABLED=true`, `PAYNAMICS_API_ACCOUNT_CONFIRMED=true`, `PAYNAMICS_API_BASE_URL=https://payin.payserv.net`, `PAYNAMICS_API_ENV=sandbox`, merchant + Basic auth vars). Set `PUBLIC_WEB_URL=http://localhost:3000` (or your dev port) for return/cancel URLs built by the server.

**Callbacks on localhost:** Paynamics **notification** webhooks (`POST /api/webhooks/paynamics`) need a **public HTTPS URL** Paynamics can reach. A laptop-only `localhost` URL is not reachable from Paynamics’ servers unless you use a tunnel. Return links in the browser can still land on `localhost` for UX; **settlement remains disabled** in this branch (notifications do not `recordPayment`).

**Staging Paynamics checkout tickets (before Nov 11 public windows):** set `ALLOW_TEST_REGISTRATION=true` **and** `IBMC_STAGING_EARLY_PAYMENTS=true` on a **verified staging** deployment (see `server/staging-early-payments.js`). Exposes:

| Product | Checkout |
| --- | --- |
| `test_100` | ₱100 paid in full (new staging choice) |
| `test_200` | ₱200 installment — ₱100 today, then ₱50 day +2 and +3 after registration (existing schedule) |

Legacy `test_50` (₱50) remains for the member TESTING path only; production First Mover / Early Bird `sales_start` and `plans.ts` Nov 11 gate are unchanged. Confirm readiness: `GET /api/registration-options` → `tests: true`, `stagingEarlyPayments.enabled: true`. Admin has **no** product editor — tickets are env-gated seeds only.

## Staging safe mode (shared mail/SMS/backup credentials)

Before Paynamics sandbox testing on Railway staging that still has real Resend, Semaphore, or backup S3 variables, set **`IBMC_STAGING_SAFE_MODE=true`** (`docs/staging-safe-mode.md`). Paynamics Workflow API calls are **not** suppressed.

## Test endpoints (Wiki §1.6 — confirmed)

| Call | URL |
| --- | --- |
| Create | `https://payin.payserv.net/paygate/transactions/` |
| Query | `https://payin.payserv.net/paygate/transactions/query` |

Wiki does **not** publish a Workflow **production** host. User-confirmed pasted prod credentials must **not** be used on this host without a separate Paynamics live endpoint/account.

## Fail-closed API gates

### Sandbox (default)

Outbound calls require **all** of:

- `PAYNAMICS_API_CALLS_ENABLED=true`
- `PAYNAMICS_API_ACCOUNT_CONFIRMED=true` (parent confirms BNI **test** package)
- `PAYNAMICS_API_BASE_URL=https://payin.payserv.net` (wiki §1.6 test origin only)
- `PAYNAMICS_API_ENV=sandbox`
- `PAYNAMICS_BASIC_AUTH_USER` / `PAYNAMICS_BASIC_AUTH_PASSWORD`
- `PAYNAMICS_MERCHANT_ID` / `PAYNAMICS_MERCHANT_KEY` (signatures only — not Basic auth)

### Staging live merchant (real Paynamics charges — TJ testing)

For Railway **staging** when using **live** merchant credentials (real money at Paynamics; IBMC registration settlement still disabled):

| Variable | Purpose |
| --- | --- |
| `IBMC_DEPLOYMENT_ENV=staging` | App label (required when not on Railway) |
| `RAILWAY_ENVIRONMENT` + `RAILWAY_ENVIRONMENT_NAME` | **Authoritative on Railway** — must be staging-like (`staging`, `preview`, `development`, …), not `production` |
| `PAYNAMICS_STAGING_LIVE_MERCHANT=true` | Explicit opt-in |
| `PAYNAMICS_API_LIVE_ACCOUNT_CONFIRMED=true` | Parent confirms live account + endpoint with Paynamics |
| `PAYNAMICS_API_ENV=live` | Live Workflow mode |
| `PAYNAMICS_LIVE_API_ORIGIN_ALLOWLIST` | Comma-separated **exact** HTTPS origin(s) Paynamics provided (no default live URL in repo) |
| `PAYNAMICS_API_BASE_URL` | Must match an allowlisted origin |

**Rejected when Railway reports `production`**, when Railway labels conflict or are unknown/missing (while Railway signals are present), or when `IBMC_DEPLOYMENT_ENV=production`. `IBMC_DEPLOYMENT_ENV=staging` **cannot override** Railway `production`. No arbitrary-host bypass.

`PAYNAMICS_API_BASE_URL` must be a bare **https origin** (no username/password, query, hash, or path). Outbound fetch uses the canonical origin only.

Wiki §1.6 `payin.payserv.net` is the **test** host only — do not treat it as authenticated production. Extend `PAYNAMICS_PAYMENT_HOST_ALLOWLIST` if live hosted pages use a different host.

Checkout/admin show a **real charge** warning when live mode is armed. Use `IBMC_STAGING_SAFE_MODE=true` to suppress mail/SMS/backups while testing.

**Still open:** live Workflow notification URL/ACK, query inner signature after `QM001`, and whether live hosted domains differ from test.

## Hosted redirect (§10.2)

- Create response hosted URL is **`payment_action_info`** only (not speculative keys).
- Initial response **§10.3 signature** must validate before redirect.
- **`payment_action_info` is not in the response signature concatenation** — even with a valid signature, redirect only proceeds on **HTTPS** URLs whose host matches `PAYNAMICS_PAYMENT_HOST_ALLOWLIST` (default `payserv.net`).

## Settlement

| Path | Behavior |
| --- | --- |
| Browser `response_url` | UX only — triggers a status poll, never settles on its own |
| `POST /api/webhooks/paynamics` | §10.3 signature + merchant/request must validate; signed `GR001` with matching amount/currency records payment when settlement is enabled |
| `GET /api/payments/paynamics/:requestId` | Workflow query; outer `QM001` must be signed, inner transaction must be signed; signed inner `GR001` records payment when settlement is enabled |

Settlement is **on** when Paynamics API admission passes (`paynamicsApiCallsAllowed`) and the deployment is not IBMC production. Set `PAYNAMICS_SETTLEMENT_ENABLED=false` to force off, or `PAYNAMICS_SETTLEMENT_ENABLED=true` on production when Paynamics confirms live webhooks.

Notifications may nest fields under `transaction` (Workflow create shape) — the server unwraps that before verification.

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

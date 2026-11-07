# Paynamics staging (IBMC checkout)

This integration uses Paynamics **Paygate Responsive Payment Frontend (RPF) v1.9.11** semantics:

- Checkout: HTTPS POST `paymentrequest` (Base64 XML) to the sandbox frontend URL.
- Settlement: server-to-server POST to the notification URL (`paymentresponse` Base64 XML).
- Browser return URL is for UX only; **payment is recorded only after signature-verified notification**.

Official reference: Paynamics Paygate RPF API (Responsive Payment Frontend). Sandbox frontend default: `https://testpti.payserv.net/webpayment/default.aspx`.

## Staging URLs (derive from `PUBLIC_WEB_URL` / `SITE_URL`)

Set `PUBLIC_WEB_URL` to the staging host (for example a Railway staging service or a hostname containing `staging`).

| Purpose | Path |
| --- | --- |
| Notification (server webhook) | `{PUBLIC_WEB_URL}/api/webhooks/paynamics` |
| Buyer return after Paynamics | `{PUBLIC_WEB_URL}/register?paynamicsRequest={request_id}` |
| Cancel (optional override) | `{PUBLIC_WEB_URL}/register` |

**Pending until staging host is confirmed:** register the exact notification and return URLs with Paynamics and whitelist `PAYNAMICS_MERCHANT_IP` (Railway egress IP or static proxy IP).

## Environment variables (names only — set values in Railway/staging secrets)

| Variable | Required | Purpose |
| --- | ---: | --- |
| `PAYNAMICS_ENV` | yes | `sandbox` (default) or `production` |
| `PAYNAMICS_MERCHANT_ID` | yes | Paygate merchant ID (`mid`) from Paynamics backend |
| `PAYNAMICS_MERCHANT_KEY` | yes | Merchant certificate / key for SHA-512 signatures |
| `PAYNAMICS_MERCHANT_IP` | yes | Outbound IP registered with Paynamics (GR035 if mismatch) |
| `PAYNAMICS_CHECKOUT_URL` | sandbox default | Sandbox: `https://testpti.payserv.net/webpayment/default.aspx` |
| `PUBLIC_WEB_URL` | yes | Canonical HTTPS site URL for callback/return derivation |
| `PAYNAMICS_NOTIFICATION_URL` | no | Override notification URL if needed |
| `PAYNAMICS_CANCEL_URL` | no | Override cancel URL |
| `PAYNAMICS_PMETHOD` | no | Restrict payment methods (Appendix B); **confirm BNI-enabled codes with Paynamics** |
| `PAYNAMICS_SECURE3D` | no | Default `enabled` |
| `PAYNAMICS_CHECKOUT_TTL_MINUTES` | no | Local pending window (default 30) |
| `PAYNAMICS_ALLOW_PRODUCTION` | no | Must be `true` to allow non-sandbox checkout hosts |

Production checkout and live merchant IDs must remain disabled on staging (`PAYNAMICS_ENV=sandbox`, `PAYNAMICS_ALLOW_PRODUCTION` unset).

## BNI / merchant account — what to request from Paynamics

Provide Paynamics (merchant form / project manager) with:

1. Staging **notification URL** and **response URL** (table above).
2. Staging/server **IP address** (`PAYNAMICS_MERCHANT_IP`).
3. Confirmation of enabled **payment methods** for the BNI merchant MID (which `pmethod` codes apply — e.g. online banking vs cards; do not assume).
4. Sandbox **MID**, **merchant key**, and whether checkout uses `webpayment` vs `webpaymentv2` endpoint.

## Admin

Enable channel **Paynamics** under Admin → Settings → Payment channels after credentials are set.

## Verification

| Command | Type |
| --- | --- |
| `npm run verify:paynamics` | Mocked unit/integration (signatures, replay, tampering, webhook route) |
| `node server/verify-payments.js` | Existing UPay/HitPay regression harness |

Provider sandbox end-to-end verification requires real sandbox credentials and Paynamics-whitelisted URLs/IP — not run in CI.

## Railway staging deployment path

1. Deploy branch to a **non-production** Railway environment/service (do not merge to `main` for this task).
2. Set staging variables from the table above in that service only.
3. Enable `paynamics` in admin payment channels.
4. Run a ₱ test registration with `ALLOW_TEST_REGISTRATION=true` if using test products.
5. Confirm Paynamics Paygate portal shows the `request_id` and notification returns `OK`.

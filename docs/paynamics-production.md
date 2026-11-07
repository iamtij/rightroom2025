# Paynamics Checkout (Workflow) — IBMC production (ibmcph.com)

Production uses the same fail-closed gates as staging live, plus an explicit production opt-in (`PAYNAMICS_PRODUCTION_LIVE_MERCHANT=true`). Code path: `assessProductionLiveDeploymentIdentity()` in `server/deployment-identity.js` and `paynamicsProductionLiveMerchantAllowed()` in `server/paynamics.js`.

## Readiness check

`GET https://ibmcph.com/api/payment-channels` → `paynamics`:

| Field | When live |
| --- | --- |
| `checkoutMode` | `live` |
| `productionLiveMerchantArmed` | `true` |
| `apiAdmissionAllowed` | `true` |
| `apiAdmissionReason` | `""` |

Settlement records payments when `PAYNAMICS_SETTLEMENT_ENABLED=true` (required on production).

## Railway production variables (already set on ibmc / rightroom2025)

Non-secret flags:

- `IBMC_DEPLOYMENT_ENV=production`
- `SITE_URL` / `PUBLIC_WEB_URL=https://ibmcph.com`
- `PAYNAMICS_PRODUCTION_LIVE_MERCHANT=true`
- `PAYNAMICS_SETTLEMENT_ENABLED=true`
- `PAYNAMICS_API_CALLS_ENABLED=true`
- `PAYNAMICS_API_ACCOUNT_CONFIRMED=true`
- `PAYNAMICS_API_LIVE_ACCOUNT_CONFIRMED=true`
- `PAYNAMICS_API_ENV=live`
- `REMINDERS_ENABLED=true`

Do **not** set `PAYNAMICS_STAGING_LIVE_MERCHANT` on production.

## Copy from staging (secrets — dashboard only)

Railway does not expose secret values via API. Copy these **values** from **staging** → **production** for the same service (`rightroom2025`):

| Variable | Notes |
| --- | --- |
| `PAYNAMICS_API_BASE_URL` | Must match live Workflow origin Paynamics provided |
| `PAYNAMICS_LIVE_API_ORIGIN_ALLOWLIST` | Same origin(s) as base URL |
| `PAYNAMICS_BASIC_AUTH_USER` | Workflow Basic auth |
| `PAYNAMICS_BASIC_AUTH_PASSWORD` | Workflow Basic auth |
| `PAYNAMICS_MERCHANT_ID` | Signature merchant id |
| `PAYNAMICS_MERCHANT_KEY` | Signature merchant key |
| `PAYNAMICS_PAYMENT_HOST_ALLOWLIST` | Hosted redirect host(s), e.g. `payserv.net` |

Optional — omit on production so URLs are built from `PUBLIC_WEB_URL`:

- `PAYNAMICS_NOTIFICATION_URL` → defaults to `https://ibmcph.com/api/webhooks/paynamics`
- `PAYNAMICS_CANCEL_URL` → defaults to `https://ibmcph.com/register`

After paste, redeploy production and re-check `GET /api/payment-channels`.

## Admin

Enable the **Paynamics** payment channel in admin (`payment_channels`) after admission passes.

## Verification

```bash
npm run verify:paynamics
```

See also: `docs/paynamics-staging.md` (sandbox vs staging-live vs production gates).

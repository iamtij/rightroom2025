# UnionBank UPay — live biller on IBMC staging

IBMC can test **production UnionBank whitelabel checkout** from Railway **staging** before turning it on at ibmcph.com.

## What the email credentials map to

| UnionBank email field | Env var | Purpose |
| --- | --- | --- |
| Profile ID | `UPAY_BILLER_UUID` | Whitelabel URL segment (`…/Whitelabel/{uuid}`) |
| Profile name | `UPAY_BILLER_NAME` | Shown to buyers at checkout |
| MID | `UPAY_PARTNER_ID` and usually `UPAY_USERNAME` | Partner login (confirm with UnionBank if status calls fail) |
| Password | `UPAY_PASSWORD` | Partner login password |

These are **not** the IBM Developer Portal `client_id` / `client_secret`. Those come from [developer.unionbankph.com](https://developer.unionbankph.com) when the app is subscribed to **UPay by UnionBank**.

## Live partner API base (status polling)

| Environment | `UPAY_BASE_URL` |
| --- | --- |
| Sandbox (UAT) | `https://api-uat.unionbankph.com/partners/sb` |
| **Production** | `https://api.unionbankph.com/ubp/external` |

Token path used by the server: `{UPAY_BASE_URL}/partners/v1/oauth2/token`

## Staging Railway variables

Set on **staging** only for a live test (real money on UnionBank):

```
UPAY_PAGE_URL=https://sith.unionbankph.com/UPAY/Whitelabel
UPAY_BILLER_UUID=<Profile ID>
UPAY_BILLER_NAME=<Profile name>
UPAY_BASE_URL=https://api.unionbankph.com/ubp/external
UPAY_PARTNER_ID=<MID>
UPAY_USERNAME=<MID>
UPAY_PASSWORD=<from UnionBank>
UPAY_CLIENT_ID=<Developer Portal app>
UPAY_CLIENT_SECRET=<Developer Portal app>
UPAY_SCOPE=upay_payments
UPAY_AES_KEY=<callback decryption key from UnionBank>
UPAY_CALLBACK_URL=https://rightroom2025-staging.up.railway.app/api/payments/upay/callback
```

`PUBLIC_WEB_URL` / `SITE_URL` on staging should match the staging hostname if `UPAY_CALLBACK_URL` is omitted.

## Readiness

`GET /api/payment-channels` → `upay`:

| `checkoutMode` | Meaning |
| --- | --- |
| `off` | No biller UUID |
| `biller_page` | Buyers can open UnionBank; status polling may fail until partner API + AES are set |
| `live` | Biller + full partner API configured |

Enable **U Pay · UnionBank** in admin if the channel is disabled.

## Security

Do not commit secrets. UnionBank may IP-allowlist production API calls — if token requests work locally but fail on Railway, ask UnionBank to allow the staging egress IP.

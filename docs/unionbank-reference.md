# UnionBank (UPay) — documentation index for IBMC

This page pulls together **official UnionBank material**, **email onboarding threads**, and **how `server/upay.js` expects credentials**. UnionBank runs **several different products**; using the wrong guide is the most common integration mistake.

## Three separate UnionBank products

| Product | What it is | Official / emailed docs | Used by IBMC? |
| --- | --- | --- | --- |
| **UPay Partner REST API** | Collections API: OAuth → create transaction → QR / redirect → poll or callback | [UnionBank Developer Portal](https://developer.unionbankph.com/reference) (UPay sections); Jaromy thread *UPAY API Proposal x UNIPRO* (Nov 2026) with `UPAY Proposal_Unipro.pdf`, `API Marketplace.pdf` | **Yes** — `startUpayPayment()` when `UPAY_CLIENT_ID` + `UPAY_CLIENT_SECRET` are set |
| **UPay Whitelabel page** | Hosted checkout at `https://sith.unionbankph.com/UPAY/Whitelabel/{billerUuid}` | Howell B. Aseron reactivation email (Nov 2026): production biller UUID + AES key file | **Partial** — URL only; bare link fails without API-created session unless `UPAY_WHITELABEL_DIRECT=true` and UnionBank enables the profile |
| **CyberSource Secure Acceptance Checkout API** | Card straight/sale via CyberSource (PCI SAQ A-EP) | BNI-forwarded thread *[UPAY INTEGRATION] MID: globalreferral_straight* (Mar 2025): [CyberSource Secure Acceptance Checkout API PDF](https://developer.cybersource.com/library/documentation/dev_guides/Secure_Acceptance_Checkout_API/Secure_Acceptance_Checkout_API.pdf) | **No** — different stack from UPay Partner API in this repo |

**Ingestion vs checkout:** UnionBank’s **SA CHECKOUT** email (LIVE Profile UUID + MID + profile password) is enough for **biller ingestion / reconciliation** in their back office. It does **not** replace IBM API Connect **`UPAY_CLIENT_ID` / `UPAY_CLIENT_SECRET`** needed to call `POST /upay/payments/v1/transactions`.

## Official technical references

| Resource | URL |
| --- | --- |
| API reference (UPay, InstaPay, PESONet, UB-UB, OAuth) | https://developer.unionbankph.com/reference |
| UAT API base (`UPAY_BASE_URL`) | `https://api-uat.unionbankph.com/partners/sb` |
| Production API base | `https://api.unionbankph.com/ubp/external` |
| OAuth token (password grant) | `{UPAY_BASE_URL}/partners/v1/oauth2/token` |
| Create UPay payment | `POST /upay/payments/v1/transactions` |
| Biller reference fields | `GET /upay/payments/v1/billers/{billerUuid}/references` |
| Whitelabel host | `https://sith.unionbankph.com/UPAY/Whitelabel` |
| CyberSource SA Checkout (card MID track) | https://developer.cybersource.com/library/documentation/dev_guides/Secure_Acceptance_Checkout_API/Secure_Acceptance_Checkout_API.pdf |

Sandbox demo videos (EFT only, from Jaromy Nov 2026): PESONet, InstaPay, UB-UB links in Gmail thread *UPAY API Proposal x UNIPRO*.

## Credential sources (Gmail / BNI)

| Thread (approx.) | Gives you | Maps to env (see also [upay-staging-live.md](./upay-staging-live.md)) |
| --- | --- | --- |
| **RUSH: MID creation… LIVE checkout API keys** (BNI fwd, Mar 2025 → resent Nov 2026) | LIVE **SA CHECKOUT** Profile name, Profile UUID, MID `001470000006637`, profile password (separate email) | `UPAY_BILLER_UUID`, `UPAY_PARTNER_ID`, `UPAY_USERNAME`, `UPAY_PASSWORD`, `UPAY_BILLER_NAME` — **not** `UPAY_CLIENT_*` |
| **UPAY INTEGRATION globalreferral_straight** (Mar 2025) | **Test** SA Checkout Profile `6CD28305-59AF-49CC-8593-4091A1120CD4`, CyberSource integration guide | Card / CyberSource track only |
| **UPAY API Proposal x UNIPRO** (Nov 2026) | Sandbox Partner app: Client ID, Client Secret, Partner ID, base path | `UPAY_CLIENT_ID`, `UPAY_CLIENT_SECRET`, `UPAY_PARTNER_ID`, `UPAY_BASE_URL` (UAT) |
| **Reactivation of UPAY for Global Referral** (Nov 2026) | Production whitelabel UUID `8254975E-95DE-B285-1D4D-7E90D96159DF`, `aes key_Global.txt` | `UPAY_BILLER_UUID` (if whitelabel UUID differs from SA CHECKOUT Profile ID), `UPAY_AES_KEY` |

**Profile ID note:** SA CHECKOUT LIVE Profile UUID in the MID thread is `41953968-F72B-4EE1-9147-6826FFD5E072`. CMS whitelabel UUID from Howell may differ (`8254975E-…`). Clarify with UnionBank which UUID belongs in `UPAY_BILLER_UUID` for Partner API vs whitelabel-only links.

Never commit passwords, client secrets, or AES keys. Configure them in Railway only.

## UnionBank contacts (from threads)

| Role | Name | Email |
| --- | --- | --- |
| Corporate Solutions / UPay commercial | Jaromy Austine R. Kagalingan | jarkagalingan@unionbankph.com |
| API Marketplace PM | Kim Luke G. Kwan | klgkwan@unionbankph.com |
| CMS / whitelabel implementation | Howell B. Aseron | hobaseron@unionbankph.com |
| MAS / SA Checkout keys | Marian Jane L. Bacalla | mjlbacalla@unionbankph.com |

## Sandbox test status (Nov 2026, documented in email to Jaromy)

| API | Result |
| --- | --- |
| OAuth `password` grant + `upay_payments` scope | Works on UAT sandbox app |
| UB-UB / InstaPay fund transfer APIs | Works (test accounts on Developer Portal) |
| `POST /upay/payments/v1/transactions` | **401 — “Not registered to plan”** until UnionBank subscribes the sandbox app to **UPay** on API Marketplace |

## IBMC behaviour (`server/upay.js`)

| `checkoutMode` | Condition |
| --- | --- |
| `live` | Partner API fully configured → creates transaction, then redirect/QR |
| `pending_partner_api` | Biller UUID only → checkout button disabled; 503 on start payment |
| `biller_page` | `UPAY_WHITELABEL_DIRECT=true` → redirect to whitelabel URL without API |
| `off` | No `UPAY_BILLER_UUID` |

| `settlementMode` | Condition |
| --- | --- |
| `manual` | UUID only |
| `poll` | Partner API configured |
| `callback` | `UPAY_AES_KEY` + callback URL registered with UnionBank |

Readiness: `GET /api/payment-channels` → `upay`.

## What to ask UnionBank when blocked

1. **Production** IBM API Connect app: `client_id`, `client_secret`, and **UPay product subscribed** (not only EFT scopes).
2. Production OAuth username/password (MID login) matching LIVE biller.
3. Confirm **one** canonical `billerUuid` for Partner API + whitelabel.
4. Register callback URL and confirm AES key for `POST /api/payments/upay/callback`.
5. If whitelabel alone must work: enable production profile on `sith.unionbankph.com` (currently “Processing Error” without API session).

## Related repo docs

- [upay-staging-live.md](./upay-staging-live.md) — Railway env checklist and staging test flow
- `.env.example` — `UPAY_*` variable names

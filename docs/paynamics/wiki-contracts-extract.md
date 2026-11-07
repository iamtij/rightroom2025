# Paynamics Workflow API — wiki contract extract (sanitized)

Official Paynamics Wiki **Workflow API** (`API_Paygate`). Sanitized placeholders only; no credentials or live account values.

Source: https://wiki.paynamics.net/en/API_Paygate

## Test endpoints (§1.6)

| Purpose | URL |
| --- | --- |
| Test Workflow create | `https://payin.payserv.net/paygate/transactions/` |
| Test Workflow query | `https://payin.payserv.net/paygate/transactions/query` |

§1.6 does **not** publish a Workflow production URL. Do not infer a live Workflow host from credit-card production lines. Obtain live endpoint/account from Paynamics separately.

## HTTP auth (§2.3)

`Authorization: Basic <base64(username:password)>` — distinct from payload `merchant_id` / `mkey` signatures.

## Signature concatenation (§10.3)

**Transaction request:**

`merchant_id + request_id + notification_url + response_url + cancel_url + pmethod + payment_action + schedule + collection_method + deferred_period + deferred_time + dp_balance_info + amount + currency + descriptor_note + payment_notification_status + payment_notification_channel + mkey`

**Customer info:**

`fname + lname + mname + email + phone + mobile + dob + mkey`

**Initial/final response (SHA-512):**

`merchant_id + request_id + response_id + gateway_id + response_code + response_message + response_advise + timestamp + processor_response_id + processor_response_authcode + pay_reference + mkey`

**Query request (§10.10):**

`merchant_id + request_id + org_trxid2 + mkey`

### Coverage caveat

The published response formula does **not** include `payment_action_info` or `expiry_limit`. Hosted URLs are not cryptographically bound by this concatenation — use HTTPS + provider host allowlist before redirect.

## Hosted link (§10.2)

- `payment_action = url_link` → merchant redirects customer to **`payment_action_info`** (conditional string URL for `url_link`).
- Do not use speculative response keys (`redirect_url`, etc.).

## Query / status codes (Appendix B)

- `GR001` — transaction successful (payment outcome when corroborated).
- `GR033` — transaction pending.
- `GR152` — expired.
- `QM001` — **query successful only**; inspect inner status — **not** payment success.
- `GR036` — signature verification failed.

## Settlement gate (implementation)

Webhook transport/ACK, notification body schema, and query-**response** signature formula remain ambiguous in wiki (§10.9 XML vs JSON). **Settlement stays disabled** until Paynamics confirms those contracts.

# Staging safe mode (Railway / shared-credential guard)

Use when deploying a **feature branch** to an environment that still has **real** Resend, Semaphore, and backup S3 credentials, but you must not send customer mail/SMS or write/prune remote backups. Email login codes are the exception: they still send.

## Flag (non-secret)

| Variable | Value | Default |
| --- | --- | --- |
| `IBMC_STAGING_SAFE_MODE` | `true` | unset / anything else = **off** |

When off, behavior is unchanged from production.

## Suppressed when `IBMC_STAGING_SAFE_MODE=true`

- Resend email other than member and registration login codes
- All Semaphore SMS (`sendSms`)
- Automatic encrypted nightly backups (`createEncryptedBackup`), including S3 **upload** and retention **prune**
- Reminders, schedules, security alerts

## Login codes

`POST /api/members/otp` and `POST /api/registrations/otp` still email a code to the stored address. No allowlist and no staging-identity check. Auth is unchanged (random code, verify required).

Mobile lookup matches only when `registrationPhoneKey(mobile)` equals the query key — a stale or attacker-controlled `phone_key` column alone never selects a row. **Cancelled** rows are excluded. Multiple active rows with the same normalized mobile but different emails return **409** (use email or reference).

## Not suppressed

- Paynamics Workflow API calls (separate gates)
- HTTP app, registration DB, manual admin password login
- On-demand backup **download/restore** (read-only S3)

## Operational notes

- `/api/members/otp` and `/api/registrations/otp` return HTTP error JSON when delivery fails (not silent success).
- Boot logs: `IBMC_STAGING_SAFE_MODE: outbound email/SMS and automatic backups are suppressed; login codes still send`

## Verification

```bash
npm run verify:staging-safe
```

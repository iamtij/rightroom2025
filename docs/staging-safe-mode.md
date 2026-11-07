# Staging safe mode (Railway / shared-credential guard)

Use when deploying a **feature branch** to an environment that still has **real** Resend, Semaphore, and backup S3 credentials, but you must not send customer mail/SMS or write/prune remote backups.

## Flag (non-secret)

| Variable | Value | Default |
| --- | --- | --- |
| `IBMC_STAGING_SAFE_MODE` | `true` | unset / anything else = **off** |

When off, behavior is unchanged from production.

## Suppressed when `IBMC_STAGING_SAFE_MODE=true`

- Resend email except **allowlisted member + registration/resume OTP** (below)
- All Semaphore SMS (`sendSms`)
- Automatic encrypted nightly backups (`createEncryptedBackup`), including S3 **upload** and retention **prune**
- Registration resume OTP, reminders, schedules, security alerts

## Allowlisted ownership / resume OTP (staging only)

For TJ/manual checkout while safe mode stays on:

| Variable | Purpose |
| --- | --- |
| `IBMC_STAGING_SAFE_MEMBERSHIP_OTP_ALLOWLIST` | Comma-separated **exact** emails (no wildcards). Applies to **both** member lookup OTP and registration resume OTP (matched to stored member/registration email). Default empty = none sent. |
| Staging deployment identity | Same rules as Paynamics staging-live: Railway must not report `production`/conflict/unknown; see `docs/paynamics-staging.md`. |

Routes: `POST /api/members/otp`, `POST /api/registrations/otp`. Auth unchanged (random code, verify required).

Mobile lookup matches only when `registrationPhoneKey(mobile)` equals the query key — a stale or attacker-controlled `phone_key` column alone never selects a row. **Cancelled** rows are excluded. Multiple active rows with the same normalized mobile but different emails return **409** (use email or reference).

## Not suppressed

- Paynamics Workflow API calls (separate gates)
- HTTP app, registration DB, manual admin password login
- On-demand backup **download/restore** (read-only S3)

## Operational notes

- `/api/members/otp` and `/api/registrations/otp` return HTTP error JSON when delivery fails (not silent success).
- Boot logs: `IBMC_STAGING_SAFE_MODE: outbound email/SMS and automatic backups are suppressed`

## Verification

```bash
npm run verify:staging-safe
```

# Staging safe mode (Railway / shared-credential guard)

Use when deploying a **feature branch** to an environment that still has **real** Resend, Semaphore, and backup S3 credentials, but you must not send customer mail/SMS or write/prune remote backups.

## Flag (non-secret)

| Variable | Value | Default |
| --- | --- | --- |
| `IBMC_STAGING_SAFE_MODE` | `true` | unset / anything else = **off** |

When off, behavior is unchanged from production.

## Suppressed when `IBMC_STAGING_SAFE_MODE=true`

- All Resend email (`sendEmail`): reminders, scheduled messages, security alerts, member/registration OTP
- All Semaphore SMS (`sendSms`)
- Automatic encrypted nightly backups (`createEncryptedBackup`), including S3 **upload** and retention **prune**

## Not suppressed

- Paynamics Workflow sandbox API calls (`paynamics.js` gates remain separate)
- HTTP app, registration DB, manual admin password login
- On-demand backup **download/restore** (read-only S3) — only automatic write/prune is blocked

## Operational notes

- **Email OTP login** (member edit + registration resume) returns HTTP 503 with a clear message; codes are not emailed.
- Boot logs: `IBMC_STAGING_SAFE_MODE: outbound email/SMS and automatic backups are suppressed`
- Railway stage DB/volumes are environment-isolated; backup buckets may not be — use this flag when testing Paynamics or other branch work on a staging service that shares backup credentials with production.

## Verification

```bash
npm run verify:staging-safe
```

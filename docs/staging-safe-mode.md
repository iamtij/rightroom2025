# Staging safe mode (Railway / shared-credential guard)

Use when deploying a **feature branch** to an environment that still has **real** Resend, Semaphore, and backup S3 credentials, but you must not send customer mail/SMS or write/prune remote backups.

## Flag (non-secret)

| Variable | Value | Default |
| --- | --- | --- |
| `IBMC_STAGING_SAFE_MODE` | `true` | unset / anything else = **off** |

When off, behavior is unchanged from production.

## Suppressed when `IBMC_STAGING_SAFE_MODE=true`

- Resend email except **allowlisted member-ownership OTP** (below)
- All Semaphore SMS (`sendSms`)
- Automatic encrypted nightly backups (`createEncryptedBackup`), including S3 **upload** and retention **prune**
- Registration resume OTP, reminders, schedules, security alerts

## Allowlisted member-ownership OTP (staging only)

For TJ/manual checkout while safe mode stays on:

| Variable | Purpose |
| --- | --- |
| `IBMC_STAGING_SAFE_MEMBERSHIP_OTP_ALLOWLIST` | Comma-separated **exact** membership emails (no wildcards). Default empty = none sent. |
| Staging deployment identity | Same rules as Paynamics staging-live: Railway must not report `production`/conflict/unknown; see `docs/paynamics-staging.md`. |

Only `POST /api/members/otp` emails for members whose stored email matches an allowlist entry. Auth flow unchanged (random code, hashed in DB, verify required).

## Not suppressed

- Paynamics Workflow API calls (separate gates)
- HTTP app, registration DB, manual admin password login
- On-demand backup **download/restore** (read-only S3)

## Operational notes

- Registration resume OTP stays blocked in safe mode.
- `/api/members/otp` returns HTTP error JSON when delivery fails (not silent success).
- Boot logs: `IBMC_STAGING_SAFE_MODE: outbound email/SMS and automatic backups are suppressed`

## Verification

```bash
npm run verify:staging-safe
```

# IBMC incident response

Use this when a payment, pass, or admin account looks wrong. Do not paste passwords, session cookies, one-time codes, or provider keys into chat or tickets.

## Who acts

The person who receives mail at `ADMIN_EMAIL` is the first responder. If that mailbox is unavailable, use the Railway account owner for the IBMC 2026 project.

## What the app already records

`security_events` stores admin login failures, complimentary tickets, registration and member list views, duplicate pass scans, pass overrides, and UPay callback volume. `admin_audit` stores who changed a registration, coupon, payment, or check-in. Alerts go to `ADMIN_EMAIL` when Resend is configured.

## First steps

1. Sign in to the admin page. If the authenticator device is lost, set a new `ADMIN_SESSION_SECRET` on the host and restart. That signs every admin out. Enroll the authenticator again.
2. If a pass was shared, the second scan is refused. Use Check-in override only after you know who is at the door. The override is audited.
3. If a complimentary seat looks wrong, find the `registration.comp` row in `security_events` and the matching `admin_audit` row. Cancel the registration if the seat should not stand.
4. If payments are being marked paid without a bank receipt, check `payments.method`. `admin` and `comp` are staff actions. `hitpay:` and `upay:` should match a provider reference.
5. If callback traffic spikes, unsigned UPay callbacks are already rejected. Rate limits are stored in `rate_hits` and survive a restart.

## After the event is contained

1. Rotate `ADMIN_SESSION_SECRET`. Set new `OTP_SECRET` and `MEMBER_EDIT_SECRET` values if those mail codes should be rotated separately.
2. Rotate the HitPay salt and the UnionBank credentials in the host, not in git.
3. Restore the database from the newest encrypted backup only onto a new file. Confirm a recent registration is present before replacing the live file.
4. Write down the time, the reference numbers involved, and the action taken. Do not copy the full member spreadsheet into the repository.

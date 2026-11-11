import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { createRegistration, getRegistration, recordPayment } from "./registrations.js";
import { runReminders } from "./reminders.js";
import {
  HOLD_GRACE_MS,
  HOLD_MS,
  assignFirstPaymentHold,
  checkoutHoldDecision,
  expireRegistrationHold,
  expireUnpaidFirstPayments,
  firstPaymentHoldEnabled,
  prepareHoldSettlement,
  settleOpeningPayment,
} from "./payment-hold.js";

delete process.env.RESEND_API_KEY;
delete process.env.SEMAPHORE_API_KEY;
delete process.env.RAILWAY_ENVIRONMENT;
delete process.env.RAILWAY_ENVIRONMENT_NAME;
delete process.env.RAILWAY_PROJECT_ID;
delete process.env.RAILWAY_SERVICE_ID;
delete process.env.IBMC_FIRST_PAYMENT_HOLD;
process.env.IBMC_DEPLOYMENT_ENV = "staging";

assert.equal(HOLD_MS, 24 * 60 * 60 * 1000);
assert.equal(HOLD_GRACE_MS, 2 * 60 * 60 * 1000);
assert.equal(firstPaymentHoldEnabled(), true);

process.env.IBMC_DEPLOYMENT_ENV = "production";
assert.equal(firstPaymentHoldEnabled(), false);
delete process.env.IBMC_DEPLOYMENT_ENV;
assert.equal(firstPaymentHoldEnabled(), true);

process.env.RAILWAY_ENVIRONMENT = "production";
process.env.RAILWAY_ENVIRONMENT_NAME = "production";
process.env.IBMC_DEPLOYMENT_ENV = "staging";
assert.equal(firstPaymentHoldEnabled(), true);
delete process.env.RAILWAY_ENVIRONMENT;
delete process.env.RAILWAY_ENVIRONMENT_NAME;

process.env.RAILWAY_ENVIRONMENT = "staging";
process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
assert.equal(firstPaymentHoldEnabled(), true);
delete process.env.RAILWAY_ENVIRONMENT;
delete process.env.RAILWAY_ENVIRONMENT_NAME;
process.env.IBMC_DEPLOYMENT_ENV = "staging";

process.env.IBMC_FIRST_PAYMENT_HOLD = "false";
assert.equal(firstPaymentHoldEnabled(), false);
delete process.env.IBMC_FIRST_PAYMENT_HOLD;

const db = openDatabase(":memory:");
let serial = 0;

function signup(email, extra = {}) {
  serial += 1;
  return createRegistration(db, {
    productCode: extra.productCode || "first_mover",
    paymentPlan: extra.paymentPlan || "full",
    fullName: "Hold Tester",
    email,
    mobile: `0917${String(1000000 + serial)}`,
    registeredOn: "2026-11-11",
    attendeeType: "guest",
    couponCode: extra.couponCode,
  });
}

function sqliteUtc(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function ageHold(registration, endedMsAgo) {
  db.prepare("UPDATE registrations SET payment_hold_until = ? WHERE id = ?").run(new Date(Date.now() - endedMsAgo).toISOString(), registration.id);
  return getRegistration(db, registration.id);
}

const fresh = signup("fresh@example.com");
const until = assignFirstPaymentHold(db, fresh.id);
assert.ok(until);
assert.equal(checkoutHoldDecision(db, getRegistration(db, fresh.id)), "allow");
assert.equal(expireRegistrationHold(db, fresh.id), false);
assert.equal(getRegistration(db, fresh.id).status, "confirmed");

const usd = signup("usd@example.com", { productCode: "intl_early_bird" });
assert.equal(assignFirstPaymentHold(db, usd.id), null);
assert.equal(getRegistration(db, usd.id).payment_hold_until, null);
assert.equal(expireRegistrationHold(db, usd.id, Date.now() + HOLD_MS * 2), false);

const untouched = signup("admin-style@example.com");
assert.equal(expireUnpaidFirstPayments(db, Date.now() + HOLD_MS * 2), 1);
assert.equal(getRegistration(db, fresh.id).status, "cancelled");
assert.ok(getRegistration(db, fresh.id).payment_hold_cancelled_at);
assert.equal(getRegistration(db, untouched.id).status, "confirmed");

const partial = signup("partial@example.com");
assignFirstPaymentHold(db, partial.id);
recordPayment(db, { registrationId: partial.id, amountCents: 1_000, method: "manual" });
ageHold(partial, 60 * 60 * 1000);
assert.equal(expireRegistrationHold(db, partial.id), false);
assert.equal(getRegistration(db, partial.id).status, "confirmed");

const deposited = signup("deposited@example.com", { paymentPlan: "installment" });
assignFirstPaymentHold(db, deposited.id);
recordPayment(db, { registrationId: deposited.id, amountCents: 100_000, method: "manual" });
ageHold(deposited, 3 * 60 * 60 * 1000);
assert.equal(expireRegistrationHold(db, deposited.id), false);
assert.equal(getRegistration(db, deposited.id).installments[1].status, "due");

db.prepare(`
  INSERT INTO coupons (code, discount_type, discount_value, active, usage_limit)
  VALUES ('HOLD10', 'percent', 10, 1, 1)
`).run();
const couponed = signup("coupon@example.com", { couponCode: "HOLD10" });
assert.equal(db.prepare("SELECT usage_count FROM coupons WHERE code = 'HOLD10'").get().usage_count, 1);
assignFirstPaymentHold(db, couponed.id);
ageHold(couponed, 60 * 60 * 1000);
assert.equal(expireRegistrationHold(db, couponed.id), true);
assert.equal(db.prepare("SELECT usage_count FROM coupons WHERE code = 'HOLD10'").get().usage_count, 0);
const again = signup("coupon@example.com", { couponCode: "HOLD10" });
assert.equal(again.coupon_code, "HOLD10");
assert.equal(db.prepare("SELECT usage_count FROM coupons WHERE code = 'HOLD10'").get().usage_count, 1);

const waiting = signup("waiting@example.com");
assignFirstPaymentHold(db, waiting.id);
const waitingRow = ageHold(waiting, 30 * 60 * 1000);
const holdMs = Date.parse(waitingRow.payment_hold_until);
db.prepare(`
  INSERT INTO hitpay_payments (
    registration_id, installment_id, session_id, amount_cents, currency, channel, status, created_at
  ) VALUES (?, ?, 'sess-waiting', 1200000, 'PHP', 'qr', 'pending', ?)
`).run(waiting.id, waitingRow.installments[0].id, sqliteUtc(holdMs - 60 * 1000));
assert.equal(expireRegistrationHold(db, waiting.id), false);
assert.equal(checkoutHoldDecision(db, getRegistration(db, waiting.id)), "expired");
db.prepare("UPDATE registrations SET payment_hold_until = ? WHERE id = ?").run(new Date(Date.now() - HOLD_GRACE_MS - 60 * 1000).toISOString(), waiting.id);
db.prepare("UPDATE hitpay_payments SET created_at = ? WHERE session_id = 'sess-waiting'").run(sqliteUtc(Date.now() - HOLD_GRACE_MS - 2 * 60 * 1000));
assert.equal(expireRegistrationHold(db, waiting.id), true);

const late = signup("late@example.com");
assignFirstPaymentHold(db, late.id);
const lateRow = ageHold(late, 60 * 60 * 1000);
assert.equal(expireRegistrationHold(db, late.id), true);
const lateSession = new Date(Date.parse(lateRow.payment_hold_until) - 60 * 1000).toISOString();
assert.equal(prepareHoldSettlement(db, late.id, lateSession), "open");
const reopened = settleOpeningPayment(db, {
  registrationId: late.id,
  installmentId: getRegistration(db, late.id).installments[0].id,
  amountCents: getRegistration(db, late.id).installments[0].amount_cents,
  method: "hitpay:qr",
  externalReference: "late-session",
  sessionCreatedAt: lateSession,
});
assert.equal(reopened.status, "confirmed");
assert.ok(reopened.qr_token);
assert.equal(reopened.balance_cents, 0);

const replaced = signup("replaced@example.com");
assignFirstPaymentHold(db, replaced.id);
const replacedRow = ageHold(replaced, 60 * 60 * 1000);
assert.equal(expireRegistrationHold(db, replaced.id), true);
const nextSeat = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Hold Tester",
  email: replaced.email,
  mobile: replaced.mobile,
  registeredOn: "2026-11-12",
  attendeeType: "guest",
});
const replacedSession = new Date(Date.parse(replacedRow.payment_hold_until) - 60 * 1000).toISOString();
const detached = settleOpeningPayment(db, {
  registrationId: replaced.id,
  installmentId: replacedRow.installments[0].id,
  amountCents: replacedRow.installments[0].amount_cents,
  method: "hitpay:qr",
  externalReference: "replaced-session",
  sessionCreatedAt: replacedSession,
});
assert.equal(detached.status, "cancelled");
assert.equal(detached.qr_token, null);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE registration_id = ?").get(replaced.id).n, 1);
assert.equal(getRegistration(db, nextSeat.id).status, "confirmed");
assert.equal(getRegistration(db, nextSeat.id).balance_cents, nextSeat.amount_due_cents);

process.env.IBMC_FIRST_PAYMENT_HOLD = "false";
const paused = signup("paused@example.com");
assert.equal(assignFirstPaymentHold(db, paused.id), null);
db.prepare("UPDATE registrations SET payment_hold_until = ? WHERE id = ?").run(new Date(Date.now() - 60 * 60 * 1000).toISOString(), paused.id);
assert.equal(expireRegistrationHold(db, paused.id), false);
assert.equal(getRegistration(db, paused.id).status, "confirmed");
delete process.env.IBMC_FIRST_PAYMENT_HOLD;

const reminded = signup("reminded@example.com");
assignFirstPaymentHold(db, reminded.id);
ageHold(reminded, 60 * 60 * 1000);
await runReminders(db);
assert.equal(getRegistration(db, reminded.id).status, "cancelled");

console.log("payment hold ok");

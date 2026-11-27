import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openDatabase } from "./db.js";
import { createRegistration, getRegistration, recordPayment, registrationContactClash } from "./registrations.js";
import { handleHitpayWebhook } from "./hitpay.js";
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

assert.equal(HOLD_MS, 2 * 60 * 60 * 1000);
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

// ---- 2-hour hold ----
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const T0 = Date.parse("2026-11-27T10:00:00.000Z");
const TEST_SALT = "verify-payment-hold-test-salt";

async function hitpayPaid(sessionId, amountCents) {
  const raw = JSON.stringify({
    id: `gw-${sessionId}`,
    status: "completed",
    reference_number: sessionId,
    currency: "PHP",
    amount: (amountCents / 100).toFixed(2),
    payments: [{ status: "succeeded", currency: "php", amount: (amountCents / 100).toFixed(2) }],
  });
  const saved = process.env.HITPAY_SALT;
  process.env.HITPAY_SALT = TEST_SALT;
  try {
    const signature = crypto.createHmac("sha256", TEST_SALT).update(raw, "utf8").digest("hex");
    return await handleHitpayWebhook(db, raw, signature, { eventType: "completed", eventObject: "payment_request" });
  } finally {
    if (saved === undefined) delete process.env.HITPAY_SALT;
    else process.env.HITPAY_SALT = saved;
  }
}

function openHitpaySession(registration, sessionId, startedMs) {
  const due = getRegistration(db, registration.id).installments[0];
  db.prepare(`
    INSERT INTO hitpay_payments (
      registration_id, installment_id, session_id, amount_cents, currency, channel, status, created_at
    ) VALUES (?, ?, ?, ?, 'PHP', 'qr', 'pending', ?)
  `).run(registration.id, due.id, sessionId, due.amount_cents, sqliteUtc(startedMs));
  return due;
}

// New hold deadline is checkout time + 2 hours.
const twoHour = signup("two-hour@example.com", { couponCode: undefined });
const twoHourUntil = assignFirstPaymentHold(db, twoHour.id, T0);
assert.equal(twoHourUntil, new Date(T0 + 2 * HOUR).toISOString());
assert.equal(getRegistration(db, twoHour.id).payment_hold_until, new Date(T0 + 2 * HOUR).toISOString());
assert.equal(checkoutHoldDecision(db, getRegistration(db, twoHour.id), T0 + 2 * HOUR - MIN), "allow");
assert.equal(checkoutHoldDecision(db, getRegistration(db, twoHour.id), T0 + 2 * HOUR + MIN), "expired");

// Auto-cancel job (runReminders -> expireUnpaidFirstPayments) cancels just after 2 hours,
// frees email/mobile, and releases the coupon.
db.prepare(`
  INSERT INTO coupons (code, discount_type, discount_value, active, usage_limit)
  VALUES ('HOLD2H', 'percent', 10, 1, 1)
`).run();
const twoHourCoupon = signup("two-hour-coupon@example.com", { couponCode: "HOLD2H" });
assert.equal(db.prepare("SELECT usage_count FROM coupons WHERE code = 'HOLD2H'").get().usage_count, 1);
assignFirstPaymentHold(db, twoHourCoupon.id, T0);
await runReminders(db, new Date(T0 + 2 * HOUR - MIN));
assert.equal(getRegistration(db, twoHourCoupon.id).status, "confirmed");
assert.equal(getRegistration(db, twoHour.id).status, "confirmed");
assert.ok(registrationContactClash(db, { email: twoHourCoupon.email, mobile: twoHourCoupon.mobile }));
await runReminders(db, new Date(T0 + 2 * HOUR + MIN));
assert.equal(getRegistration(db, twoHourCoupon.id).status, "cancelled");
assert.ok(getRegistration(db, twoHourCoupon.id).payment_hold_cancelled_at);
assert.equal(getRegistration(db, twoHour.id).status, "cancelled");
assert.equal(db.prepare("SELECT usage_count FROM coupons WHERE code = 'HOLD2H'").get().usage_count, 0);
assert.equal(registrationContactClash(db, { email: twoHourCoupon.email, mobile: twoHourCoupon.mobile }), "");
const twoHourAgain = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Hold Tester",
  email: twoHourCoupon.email,
  mobile: twoHourCoupon.mobile,
  registeredOn: "2026-11-27",
  attendeeType: "guest",
  couponCode: "HOLD2H",
});
assert.equal(twoHourAgain.status, "confirmed");
assert.equal(twoHourAgain.coupon_code, "HOLD2H");

// Grace is unchanged: a gateway page opened before the 2-hour deadline holds the cancel
// for HOLD_GRACE_MS past the deadline, then the job cancels.
const graced = signup("two-hour-grace@example.com");
assignFirstPaymentHold(db, graced.id, T0);
openHitpaySession(graced, "sess-2h-grace", T0 + 2 * HOUR - 5 * MIN);
assert.equal(expireRegistrationHold(db, graced.id, T0 + 2 * HOUR + 30 * MIN), false);
assert.equal(expireRegistrationHold(db, graced.id, T0 + 2 * HOUR + HOLD_GRACE_MS - MIN), false);
assert.equal(getRegistration(db, graced.id).status, "confirmed");
assert.equal(expireRegistrationHold(db, graced.id, T0 + 2 * HOUR + HOLD_GRACE_MS + MIN), true);
// A page opened after the deadline gets no grace.
const noGrace = signup("two-hour-nograce@example.com");
assignFirstPaymentHold(db, noGrace.id, T0);
openHitpaySession(noGrace, "sess-2h-nograce", T0 + 2 * HOUR + MIN);
assert.equal(expireRegistrationHold(db, noGrace.id, T0 + 2 * HOUR + 2 * MIN), true);

// Late HitPay paid notice after the cancel is still recorded and recovers the registration.
const lateHitpay = signup("two-hour-late@example.com");
assignFirstPaymentHold(db, lateHitpay.id, T0);
const lateDue = openHitpaySession(lateHitpay, "sess-2h-late", T0 + 90 * MIN);
assert.equal(expireRegistrationHold(db, lateHitpay.id, T0 + 2 * HOUR + HOLD_GRACE_MS + MIN), true);
assert.equal(getRegistration(db, lateHitpay.id).status, "cancelled");
const lateWebhook = await hitpayPaid("sess-2h-late", lateDue.amount_cents);
assert.equal(lateWebhook.status, 200);
const lateRecovered = getRegistration(db, lateHitpay.id);
assert.equal(lateRecovered.status, "confirmed");
assert.equal(lateRecovered.payment_hold_cancelled_at, null);
assert.equal(lateRecovered.balance_cents, 0);
assert.ok(lateRecovered.qr_token);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE external_reference = 'sess-2h-late'").get().n, 1);
assert.equal(db.prepare("SELECT status FROM hitpay_payments WHERE session_id = 'sess-2h-late'").get().status, "paid");

// HitPay paid within 2 hours confirms normally and the job never cancels it.
const onTime = signup("two-hour-ontime@example.com");
assignFirstPaymentHold(db, onTime.id, Date.now());
const onTimeDue = openHitpaySession(onTime, "sess-2h-ontime", Date.now() - MIN);
assert.equal((await hitpayPaid("sess-2h-ontime", onTimeDue.amount_cents)).status, 200);
const onTimePaid = getRegistration(db, onTime.id);
assert.equal(onTimePaid.status, "confirmed");
assert.equal(onTimePaid.balance_cents, 0);
assert.ok(onTimePaid.qr_token);
await runReminders(db, new Date(Date.now() + 5 * HOUR));
assert.equal(getRegistration(db, onTime.id).status, "confirmed");

// Existing holds keep the deadline already stored on the row (written under the 24-hour rule).
const legacy = signup("legacy-24h@example.com");
const legacyUntil = new Date(T0 + 24 * HOUR).toISOString();
db.prepare("UPDATE registrations SET payment_hold_until = ? WHERE id = ?").run(legacyUntil, legacy.id);
assert.equal(assignFirstPaymentHold(db, legacy.id, T0 + HOUR), legacyUntil);
assert.equal(getRegistration(db, legacy.id).payment_hold_until, legacyUntil);
assert.equal(expireRegistrationHold(db, legacy.id, T0 + 3 * HOUR), false);
assert.equal(checkoutHoldDecision(db, getRegistration(db, legacy.id), T0 + 3 * HOUR), "allow");
assert.equal(expireRegistrationHold(db, legacy.id, T0 + 24 * HOUR - MIN), false);
assert.equal(getRegistration(db, legacy.id).status, "confirmed");
assert.equal(expireRegistrationHold(db, legacy.id, T0 + 24 * HOUR + MIN), true);

console.log("payment hold ok");

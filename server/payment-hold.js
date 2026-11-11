import { ibmcDeploymentEnv, railwayDeploymentClass, railwaySignalsPresent } from "./deployment-identity.js";
import { getRegistration, recordPayment, registrationContactClash } from "./registrations.js";

export const HOLD_MS = 24 * 60 * 60 * 1000;
export const HOLD_GRACE_MS = 2 * 60 * 60 * 1000;
export const HOLD_EXPIRED_MESSAGE = "The 24-hour hold ended. Start again to lock the ticket.";

const SESSION_TABLES = ["hitpay_payments", "paynamics_payments", "upay_payments"];

/**
 * First-payment hold is on for local dev, staging, and production.
 * IBMC_FIRST_PAYMENT_HOLD=false turns it off everywhere.
 * A machine with no Railway identity and IBMC_DEPLOYMENT_ENV=production stays off.
 */
export function firstPaymentHoldEnabled() {
  const flag = String(process.env.IBMC_FIRST_PAYMENT_HOLD || "").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  if (railwaySignalsPresent()) {
    const railway = railwayDeploymentClass();
    return railway === "staging" || railway === "production";
  }
  const custom = ibmcDeploymentEnv();
  return custom !== "production" && custom !== "prod";
}

export function parseUtcTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return NaN;
  if (/[zZ]$/.test(text) || /[+-]\d{2}:\d{2}$/.test(text)) return Date.parse(text);
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  return Date.parse(`${normalized}Z`);
}

export function assignFirstPaymentHold(db, registrationId, now = Date.now()) {
  if (!firstPaymentHoldEnabled()) return null;
  const row = db.prepare("SELECT id, currency, status, payment_hold_until FROM registrations WHERE id = ?").get(registrationId);
  if (!row || row.status !== "confirmed" || row.currency !== "PHP") return null;
  if (row.payment_hold_until) return row.payment_hold_until;
  const until = new Date(now + HOLD_MS).toISOString();
  db.prepare("UPDATE registrations SET payment_hold_until = ? WHERE id = ? AND payment_hold_until IS NULL").run(until, row.id);
  return until;
}

function openingStillOpen(db, registrationId) {
  const first = db.prepare(`
    SELECT amount_cents, amount_paid_cents, status
    FROM registration_installments
    WHERE registration_id = ?
    ORDER BY sequence ASC
    LIMIT 1
  `).get(registrationId);
  if (!first) return false;
  if (first.amount_paid_cents > 0 || first.status === "paid" || first.status === "waived") return false;
  const payments = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE registration_id = ?").get(registrationId).n;
  return payments === 0;
}

function hasPendingSessionBeforeHold(db, registrationId, holdMs) {
  for (const table of SESSION_TABLES) {
    const rows = db.prepare(`
      SELECT created_at FROM ${table}
      WHERE registration_id = ? AND status = 'pending'
    `).all(registrationId);
    for (const row of rows) {
      const started = parseUtcTimestamp(row.created_at);
      if (Number.isFinite(started) && started <= holdMs) return true;
    }
  }
  return false;
}

function releaseCoupon(db, registration) {
  if (!registration.coupon_code) return;
  const paid = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE registration_id = ?").get(registration.id).n;
  if (paid) return;
  db.prepare("UPDATE coupons SET usage_count = MAX(usage_count - 1, 0) WHERE code = ?").run(registration.coupon_code);
}

function reclaimCoupon(db, code) {
  if (!code) return;
  db.prepare(`
    UPDATE coupons
    SET usage_count = usage_count + 1
    WHERE code = ? AND active = 1 AND (usage_limit IS NULL OR usage_count < usage_limit)
  `).run(code);
}

function cancelHeldRegistration(db, registration, now) {
  const run = db.transaction(() => {
    const current = db.prepare("SELECT id, status, coupon_code FROM registrations WHERE id = ?").get(registration.id);
    if (!current || current.status !== "confirmed") return false;
    releaseCoupon(db, current);
    db.prepare(`
      UPDATE registrations
      SET status = 'cancelled', payment_hold_cancelled_at = ?
      WHERE id = ? AND status = 'confirmed'
    `).run(new Date(now).toISOString(), current.id);
    return true;
  });
  return run();
}

export function expireRegistrationHold(db, registrationId, now = Date.now()) {
  if (!firstPaymentHoldEnabled()) return false;
  const row = db.prepare(`
    SELECT id, status, payment_hold_until, coupon_code
    FROM registrations WHERE id = ?
  `).get(registrationId);
  if (!row || row.status !== "confirmed" || !row.payment_hold_until) return false;
  const holdMs = Date.parse(row.payment_hold_until);
  if (!Number.isFinite(holdMs) || now < holdMs) return false;
  if (!openingStillOpen(db, row.id)) return false;
  if (hasPendingSessionBeforeHold(db, row.id, holdMs) && now < holdMs + HOLD_GRACE_MS) return false;
  return cancelHeldRegistration(db, row, now);
}

export function expireUnpaidFirstPayments(db, now = Date.now()) {
  if (!firstPaymentHoldEnabled()) return 0;
  const rows = db.prepare(`
    SELECT id FROM registrations
    WHERE status = 'confirmed' AND payment_hold_until IS NOT NULL
  `).all();
  let count = 0;
  for (const row of rows) {
    if (expireRegistrationHold(db, row.id, now)) count += 1;
  }
  return count;
}

export function checkoutHoldDecision(db, registration, now = Date.now()) {
  if (!registration) return "closed";
  if (!firstPaymentHoldEnabled() || !registration.payment_hold_until) {
    return registration.status === "confirmed" ? "allow" : "closed";
  }
  const holdMs = Date.parse(registration.payment_hold_until);
  if (!Number.isFinite(holdMs)) return registration.status === "confirmed" ? "allow" : "closed";
  if (registration.status === "cancelled" && !registration.payment_hold_cancelled_at) return "closed";
  if (now < holdMs && registration.status === "confirmed") return "allow";
  if (!openingStillOpen(db, registration.id)) return registration.status === "confirmed" ? "allow" : "closed";
  return "expired";
}

export function refreshHeldRegistration(db, registration, now = Date.now()) {
  if (!registration?.id) return { registration: null, decision: "closed" };
  expireRegistrationHold(db, registration.id, now);
  const current = getRegistration(db, registration.id);
  if (!current) return { registration: null, decision: "closed" };
  return { registration: current, decision: checkoutHoldDecision(db, current, now) };
}

export function sessionStartedBeforeHold(registration, createdAt) {
  if (!registration?.payment_hold_until) return false;
  const started = parseUtcTimestamp(createdAt);
  const holdMs = Date.parse(registration.payment_hold_until);
  return Number.isFinite(started) && Number.isFinite(holdMs) && started <= holdMs;
}

export function prepareHoldSettlement(db, registrationId, sessionCreatedAt) {
  const registration = db.prepare("SELECT * FROM registrations WHERE id = ?").get(registrationId);
  if (!registration) return "refuse";
  if (registration.status === "confirmed") return "open";
  if (!firstPaymentHoldEnabled()) return "refuse";
  if (registration.status !== "cancelled" || !registration.payment_hold_cancelled_at || !registration.payment_hold_until) {
    return "refuse";
  }
  const started = parseUtcTimestamp(sessionCreatedAt);
  const holdMs = Date.parse(registration.payment_hold_until);
  if (!Number.isFinite(started) || !Number.isFinite(holdMs) || started > holdMs) return "refuse";
  const clash = registrationContactClash(db, {
    email: registration.email,
    mobile: registration.mobile,
    excludeId: registration.id,
  });
  if (clash) return "detached";
  db.prepare(`
    UPDATE registrations
    SET status = 'confirmed', payment_hold_cancelled_at = NULL
    WHERE id = ? AND status = 'cancelled'
  `).run(registration.id);
  reclaimCoupon(db, registration.coupon_code);
  return "open";
}

function recordDetachedHoldPayment(db, input) {
  const run = db.transaction(() => {
    const registration = getRegistration(db, input.registrationId);
    if (!registration) throw new Error("Registration is not payable");
    const target = registration.installments.find((item) => item.id === input.installmentId)
      || registration.installments.find((item) => item.status === "due");
    if (!target || target.status !== "due") throw new Error("No installment is due");
    const remaining = target.amount_cents - target.amount_paid_cents;
    if (input.amountCents <= 0 || input.amountCents > remaining) {
      throw new Error("Payment does not match the amount still due");
    }
    db.prepare(`
      INSERT INTO payments (registration_id, installment_id, amount_cents, currency, method, external_reference, admin_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      registration.id,
      target.id,
      input.amountCents,
      registration.currency,
      input.method || null,
      input.externalReference || null,
      null,
    );
    const paid = target.amount_paid_cents + input.amountCents;
    const settled = paid >= target.amount_cents;
    db.prepare(`
      UPDATE registration_installments
      SET amount_paid_cents = ?, status = ?, paid_at = ?
      WHERE id = ?
    `).run(paid, settled ? "paid" : "due", settled ? new Date().toISOString() : null, target.id);
    return registration.id;
  });
  return getRegistration(db, run());
}

export function settleOpeningPayment(db, input) {
  if (input.externalReference) {
    const existing = db.prepare("SELECT id FROM payments WHERE external_reference = ?").get(input.externalReference);
    if (existing) return getRegistration(db, input.registrationId);
  }
  const decision = prepareHoldSettlement(db, input.registrationId, input.sessionCreatedAt);
  if (decision === "detached") return recordDetachedHoldPayment(db, input);
  if (decision === "refuse") {
    const error = new Error("Registration is not payable");
    error.status = 400;
    throw error;
  }
  return recordPayment(db, {
    registrationId: input.registrationId,
    installmentId: input.installmentId,
    amountCents: input.amountCents,
    method: input.method,
    externalReference: input.externalReference,
    adminUserId: input.adminUserId,
  });
}

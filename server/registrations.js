import crypto from "crypto";
import { claimCoupon, priceCoupon } from "./coupons.js";
import { registrationBalance, testTicketEnabled } from "./db.js";
import { addDays, manilaParts } from "./time.js";

function dueOnFor(item, registeredOn) {
  if (item.kind === "days_after") return addDays(registeredOn, Number(item.days_after) || 0);
  if (item.kind === "on_registration" || item.kind === "full") return registeredOn;
  return item.due_on;
}

function reference() {
  return `IBMC27-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function token() {
  return crypto.randomBytes(18).toString("base64url");
}

function phoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export function findRegistrationByContact(db, query) {
  const raw = String(query || "").trim();
  if (!raw) return null;
  const byReference = db
    .prepare("SELECT id, status FROM registrations WHERE lower(reference) = ? ORDER BY id DESC")
    .all(raw.toLowerCase());
  if (byReference.length) {
    const chosen = byReference.find((row) => row.status !== "cancelled") || byReference[0];
    return getRegistration(db, chosen.id);
  }
  const value = raw.toLowerCase();
  const rows = value.includes("@")
    ? db.prepare("SELECT id, status FROM registrations WHERE lower(email) = ? ORDER BY id DESC").all(value)
    : db.prepare("SELECT id, status, mobile FROM registrations ORDER BY id DESC").all().filter((row) => phoneKey(row.mobile) === phoneKey(value) && phoneKey(value));
  if (!rows.length) return null;
  const chosen = rows.find((row) => row.status !== "cancelled") || rows[0];
  return getRegistration(db, chosen.id);
}

export function getRegistration(db, id) {
  const registration = db.prepare(`
    SELECT r.*, p.name AS product_name, p.code AS product_code
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE r.id = ?
  `).get(id);
  if (!registration) return null;
  const installments = db.prepare(`
    SELECT * FROM registration_installments
    WHERE registration_id = ?
    ORDER BY sequence
  `).all(id);
  return {
    ...registration,
    balance_cents: registrationBalance(db, id),
    installment_count: installments.length,
    installments,
  };
}

export function resumeTokenMatches(registration, token) {
  const given = String(token || "");
  const expected = String(registration?.resume_token || "");
  if (!given || !expected || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export function ensureResumeToken(db, registration) {
  if (!registration) return null;
  if (registration.resume_token) return registration;
  const value = token();
  db.prepare("UPDATE registrations SET resume_token = ? WHERE id = ? AND resume_token IS NULL").run(value, registration.id);
  return getRegistration(db, registration.id);
}

export function getEntryPass(db, qrToken) {
  const value = String(qrToken || "").trim();
  if (!value) return null;
  const row = db.prepare("SELECT id FROM registrations WHERE qr_token = ?").get(value);
  if (!row) return null;
  const registration = getRegistration(db, row.id);
  if (!registration || registration.status !== "confirmed" || !registration.fully_paid_at) return null;
  if (registration.balance_cents !== 0) return null;
  return {
    fullName: registration.full_name,
    tierName: registration.product_name,
    reference: registration.reference,
    event: "June 16–17, 2027 · Newport Performing Arts Theater, Pasay City",
  };
}

export function createRegistration(db, input) {
  const run = db.transaction(() => {
    if (input.productCode === "test" && !testTicketEnabled()) throw new Error("Unknown ticket");
    const product = db.prepare("SELECT * FROM ticket_products WHERE code = ? AND active = 1").get(input.productCode);
    if (!product) throw new Error("Unknown ticket");
    if (input.paymentPlan === "installment" && !product.allows_installment) {
      throw new Error("This ticket is paid in full");
    }
    const plan = input.paymentPlan === "installment"
      ? db.prepare("SELECT * FROM installment_plan_items WHERE product_id = ? ORDER BY sequence").all(product.id)
      : [];
    if (input.paymentPlan === "installment" && plan.length === 0) {
      throw new Error("This ticket has no installment schedule");
    }
    const priced = input.couponCode
      ? claimCoupon(db, {
        code: input.couponCode,
        productCode: input.productCode,
        paymentPlan: input.paymentPlan,
        email: input.email,
        today: input.registeredOn,
        registeredOn: input.registeredOn,
      })
      : priceCoupon(db, {
        productCode: input.productCode,
        paymentPlan: input.paymentPlan,
        registeredOn: input.registeredOn,
      });
    if (priced.error) throw new Error(priced.error);
    const result = db.prepare(`
      INSERT INTO registrations (
        reference, product_id, payment_plan, full_name, email, mobile,
        amount_due_cents, currency, status, registered_on,
        attendee_type, business, industry, chapter, invited_by, plan_status, coupon_code, resume_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      reference(),
      product.id,
      input.paymentPlan,
      input.fullName.trim(),
      input.email.trim().toLowerCase(),
      input.mobile.trim(),
      priced.totalCents,
      product.currency,
      input.registeredOn,
      input.attendeeType || "guest",
      input.business?.trim() || null,
      input.industry?.trim() || null,
      input.chapter?.trim() || null,
      input.invitedBy?.trim() || null,
      priced.code || null,
      token(),
    );
    const insertItem = db.prepare(`
      INSERT INTO registration_installments (registration_id, sequence, kind, due_on, days_after, amount_cents)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    priced.amounts.forEach((item, index) => {
      if (item.amount_cents <= 0 && index > 0) return;
      insertItem.run(
        result.lastInsertRowid,
        index + 1,
        item.kind,
        dueOnFor(item, input.registeredOn),
        item.kind === "days_after" ? Number(item.days_after) || 0 : null,
        item.amount_cents,
      );
    });
    if (priced.totalCents === 0) {
      const paidAt = new Date().toISOString();
      db.prepare(`
        UPDATE registration_installments
        SET amount_paid_cents = amount_cents, status = 'paid', paid_at = ?
        WHERE registration_id = ?
      `).run(paidAt, result.lastInsertRowid);
      db.prepare(`
        UPDATE registrations
        SET qr_token = ?, fully_paid_at = ?, plan_status = 'fully_paid'
        WHERE id = ?
      `).run(token(), paidAt, result.lastInsertRowid);
    }
    return result.lastInsertRowid;
  });
  return getRegistration(db, run());
}

export function registrationContactClash(db, { email, mobile, excludeId = 0 }) {
  const nextEmail = String(email || "").trim().toLowerCase();
  if (nextEmail) {
    const emailOwner = db.prepare(`
      SELECT id FROM registrations
      WHERE lower(email) = ? AND id != ? AND status != 'cancelled'
    `).get(nextEmail, excludeId);
    if (emailOwner) return "That email is already on a registration.";
  }
  const digits = String(mobile || "").replace(/\D/g, "");
  if (!phoneKey(mobile) && !digits) return "";
  const owner = db.prepare(`
    SELECT id, mobile FROM registrations WHERE id != ? AND status != 'cancelled'
  `).all(excludeId).find((row) => sameMobile(row.mobile, mobile));
  if (owner) return "That mobile number is already on a registration.";
  return "";
}

function sameMobile(left, right) {
  const a = String(left || "").replace(/\D/g, "");
  const b = String(right || "").replace(/\D/g, "");
  if (!a || !b) return false;
  const aKey = phoneKey(a);
  const bKey = phoneKey(b);
  if (aKey && bKey) return aKey === bKey;
  return a === b;
}

export function updateBadge(db, id, input) {
  const fullName = String(input.fullName || "").trim();
  const business = String(input.business || "").trim();
  if (!fullName || !business) {
    const error = new Error("Add the name and company name for your badge.");
    error.status = 400;
    throw error;
  }
  db.prepare("UPDATE registrations SET full_name = ?, business = ? WHERE id = ?").run(fullName, business, id);
  return getRegistration(db, id);
}

export function updateRegistration(db, id, input) {
  const email = input.email.trim().toLowerCase();
  const mobile = input.mobile.trim();
  const clash = registrationContactClash(db, { email, mobile, excludeId: id });
  if (clash) throw new Error(clash);
  db.prepare(`
    UPDATE registrations
    SET full_name = ?, email = ?, mobile = ?, business = ?, industry = ?, chapter = ?
    WHERE id = ?
  `).run(
    input.fullName.trim(),
    email,
    mobile,
    input.business?.trim() || null,
    input.industry?.trim() || null,
    input.chapter?.trim() || null,
    id,
  );
  return getRegistration(db, id);
}

export function cancelRegistration(db, id) {
  db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ? AND status != 'cancelled'").run(id);
  return getRegistration(db, id);
}

export function recordPayment(db, input) {
  const run = db.transaction(() => {
    const registration = getRegistration(db, input.registrationId);
    if (!registration || registration.status !== "confirmed") throw new Error("Registration is not payable");
    const target = input.installmentId
      ? registration.installments.find((item) => item.id === input.installmentId)
      : registration.installments.find((item) => item.status === "due");
    if (!target || target.status !== "due") throw new Error("No installment is due");
    const remaining = target.amount_cents - target.amount_paid_cents;
    if (input.amountCents <= 0 || input.amountCents > remaining) {
      throw new Error("Payment does not match the amount still due");
    }
    db.prepare(`
      INSERT INTO payments (registration_id, installment_id, amount_cents, currency, method, external_reference)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      registration.id,
      target.id,
      input.amountCents,
      registration.currency,
      input.method || null,
      input.externalReference || null,
    );
    const paid = target.amount_paid_cents + input.amountCents;
    const settled = paid >= target.amount_cents;
    db.prepare(`
      UPDATE registration_installments
      SET amount_paid_cents = ?, status = ?, paid_at = ?
      WHERE id = ?
    `).run(paid, settled ? "paid" : "due", settled ? new Date().toISOString() : null, target.id);
    if (settled && target.sequence === 1 && target.kind === "on_registration") {
      const paidOn = manilaParts().date;
      const later = db.prepare(`
        SELECT id, days_after FROM registration_installments
        WHERE registration_id = ? AND kind = 'days_after' AND days_after IS NOT NULL AND status != 'paid'
      `).all(registration.id);
      const updateDue = db.prepare("UPDATE registration_installments SET due_on = ? WHERE id = ?");
      for (const item of later) updateDue.run(addDays(paidOn, item.days_after), item.id);
    }
    const balance = registrationBalance(db, registration.id);
    if (balance === 0) {
      db.prepare(`
        UPDATE registrations
        SET qr_token = COALESCE(qr_token, ?), fully_paid_at = COALESCE(fully_paid_at, ?), plan_status = 'fully_paid'
        WHERE id = ?
      `).run(token(), new Date().toISOString(), registration.id);
    }
    return registration.id;
  });
  return getRegistration(db, run());
}

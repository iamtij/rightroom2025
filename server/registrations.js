import crypto from "crypto";
import { claimCoupon, priceCoupon } from "./coupons.js";
import { registrationBalance } from "./db.js";

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
  const value = String(query || "").trim().toLowerCase();
  if (!value) return null;
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

export function createRegistration(db, input) {
  const run = db.transaction(() => {
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
        attendee_type, business, industry, chapter, invited_by, plan_status, coupon_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, 'active', ?)
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
    );
    const insertItem = db.prepare(`
      INSERT INTO registration_installments (registration_id, sequence, kind, due_on, amount_cents)
      VALUES (?, ?, ?, ?, ?)
    `);
    priced.amounts.forEach((item, index) => {
      if (item.amount_cents <= 0 && index > 0) return;
      insertItem.run(
        result.lastInsertRowid,
        index + 1,
        item.kind,
        item.kind === "on_registration" || item.kind === "full" ? input.registeredOn : item.due_on,
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

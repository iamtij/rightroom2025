import crypto from "crypto";
import { claimCoupon, priceCoupon } from "./coupons.js";
import { registrationBalance, testTicketEnabled } from "./db.js";
import { hitpayRewardPurpose, pricePlan, resolveGoldReward, scheduleNoteFromInstallments } from "./gold-club.js";
import { syncRosterTickets } from "./members.js";
import { stagingTestRegistrationAllowed } from "./staging-early-payments.js";
import { addDays, manilaParts } from "./time.js";

export { hitpayRewardPurpose, scheduleNoteFromInstallments };

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

/** Last 10 digits for PH mobile linkage; empty string when input is not a valid phone query. */
export function registrationPhoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

/** True only when stored mobile normalizes to the query key (ignores stale phone_key column). */
export function registrationMobileMatchesPhoneQuery(mobile, queryKey) {
  const key = String(queryKey || "").trim();
  if (!key) return false;
  const mobileKey = registrationPhoneKey(mobile);
  return mobileKey !== "" && mobileKey === key;
}

function phoneKey(value) {
  return registrationPhoneKey(value);
}

/**
 * Resolve a registration by email, mobile, or reference. Fails closed on ambiguous mobile matches.
 */
export function resolveRegistrationByContact(db, query) {
  const raw = String(query || "").trim();
  if (!raw) return { registration: null };
  const byReference = db
    .prepare("SELECT id, status FROM registrations WHERE lower(reference) = ? ORDER BY id DESC")
    .all(raw.toLowerCase());
  if (byReference.length) {
    const chosen = byReference.find((row) => row.status !== "cancelled") || byReference[0];
    return { registration: getRegistration(db, chosen.id) };
  }
  const value = raw.toLowerCase();
  if (value.includes("@")) {
    const rows = db.prepare("SELECT id, status FROM registrations WHERE lower(email) = ? ORDER BY id DESC").all(value);
    if (!rows.length) return { registration: null };
    const chosen = rows.find((row) => row.status !== "cancelled") || rows[0];
    return { registration: getRegistration(db, chosen.id) };
  }
  const key = registrationPhoneKey(raw);
  if (!key) return { registration: null };
  const active = db
    .prepare("SELECT id, status, lower(email) AS email, mobile, phone_key FROM registrations WHERE mobile IS NOT NULL AND trim(mobile) != ''")
    .all()
    .filter((row) => row.status !== "cancelled" && registrationMobileMatchesPhoneQuery(row.mobile, key))
    .sort((a, b) => b.id - a.id);
  if (!active.length) return { registration: null };
  const distinctEmails = [...new Set(active.map((row) => row.email).filter(Boolean))];
  if (distinctEmails.length > 1) {
    return {
      registration: null,
      error: "More than one registration uses this mobile. Use your email or registration reference instead.",
      status: 409,
    };
  }
  return { registration: getRegistration(db, active[0].id) };
}

export function findRegistrationByContact(db, query) {
  return resolveRegistrationByContact(db, query).registration;
}

export function getRegistration(db, id) {
  const registration = db.prepare(`
    SELECT r.*, p.name AS product_name, p.code AS product_code, p.fee_bearer AS fee_bearer
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

const TEST_ENTRY_PASS_PRODUCTS = new Set(["test", "test_50", "test_100", "test_200"]);

export function entryPassProductAllowed(productCode) {
  if (!TEST_ENTRY_PASS_PRODUCTS.has(productCode)) return true;
  return stagingTestRegistrationAllowed();
}

export function entryPassEligible(registration) {
  if (!registration) return false;
  if (registration.status !== "confirmed" || !registration.fully_paid_at) return false;
  if (registration.balance_cents !== 0 || !registration.qr_token) return false;
  return entryPassProductAllowed(registration.product_code);
}

export function getEntryPass(db, qrToken) {
  const value = String(qrToken || "").trim();
  if (!value) return null;
  const row = db.prepare("SELECT id FROM registrations WHERE qr_token = ?").get(value);
  if (!row) return null;
  const registration = getRegistration(db, row.id);
  if (!entryPassEligible(registration)) return null;
  return {
    fullName: registration.full_name,
    tierName: registration.product_name,
    reference: registration.reference,
    event: "June 16–17, 2027 · Newport Performing Arts Theater, Pasay City",
  };
}

function memberForInput(db, input) {
  if (input.member?.id) return input.member;
  const email = String(input.email || "").trim().toLowerCase();
  if (email) {
    const byEmail = db.prepare("SELECT * FROM members WHERE email = ?").get(email);
    if (byEmail) return byEmail;
  }
  const key = phoneKey(input.mobile);
  if (!key) return null;
  const byPhone = db.prepare("SELECT * FROM members WHERE phone_key = ?").all(key);
  return byPhone.length === 1 ? byPhone[0] : null;
}

export function createRegistration(db, input) {
  const run = db.transaction(() => {
    if (input.productCode === "test" && !testTicketEnabled()) throw new Error("Unknown ticket");
    if (
      (input.productCode === "test_50" || input.productCode === "test_100" || input.productCode === "test_200")
      && !stagingTestRegistrationAllowed()
    ) {
      throw new Error("Unknown ticket");
    }
    const clash = registrationContactClash(db, { email: input.email, mobile: input.mobile });
    if (clash) {
      const error = new Error(clash);
      error.status = 400;
      throw error;
    }
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
    const member = memberForInput(db, input);
    const goldReward = member ? resolveGoldReward(member) : "GOLD_NONE";
    const priced = goldReward !== "GOLD_NONE"
      ? priceCoupon(db, {
        productCode: input.productCode,
        paymentPlan: input.paymentPlan,
        registeredOn: input.registeredOn,
      })
      : input.couponCode
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
    const gold = goldReward === "GOLD_NONE"
      ? null
      : pricePlan(priced.amounts, goldReward, product.currency);
    const amounts = gold
      ? gold.rows.map((row, index) => ({
        ...priced.amounts[index],
        amount_cents: row.amountCents,
        list_amount_cents: row.listAmountCents,
        covered: row.covered,
      }))
      : priced.amounts;
    const totalCents = gold ? gold.totalCents : priced.totalCents;
    if (totalCents === 0 && goldReward !== "GOLD_FREE") {
      const error = new Error("That coupon can't cover the full ticket.");
      error.status = 400;
      throw error;
    }
    const result = db.prepare(`
      INSERT INTO registrations (
        reference, product_id, payment_plan, full_name, email, mobile, phone_key,
        amount_due_cents, currency, status, registered_on,
        attendee_type, business, industry, chapter, invited_by, plan_status, coupon_code, resume_token,
        gold_club, gold_reward_at, gold_reward_current, gold_reward_status, gold_list_cents, gold_discount_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reference(),
      product.id,
      input.paymentPlan,
      input.fullName.trim(),
      input.email.trim().toLowerCase(),
      input.mobile.trim(),
      phoneKey(input.mobile) || null,
      totalCents,
      product.currency,
      input.registeredOn,
      input.attendeeType || "guest",
      input.business?.trim() || null,
      input.industry?.trim() || null,
      input.chapter?.trim() || null,
      input.invitedBy?.trim() || null,
      gold ? null : priced.code || null,
      token(),
      member && Number(member.gold_club) ? 1 : 0,
      member ? goldReward : null,
      member ? goldReward : null,
      member && Number(member.gold_club) ? "provisional" : null,
      gold ? gold.listCents : null,
      gold ? gold.discountCents : null,
    );
    const insertItem = db.prepare(`
      INSERT INTO registration_installments (
        registration_id, sequence, kind, due_on, days_after, amount_cents, list_amount_cents, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    amounts.forEach((item, index) => {
      const covered = Boolean(item.covered);
      if (item.amount_cents <= 0 && index > 0 && !covered) return;
      insertItem.run(
        result.lastInsertRowid,
        index + 1,
        item.kind,
        dueOnFor(item, input.registeredOn),
        item.kind === "days_after" ? Number(item.days_after) || 0 : null,
        item.amount_cents,
        item.list_amount_cents ?? item.amount_cents,
        covered ? "waived" : "due",
      );
    });
    if (goldReward === "GOLD_FREE") {
      db.prepare(`
        UPDATE registrations
        SET qr_token = ?, fully_paid_at = ?, plan_status = 'fully_paid'
        WHERE id = ?
      `).run(token(), new Date().toISOString(), result.lastInsertRowid);
    }
    return result.lastInsertRowid;
  });
  const registration = getRegistration(db, run());
  syncRosterTickets(db, { email: registration.email, mobile: registration.mobile });
  if (registration.gold_reward_current === "GOLD_FREE" && registration.qr_token && registration.balance_cents === 0) {
    import("./reminders.js").then(({ queueEntryPassAfterPayment }) => {
      queueEntryPassAfterPayment(db, registration.id);
    });
  }
  return registration;
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
  const key = phoneKey(mobile);
  if (!key) return "";
  const owner = db.prepare(`
    SELECT id FROM registrations WHERE phone_key = ? AND id != ? AND status != 'cancelled'
  `).get(key, excludeId);
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
  const previous = db.prepare("SELECT email, mobile FROM registrations WHERE id = ?").get(id);
  const email = input.email.trim().toLowerCase();
  const mobile = input.mobile.trim();
  const clash = registrationContactClash(db, { email, mobile, excludeId: id });
  if (clash) throw new Error(clash);
  db.prepare(`
    UPDATE registrations
    SET full_name = ?, email = ?, mobile = ?, phone_key = ?, business = ?, industry = ?, chapter = ?
    WHERE id = ?
  `).run(
    input.fullName.trim(),
    email,
    mobile,
    phoneKey(mobile) || null,
    input.business?.trim() || null,
    input.industry?.trim() || null,
    input.chapter?.trim() || null,
    id,
  );
  if (previous) syncRosterTickets(db, previous, { clear: true });
  syncRosterTickets(db, { email, mobile }, { clear: true });
  return getRegistration(db, id);
}

export function cancelRegistration(db, id) {
  const current = db.prepare("SELECT email, mobile FROM registrations WHERE id = ?").get(id);
  db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ? AND status != 'cancelled'").run(id);
  if (current) syncRosterTickets(db, current, { clear: true });
  return getRegistration(db, id);
}

export function discardUnopenedRegistration(db, id) {
  const row = db.prepare("SELECT id, coupon_code, email, mobile FROM registrations WHERE id = ?").get(id);
  if (!row) return false;
  const paid = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE registration_id = ?").get(id).n;
  if (paid) return false;
  const remove = db.transaction(() => {
    if (row.coupon_code) {
      db.prepare("UPDATE coupons SET usage_count = MAX(usage_count - 1, 0) WHERE code = ?").run(row.coupon_code);
    }
    for (const table of ["upay_payments", "hitpay_payments", "paynamics_payments", "pass_scans", "reminder_dispatches", "schedule_sends", "payments", "registration_installments"]) {
      db.prepare(`DELETE FROM ${table} WHERE registration_id = ?`).run(id);
    }
    db.prepare("DELETE FROM registrations WHERE id = ?").run(id);
  });
  remove();
  syncRosterTickets(db, { email: row.email, mobile: row.mobile }, { clear: true });
  return true;
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
    const paymentInsert = db.prepare(`
      INSERT INTO payments (registration_id, installment_id, amount_cents, currency, method, external_reference, admin_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      registration.id,
      target.id,
      input.amountCents,
      registration.currency,
      input.method || null,
      input.externalReference || null,
      input.adminUserId || null,
    );
    const paymentId = paymentInsert.lastInsertRowid;
    if (input.adminUserId) {
      const action = input.method === "comp" ? "registration.comp" : "registration.payment";
      db.prepare(`
        INSERT INTO admin_audit (admin_id, action, target, amount_cents)
        VALUES (?, ?, ?, ?)
      `).run(input.adminUserId, action, registration.reference, input.amountCents);
    }
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
    return { registrationId: registration.id, paymentId };
  });
  const { registrationId, paymentId } = run();
  const updated = getRegistration(db, registrationId);
  import("./reminders.js").then(({ queuePaymentConfirmationAfterPayment, queueEntryPassAfterPayment }) => {
    queuePaymentConfirmationAfterPayment(db, registrationId, paymentId);
    if (updated.balance_cents === 0 && updated.fully_paid_at && updated.qr_token) {
      queueEntryPassAfterPayment(db, registrationId);
    }
  });
  return updated;
}

export function compRegistration(db, registrationId, adminUserId) {
  let current = getRegistration(db, registrationId);
  if (!current || current.status !== "confirmed") {
    const error = new Error("Registration is not payable");
    error.status = 400;
    throw error;
  }
  let guard = 0;
  while (current.balance_cents > 0 && guard < 12) {
    const due = current.installments.find((item) => item.status === "due");
    if (!due) break;
    current = recordPayment(db, {
      registrationId: current.id,
      installmentId: due.id,
      amountCents: due.amount_cents - due.amount_paid_cents,
      method: "comp",
      adminUserId,
    });
    guard += 1;
  }
  return current;
}

export function admitPass(db, qrToken, adminId, override) {
  const value = String(qrToken || "").trim();
  const pass = getEntryPass(db, value);
  if (!pass) return { error: "This QR ticket isn't valid.", status: 404 };
  const registration = db.prepare("SELECT id, reference FROM registrations WHERE qr_token = ?").get(value);
  const existing = db.prepare(`
    SELECT created_at FROM pass_scans
    WHERE registration_id = ? AND result IN ('admitted', 'override')
    ORDER BY id DESC LIMIT 1
  `).get(registration.id);
  if (existing && !override) {
    return { error: "This ticket was already scanned.", status: 409, scannedAt: existing.created_at, pass };
  }
  const result = existing ? "override" : "admitted";
  db.prepare("INSERT INTO pass_scans (registration_id, result, admin_id) VALUES (?, ?, ?)").run(registration.id, result, adminId);
  return { pass, result, reference: registration.reference };
}

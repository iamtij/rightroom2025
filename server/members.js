import { createHmac, timingSafeEqual } from "crypto";
import { memberGoldOffer, pricePlan, resolveGoldReward, syncMemberRewards } from "./gold-club.js";
import { priceCoupon } from "./coupons.js";
import { cancelRegistration, createRegistration, findRegistrationByContact, recordPayment, registrationHasRecordedPayment } from "./registrations.js";
import { manilaParts } from "./time.js";

const STATUSES = new Set(["updated", "delayed", "cancelled"]);
const GOLD_REWARDS = new Set(["GOLD_FREE", "GOLD_50", "GOLD_3000"]);
const PROOF_WINDOW = 2 * 60 * 60 * 1000;

function proofSecret() {
  const dedicated = String(process.env.MEMBER_EDIT_SECRET || "").trim();
  if (dedicated) return dedicated;
  const root = String(process.env.ADMIN_SESSION_SECRET || "").trim();
  if (root) return createHmac("sha256", root).update("ibmc-member-lookup-v1").digest("hex");
  return "ibmc-dev-session";
}

function phoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export function findMemberRow(db, query) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return null;
  if (value.includes("@")) return db.prepare("SELECT * FROM members WHERE lower(email) = ?").get(value) || null;
  const key = phoneKey(value);
  if (!key) return null;
  return db.prepare("SELECT * FROM members WHERE phone_key = ?").get(key) || null;
}

export function memberPreview(db, query) {
  const row = findMemberRow(db, query);
  if (!row) return null;
  const email = String(row.email || "").trim().toLowerCase();
  if (!email.includes("@")) return null;
  const fullName = String(row.full_name || "").trim();
  return {
    firstName: fullName.split(/\s+/).filter(Boolean)[0] || "",
    chapter: String(row.chapter || "").trim(),
    email,
  };
}

/** Confirmed registration owned by this member email or mobile, if any. */
export function memberOwnedRegistration(db, member) {
  if (!member) return null;
  const email = String(member.email || "").trim().toLowerCase();
  const byEmail = email ? findRegistrationByContact(db, email) : null;
  const emailOwned = byEmail
    && byEmail.status === "confirmed"
    && String(byEmail.email || "").trim().toLowerCase() === email
    ? byEmail
    : null;
  const mobile = String(member.mobile || "").trim();
  const byMobile = mobile ? findRegistrationByContact(db, mobile) : null;
  const mobileOwned = byMobile && byMobile.status === "confirmed" ? byMobile : null;
  return emailOwned || mobileOwned || null;
}

/** OTP is required only after the member has paid (installment or full). */
export function memberRequiresOtp(db, member) {
  const owned = memberOwnedRegistration(db, member);
  return Boolean(owned && registrationHasRecordedPayment(db, owned.id));
}

export function signMemberProof(memberId) {
  const payload = Buffer.from(JSON.stringify({ id: memberId, exp: Date.now() + PROOF_WINDOW })).toString("base64url");
  const signature = createHmac("sha256", proofSecret()).update(`member-lookup:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function memberFromProof(db, token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", proofSecret()).update(`member-lookup:${payload}`).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data?.id || Number(data.exp) < Date.now()) return null;
    return db.prepare("SELECT * FROM members WHERE id = ?").get(Number(data.id)) || null;
  } catch {
    return null;
  }
}

export function parseMemberCsv(csv) {
  const rows = [];
  const lines = String(csv || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return rows;
  const headers = splitCsv(lines[0]).map((header) => header.trim().toLowerCase());
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line);
    const record = Object.fromEntries(headers.map((header, index) => [header, (cells[index] || "").trim()]));
    const member = memberFromRecord(record);
    if (member) rows.push(member);
  }
  return rows;
}

function memberFromRecord(record) {
  const fullName = pick(record, ["name", "full name", "full_name"]);
  const email = pick(record, ["email"]).toLowerCase();
  const mobile = pick(record, ["mobile", "phone", "mobile number"]);
  if (!fullName || !email || !mobile) return null;
  const status = pick(record, ["reg status", "reg_status", "status"]).toLowerCase();
  const gold = pick(record, ["gold club member", "gold club", "gold_club", "gold"]).toLowerCase();
  return {
    fullName,
    email,
    mobile,
    chapter: pick(record, ["chapter"]),
    category: pick(record, ["category", "industry"]),
    businessName: pick(record, ["business name", "business", "business_name"]),
    ticketType: pick(record, ["ticket type", "ticket", "ticket_type"]),
    regStatus: STATUSES.has(status) ? status : "updated",
    country: pick(record, ["country"]),
    goldClub: ["1", "true", "yes", "y"].includes(gold),
  };
}

function pick(record, keys) {
  for (const key of keys) {
    if (record[key]) return record[key];
  }
  return "";
}

function splitCsv(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

export function saveMember(db, input) {
  const status = STATUSES.has(input.regStatus) ? input.regStatus : "updated";
  db.prepare(`
    INSERT INTO members (
      full_name, email, mobile, phone_key, chapter, category, business_name, ticket_type,
      reg_status, country, gold_club, sponsors_2026, sponsors_aug_dec_2026, sponsor_data_as_of, gold_reward,
      registered_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET
      full_name = excluded.full_name,
      mobile = excluded.mobile,
      phone_key = excluded.phone_key,
      chapter = excluded.chapter,
      category = excluded.category,
      business_name = excluded.business_name,
      ticket_type = excluded.ticket_type,
      reg_status = excluded.reg_status,
      country = excluded.country,
      gold_club = excluded.gold_club,
      sponsors_2026 = COALESCE(excluded.sponsors_2026, members.sponsors_2026),
      sponsors_aug_dec_2026 = COALESCE(excluded.sponsors_aug_dec_2026, members.sponsors_aug_dec_2026),
      sponsor_data_as_of = COALESCE(excluded.sponsor_data_as_of, members.sponsor_data_as_of),
      gold_reward = COALESCE(excluded.gold_reward, members.gold_reward),
      registered_at = excluded.registered_at,
      updated_at = datetime('now')
  `).run(
    input.fullName.trim(),
    input.email.trim().toLowerCase(),
    input.mobile.trim(),
    phoneKey(input.mobile) || null,
    blank(input.chapter),
    blank(input.category),
    blank(input.businessName),
    blank(input.ticketType),
    status,
    blank(input.country),
    input.goldClub ? 1 : 0,
    countOrNull(input.sponsors2026),
    countOrNull(input.sponsorsAugDec2026),
    blank(input.sponsorDataAsOf),
    rewardOrNull(input.goldReward),
    "",
  );
  syncRosterTickets(db, { email: input.email, mobile: input.mobile });
  const saved = db.prepare("SELECT * FROM members WHERE email = ?").get(input.email.trim().toLowerCase());
  if (saved) {
    syncMemberRewards(db, saved);
    import("./messaging.js").then(({ syncMemberNotRegisteredTag }) => {
      syncMemberNotRegisteredTag(db, saved.id);
    }).catch((error) => {
      console.error("[messaging] audience tag sync failed", error);
    });
  }
  return saved;
}

export function memberContactClash(db, { email, mobile, excludeId = 0 }) {
  const nextEmail = String(email || "").trim().toLowerCase();
  if (nextEmail) {
    const emailOwner = db.prepare("SELECT id FROM members WHERE email = ? AND id != ?").get(nextEmail, excludeId);
    if (emailOwner) return "That email is already on the roster.";
  }
  const key = phoneKey(mobile);
  if (!key) return "";
  const owner = db.prepare("SELECT id FROM members WHERE phone_key = ? AND id != ?").get(key, excludeId);
  if (owner) return "That mobile number is already on the roster.";
  return "";
}

export function updateMemberRecord(db, id, input) {
  const existing = db.prepare("SELECT * FROM members WHERE id = ?").get(id);
  if (!existing) return { error: "Member not found", status: 404 };
  const fullName = String(input.fullName || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const mobile = String(input.mobile || "").trim();
  if (!fullName || !email.includes("@") || !mobile) {
    return { error: "Name, email, and mobile are required", status: 400 };
  }
  const clash = memberContactClash(db, { email, mobile, excludeId: existing.id });
  if (clash) return { error: clash, status: 400 };
  const status = STATUSES.has(input.regStatus) ? input.regStatus : existing.reg_status;
  db.prepare(`
    UPDATE members SET
      full_name = ?, email = ?, mobile = ?, phone_key = ?, chapter = ?, category = ?, business_name = ?,
      ticket_type = ?, reg_status = ?, country = ?, gold_club = ?, sponsors_2026 = ?, sponsors_aug_dec_2026 = ?,
      sponsor_data_as_of = ?, gold_reward = ?, registered_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    fullName,
    email,
    mobile,
    phoneKey(mobile) || null,
    blank(input.chapter),
    blank(input.category),
    blank(input.businessName),
    blank(input.ticketType),
    status,
    blank(input.country),
    input.goldClub ? 1 : 0,
    countOrNull(input.sponsors2026),
    countOrNull(input.sponsorsAugDec2026),
    blank(input.sponsorDataAsOf),
    rewardOrNull(input.goldReward),
    "",
    existing.id,
  );
  syncRosterTickets(db, { email, mobile });
  const saved = db.prepare("SELECT * FROM members WHERE id = ?").get(existing.id);
  if (saved) {
    syncMemberRewards(db, saved);
    import("./messaging.js").then(({ syncMemberNotRegisteredTag }) => {
      syncMemberNotRegisteredTag(db, saved.id);
    }).catch((error) => {
      console.error("[messaging] audience tag sync failed", error);
    });
  }
  return { member: listMembers(db).find((member) => member.id === existing.id) };
}

export function updateMemberProfile(db, currentEmail, input) {
  const email = String(currentEmail || "").trim().toLowerCase();
  const existing = db.prepare("SELECT * FROM members WHERE email = ?").get(email);
  if (!existing) return { error: "We couldn't find that membership", status: 404 };
  const fullName = String(input.fullName || "").trim();
  const business = String(input.business || "").trim();
  const industry = String(input.industry || "").trim();
  const mobile = String(input.mobile || "").trim();
  const nextEmail = String(input.email || email).trim().toLowerCase();
  const chapter = String(input.chapter || "").trim();
  if (!fullName || !business || !industry || !chapter || !mobile || !nextEmail.includes("@")) {
    return { error: "Add your name, business, industry, chapter, email, and mobile number.", status: 400 };
  }
  const known = db.prepare("SELECT name FROM chapters WHERE lower(name) = lower(?)").get(chapter);
  const sameAsCurrent = chapter.toLowerCase() === String(existing.chapter || "").trim().toLowerCase();
  if (!known && !sameAsCurrent) return { error: "Choose a chapter from the list.", status: 400 };
  const clash = memberContactClash(db, { email: nextEmail, mobile, excludeId: existing.id });
  if (clash) return { error: clash, status: 400 };
  db.prepare(`
    UPDATE members SET
      full_name = ?, email = ?, mobile = ?, phone_key = ?, category = ?, business_name = ?, chapter = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(fullName, nextEmail, mobile, phoneKey(mobile) || null, industry, business, known?.name || chapter, existing.id);
  const member = lookupMember(db, nextEmail);
  if (!member) return { error: "We couldn't find that membership", status: 404 };
  const { id, ...visible } = member;
  return { member: visible };
}

export function listMembers(db) {
  syncRosterTickets(db);
  const ownedByContact = confirmedRegistrationIndex(db);
  return db.prepare("SELECT * FROM members ORDER BY registered_at DESC, id DESC").all()
    .map((row) => presentMember(row, ownedRegistrationForMember(row, ownedByContact)));
}

function confirmedRegistrationIndex(db) {
  const rows = db.prepare(`
    SELECT reference, email, mobile, phone_key, created_at
    FROM registrations
    WHERE status = 'confirmed'
    ORDER BY id DESC
  `).all();
  const byEmail = new Map();
  const byPhone = new Map();
  for (const row of rows) {
    const owned = { reference: row.reference, createdAt: row.created_at || null };
    const email = String(row.email || "").trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, owned);
    const key = row.phone_key || phoneKey(row.mobile);
    if (key && !byPhone.has(key)) byPhone.set(key, owned);
  }
  return { byEmail, byPhone };
}

function ownedRegistrationForMember(member, index) {
  const email = String(member.email || "").trim().toLowerCase();
  if (email && index.byEmail.has(email)) return index.byEmail.get(email);
  const key = member.phone_key || phoneKey(member.mobile);
  if (key && index.byPhone.has(key)) return index.byPhone.get(key);
  return null;
}

function localTicketProducts(db) {
  return db.prepare(`
    SELECT code, name, currency, full_price_cents, allows_installment, sales_start, sales_end
    FROM ticket_products
    WHERE active = 1 AND audience = 'local' AND code NOT LIKE 'test%'
    ORDER BY sales_start, id
  `).all();
}

function defaultLocalProductCode(db, today = manilaParts().date) {
  const products = localTicketProducts(db);
  const inWindow = products.find((product) => today >= product.sales_start && today <= product.sales_end);
  return (inWindow || products[0])?.code || "first_mover";
}

function quoteMemberPlan(db, member, productCode, paymentPlan, today = manilaParts().date) {
  const product = db.prepare("SELECT * FROM ticket_products WHERE code = ? AND active = 1").get(productCode);
  if (!product) return { error: "Unknown ticket", status: 400 };
  if (product.audience !== "local") return { error: "Pick a local ticket for member registration.", status: 400 };
  if (paymentPlan === "installment" && !product.allows_installment) {
    return { error: "This ticket is paid in full", status: 400 };
  }
  const priced = priceCoupon(db, {
    productCode,
    paymentPlan,
    registeredOn: today,
    today,
  });
  if (priced.error) return priced;
  const goldReward = resolveGoldReward(member);
  const gold = goldReward === "GOLD_NONE"
    ? null
    : pricePlan(priced.amounts, goldReward, product.currency);
  const totalCents = gold ? gold.totalCents : priced.totalCents;
  const dueTodayCents = gold
    ? (gold.rows.find((row) => !row.covered)?.amountCents ?? 0)
    : priced.dueTodayCents;
  return {
    productCode: product.code,
    productName: product.name,
    currency: product.currency,
    paymentPlan,
    allowsInstallment: Boolean(product.allows_installment),
    goldReward,
    listCents: gold ? gold.listCents : priced.listCents,
    totalCents,
    dueTodayCents,
    discountCents: gold ? gold.discountCents : priced.discountCents || 0,
  };
}

export function memberRegisterOptions(db, memberId) {
  const row = db.prepare("SELECT * FROM members WHERE id = ?").get(Number(memberId));
  if (!row) return { error: "Member not found", status: 404 };
  const owned = memberOwnedRegistration(db, row);
  const today = manilaParts().date;
  const defaultProductCode = defaultLocalProductCode(db, today);
  const products = localTicketProducts(db).map((product) => {
    const full = quoteMemberPlan(db, row, product.code, "full", today);
    const installment = product.allows_installment
      ? quoteMemberPlan(db, row, product.code, "installment", today)
      : null;
    return {
      code: product.code,
      name: product.name,
      currency: product.currency,
      allowsInstallment: Boolean(product.allows_installment),
      inSalesWindow: today >= product.sales_start && today <= product.sales_end,
      salesStart: product.sales_start,
      salesEnd: product.sales_end,
      full: full.error ? null : full,
      installment: installment && !installment.error ? installment : null,
    };
  });
  return {
    member: presentMember(row, owned ? { reference: owned.reference, createdAt: owned.created_at || null } : null),
    registration: owned
      ? {
        reference: owned.reference,
        balanceCents: owned.balance_cents,
        plan: owned.payment_plan,
        tierName: owned.product_name,
      }
      : null,
    defaultProductCode,
    goldReward: resolveGoldReward(row),
    today,
    products,
  };
}

export function registerMemberByAdmin(db, memberId, input, adminUserId) {
  const row = db.prepare("SELECT * FROM members WHERE id = ?").get(Number(memberId));
  if (!row) return { error: "Member not found", status: 404 };
  const owned = memberOwnedRegistration(db, row);
  if (owned) {
    return {
      error: "This member is already registered.",
      status: 409,
      reference: owned.reference,
    };
  }

  const today = manilaParts().date;
  const paymentPlan = input.paymentPlan === "installment" ? "installment" : "full";
  const productCode = String(input.productCode || "").trim() || defaultLocalProductCode(db, today);
  const quote = quoteMemberPlan(db, row, productCode, paymentPlan, today);
  if (quote.error) return { error: quote.error, status: quote.status || 400 };

  const bankReference = String(input.bankReference || "").trim();
  const paidOn = String(input.paidOn || "").trim() || today;
  const notes = String(input.notes || "").trim();
  const amountReceivedRaw = input.amountReceivedCents;
  const amountReceivedCents = amountReceivedRaw === "" || amountReceivedRaw == null
    ? null
    : Number(amountReceivedRaw);
  if (amountReceivedCents != null && (!Number.isFinite(amountReceivedCents) || amountReceivedCents < 0)) {
    return { error: "Amount received must be a valid number.", status: 400 };
  }
  const sendEmail = input.sendEmail !== false;

  if (quote.dueTodayCents > 0 && !bankReference) {
    return { error: "Bank reference is required.", status: 400 };
  }

  let registration;
  try {
    registration = createRegistration(db, {
      productCode,
      paymentPlan,
      fullName: row.full_name,
      email: row.email,
      mobile: row.mobile,
      registeredOn: today,
      attendeeType: "member",
      business: row.business_name || "",
      industry: row.category || "",
      chapter: row.chapter || "",
      member: row,
      notify: sendEmail,
    });
  } catch (error) {
    return { error: error.message || "Registration was not saved", status: error.status || 400 };
  }

  if (registration.balance_cents <= 0) {
    if (bankReference || notes || amountReceivedCents != null) {
      db.prepare(`
        INSERT INTO admin_audit (admin_id, action, target, amount_cents)
        VALUES (?, 'member.bank_register', ?, ?)
      `).run(
        adminUserId || null,
        `${registration.reference}:${[bankReference, paidOn ? `paid ${paidOn}` : "", notes].filter(Boolean).join(" | ")}`.slice(0, 500),
        amountReceivedCents ?? 0,
      );
    }
    return { registration };
  }

  const due = registration.installments.find((item) => item.status === "due");
  if (!due) {
    cancelRegistration(db, registration.id);
    return { error: "Nothing is due on this ticket.", status: 400 };
  }

  const payAmount = due.amount_cents - due.amount_paid_cents;
  const noteParts = [];
  if (paidOn) noteParts.push(`Paid on ${paidOn}`);
  if (amountReceivedCents != null) {
    noteParts.push(`Amount received: ${(amountReceivedCents / 100).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`);
  }
  if (notes) noteParts.push(notes);
  const paymentNotes = noteParts.join(". ");

  try {
    registration = recordPayment(db, {
      registrationId: registration.id,
      installmentId: due.id,
      amountCents: payAmount,
      method: "bank",
      externalReference: bankReference || null,
      notes: paymentNotes || null,
      adminUserId,
      notify: sendEmail,
    });
  } catch (error) {
    cancelRegistration(db, registration.id);
    return { error: error.message || "Payment was not recorded", status: error.status || 400 };
  }

  db.prepare(`
    INSERT INTO admin_audit (admin_id, action, target, amount_cents)
    VALUES (?, 'member.bank_register', ?, ?)
  `).run(adminUserId || null, registration.reference, payAmount);

  return { registration };
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

function missingLabels(row) {
  const missing = [];
  if (!String(row.full_name || "").trim()) missing.push("name");
  if (!String(row.business_name || "").trim()) missing.push("business name");
  if (!String(row.category || "").trim()) missing.push("category");
  if (!String(row.chapter || "").trim()) missing.push("chapter");
  if (!String(row.email || "").includes("@")) missing.push("email");
  if (!phoneKey(row.mobile)) missing.push("mobile number");
  return missing;
}

export function lookupMember(db, query) {
  const row = findMemberRow(db, query);
  if (!row) return null;
  const digits = String(row.mobile || "").replace(/\D/g, "");
  const last4 = digits.slice(-4);
  const missing = missingLabels(row);
  return {
    id: row.id,
    fullName: row.full_name,
    business: row.business_name || "",
    industry: row.category || "",
    chapter: row.chapter || "",
    email: row.email,
    mobile: row.mobile,
    mobileMasked: last4 ? `+63 ••• ${last4}` : "",
    profileReady: missing.length === 0,
    missing,
    goldClub: Boolean(row.gold_club),
    gold: memberGoldOffer(db, row),
  };
}

export function toPublicMember(member, registered) {
  return {
    fullName: member.fullName,
    business: member.business,
    industry: member.industry,
    chapter: member.chapter,
    mobileMasked: member.mobileMasked,
    registered: Boolean(registered),
    profileReady: Boolean(member.profileReady),
    missing: member.missing || [],
    memberToken: signMemberProof(member.id),
  };
}

function presentMember(row, registration = null) {
  const owned = typeof registration === "string"
    ? { reference: registration, createdAt: null }
    : registration;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    chapter: row.chapter || "",
    category: row.category || "",
    businessName: row.business_name || "",
    ticketType: row.ticket_type || "",
    regStatus: row.reg_status,
    country: row.country || "",
    goldClub: Boolean(row.gold_club),
    sponsors2026: row.sponsors_2026 == null ? null : Number(row.sponsors_2026),
    sponsorsAugDec2026: row.sponsors_aug_dec_2026 == null ? null : Number(row.sponsors_aug_dec_2026),
    sponsorDataAsOf: row.sponsor_data_as_of || "",
    goldReward: row.gold_reward || "",
    registeredAt: owned?.createdAt || row.registered_at || "",
    registrationReference: owned?.reference || null,
  };
}

function countOrNull(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.trunc(number);
}

function rewardOrNull(value) {
  const text = String(value || "").trim();
  return GOLD_REWARDS.has(text) ? text : null;
}

function blank(value) {
  const text = String(value || "").trim();
  return text || null;
}

function membersMatching(db, contact) {
  const email = String(contact?.email || "").trim().toLowerCase();
  const key = phoneKey(contact?.mobile);
  const seen = new Set();
  const rows = [];
  const add = (row) => {
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };
  if (email) add(db.prepare("SELECT id, email, mobile, ticket_type FROM members WHERE email = ?").get(email));
  if (key) {
    for (const row of db.prepare("SELECT id, email, mobile, ticket_type FROM members WHERE phone_key = ?").all(key)) add(row);
  }
  return rows;
}

function ticketForMember(member, tickets) {
  const email = String(member.email || "").trim().toLowerCase();
  const key = phoneKey(member.mobile);
  if (email) {
    const byEmail = tickets.find((ticket) => String(ticket.email || "").trim().toLowerCase() === email);
    if (byEmail) return byEmail.product_name;
  }
  if (key) {
    const byPhone = tickets.find((ticket) => phoneKey(ticket.mobile) === key);
    if (byPhone) return byPhone.product_name;
  }
  return "";
}

export function syncRosterTickets(db, contact, { clear = false } = {}) {
  const tickets = db.prepare(`
    SELECT r.email, r.mobile, p.name AS product_name
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE r.status != 'cancelled'
    ORDER BY r.id DESC
  `).all();
  const members = contact
    ? membersMatching(db, contact)
    : db.prepare("SELECT id, email, mobile, ticket_type FROM members").all();
  const update = db.prepare("UPDATE members SET ticket_type = ?, updated_at = datetime('now') WHERE id = ?");
  const clearTicket = db.prepare("UPDATE members SET ticket_type = NULL, updated_at = datetime('now') WHERE id = ?");
  let changed = 0;
  for (const member of members) {
    const next = ticketForMember(member, tickets);
    const current = String(member.ticket_type || "");
    if (next) {
      if (current === next) continue;
      update.run(next, member.id);
      changed += 1;
    } else if (clear && current) {
      clearTicket.run(member.id);
      changed += 1;
    }
  }
  return changed;
}

import { createHmac, timingSafeEqual } from "crypto";
import { memberGoldOffer, syncMemberRewards } from "./gold-club.js";

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
  if (saved) syncMemberRewards(db, saved);
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
  if (saved) syncMemberRewards(db, saved);
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
  return db.prepare("SELECT * FROM members ORDER BY registered_at DESC, id DESC").all().map(presentMember);
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

function presentMember(row) {
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
    registeredAt: row.registered_at,
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

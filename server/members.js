const STATUSES = new Set(["updated", "delayed", "cancelled"]);

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
      full_name, email, mobile, chapter, category, business_name, ticket_type,
      reg_status, country, gold_club, registered_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET
      full_name = excluded.full_name,
      mobile = excluded.mobile,
      chapter = excluded.chapter,
      category = excluded.category,
      business_name = excluded.business_name,
      ticket_type = excluded.ticket_type,
      reg_status = excluded.reg_status,
      country = excluded.country,
      gold_club = excluded.gold_club,
      registered_at = excluded.registered_at,
      updated_at = datetime('now')
  `).run(
    input.fullName.trim(),
    input.email.trim().toLowerCase(),
    input.mobile.trim(),
    blank(input.chapter),
    blank(input.category),
    blank(input.businessName),
    blank(input.ticketType),
    status,
    blank(input.country),
    input.goldClub ? 1 : 0,
    "",
  );
}

export function memberContactClash(db, { email, mobile, excludeId = 0 }) {
  const nextEmail = String(email || "").trim().toLowerCase();
  if (nextEmail) {
    const emailOwner = db.prepare("SELECT id FROM members WHERE email = ? AND id != ?").get(nextEmail, excludeId);
    if (emailOwner) return "That email is already on the roster.";
  }
  const key = phoneKey(mobile);
  const digits = String(mobile || "").replace(/\D/g, "");
  if (!key && !digits) return "";
  const owner = db.prepare("SELECT id, mobile FROM members WHERE id != ?").all(excludeId)
    .find((row) => sameMobile(row.mobile, mobile));
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
      full_name = ?, email = ?, mobile = ?, chapter = ?, category = ?, business_name = ?,
      ticket_type = ?, reg_status = ?, country = ?, gold_club = ?, registered_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    fullName,
    email,
    mobile,
    blank(input.chapter),
    blank(input.category),
    blank(input.businessName),
    blank(input.ticketType),
    status,
    blank(input.country),
    input.goldClub ? 1 : 0,
    "",
    existing.id,
  );
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
      full_name = ?, email = ?, mobile = ?, category = ?, business_name = ?, chapter = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(fullName, nextEmail, mobile, industry, business, known?.name || chapter, existing.id);
  return { member: lookupMember(db, nextEmail) };
}

export function listMembers(db) {
  return db.prepare("SELECT * FROM members ORDER BY registered_at DESC, id DESC").all().map(presentMember);
}

function phoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
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

export function lookupMember(db, query) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return null;
  const row = value.includes("@")
    ? db.prepare("SELECT * FROM members WHERE lower(email) = ?").get(value)
    : db.prepare("SELECT * FROM members").all().find((member) => phoneKey(member.mobile) && phoneKey(member.mobile) === phoneKey(value));
  if (!row) return null;
  const digits = String(row.mobile || "").replace(/\D/g, "");
  const last4 = digits.slice(-4);
  return {
    fullName: row.full_name,
    business: row.business_name || "",
    industry: row.category || "",
    chapter: row.chapter || "",
    email: row.email,
    mobile: row.mobile,
    mobileMasked: last4 ? `+63 ••• ${last4}` : row.mobile,
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
    registeredAt: row.registered_at,
  };
}

function blank(value) {
  const text = String(value || "").trim();
  return text || null;
}

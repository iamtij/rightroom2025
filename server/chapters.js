export function listChapters(db) {
  seedFromMembers(db);
  return db.prepare("SELECT id, name FROM chapters ORDER BY name COLLATE NOCASE, id").all();
}

function phoneKey(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function percent(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

function registrationIndex(db) {
  const rows = db.prepare(`
    SELECT reference, email, mobile, phone_key, payment_plan, fully_paid_at, created_at
    FROM registrations
    WHERE status = 'confirmed'
    ORDER BY id DESC
  `).all();
  const byEmail = new Map();
  const byPhone = new Map();
  for (const row of rows) {
    const fullyPaid = Boolean(row.fully_paid_at);
    const installment = row.payment_plan === "installment" && !fullyPaid;
    if (!fullyPaid && !installment) continue;
    const owned = {
      reference: row.reference,
      plan: fullyPaid ? "full" : "installment",
      planLabel: fullyPaid ? "Fully paid" : "Installment",
      fullyPaid,
      registeredAt: row.created_at || null,
    };
    const email = String(row.email || "").trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, owned);
    const key = row.phone_key || phoneKey(row.mobile);
    if (key && !byPhone.has(key)) byPhone.set(key, owned);
  }
  return { byEmail, byPhone };
}

function ownedRegistration(member, index) {
  const email = String(member.email || "").trim().toLowerCase();
  if (email && index.byEmail.has(email)) return index.byEmail.get(email);
  const key = member.phone_key || phoneKey(member.mobile);
  if (key && index.byPhone.has(key)) return index.byPhone.get(key);
  return null;
}

/** Chapter roster progress: registered (fully paid or installment) over total members. */
export function listChapterProgress(db) {
  seedFromMembers(db);
  const chapters = listChapters(db);
  const byName = new Map(chapters.map((chapter) => [chapter.name.toLowerCase(), {
    id: chapter.id,
    name: chapter.name,
    total: 0,
    registered: 0,
    percent: null,
    members: [],
  }]));
  const ownedByContact = registrationIndex(db);
  const members = db.prepare(`
    SELECT id, full_name, email, mobile, phone_key, chapter
    FROM members
    ORDER BY full_name COLLATE NOCASE, id
  `).all();

  for (const member of members) {
    const chapterName = String(member.chapter || "").trim();
    if (!chapterName) continue;
    const key = chapterName.toLowerCase();
    let chapter = byName.get(key);
    if (!chapter) {
      chapter = {
        id: null,
        name: chapterName,
        total: 0,
        registered: 0,
        percent: null,
        members: [],
      };
      byName.set(key, chapter);
    }
    chapter.total += 1;
    const owned = ownedRegistration(member, ownedByContact);
    if (owned) chapter.registered += 1;
    chapter.members.push({
      id: member.id,
      fullName: member.full_name,
      email: member.email,
      mobile: member.mobile,
      registered: Boolean(owned),
      reference: owned?.reference || null,
      plan: owned?.plan || null,
      planLabel: owned?.planLabel || "Not registered",
      fullyPaid: owned?.fullyPaid || false,
      registeredAt: owned?.registeredAt || null,
    });
  }

  return [...byName.values()]
    .map((chapter) => ({
      ...chapter,
      percent: percent(chapter.registered, chapter.total),
      members: chapter.members.sort((left, right) => {
        const byNameOrder = left.fullName.localeCompare(right.fullName, undefined, { sensitivity: "base" });
        if (byNameOrder) return byNameOrder;
        return left.id - right.id;
      }),
    }))
    .sort((left, right) => {
      const leftPct = left.percent ?? -1;
      const rightPct = right.percent ?? -1;
      if (rightPct !== leftPct) return rightPct - leftPct;
      if (right.registered !== left.registered) return right.registered - left.registered;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
}

export function saveChapter(db, input) {
  const name = String(input.name || "").trim();
  if (!name) return { error: "Add a chapter name", status: 400 };
  const id = Number(input.id) || 0;
  const duplicate = db.prepare("SELECT id FROM chapters WHERE lower(name) = lower(?) AND id != ?").get(name, id);
  if (duplicate) return { error: "That chapter already exists", status: 400 };
  if (id) {
    const existing = db.prepare("SELECT * FROM chapters WHERE id = ?").get(id);
    if (!existing) return { error: "Chapter not found", status: 404 };
    db.prepare("UPDATE chapters SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, existing.id);
    db.prepare("UPDATE members SET chapter = ? WHERE lower(chapter) = lower(?)").run(name, existing.name);
    return { chapter: db.prepare("SELECT id, name FROM chapters WHERE id = ?").get(existing.id) };
  }
  const result = db.prepare("INSERT INTO chapters (name) VALUES (?)").run(name);
  return { chapter: db.prepare("SELECT id, name FROM chapters WHERE id = ?").get(result.lastInsertRowid) };
}

export function importChapters(db, names) {
  const insert = db.prepare("INSERT INTO chapters (name) VALUES (?)");
  const existing = db.prepare("SELECT id FROM chapters WHERE lower(name) = lower(?)");
  let saved = 0;
  const run = db.transaction((rows) => {
    for (const name of rows) {
      if (existing.get(name)) continue;
      insert.run(name);
      saved += 1;
    }
  });
  run(names);
  return saved;
}

export function parseChapterCsv(csv) {
  const lines = String(csv || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const first = firstCell(lines[0]).toLowerCase();
  const start = ["chapter", "chapters", "name"].includes(first) ? 1 : 0;
  const names = [];
  const seen = new Set();
  for (const line of lines.slice(start)) {
    const name = firstCell(line).trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function seedFromMembers(db) {
  if (db.prepare("SELECT COUNT(*) AS count FROM chapters").get().count > 0) return;
  const names = db.prepare("SELECT DISTINCT trim(chapter) AS name FROM members WHERE chapter IS NOT NULL AND trim(chapter) != ''").all();
  const insert = db.prepare("INSERT OR IGNORE INTO chapters (name) VALUES (?)");
  for (const row of names) insert.run(row.name);
}

function firstCell(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  return trimmed.split(",")[0].trim();
}

export function listChapters(db) {
  seedFromMembers(db);
  return db.prepare("SELECT id, name FROM chapters ORDER BY name COLLATE NOCASE, id").all();
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

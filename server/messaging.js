import { philippineMobile, semaphoreMobile, sendEmail, sendSms, sendSmsBulk } from "./providers.js";
import { renderPlainEmail } from "./templates.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PLACEHOLDER_RE = /\{\{\s*[a-z_]+\s*\}\}/i;
const SEND_CONFIRM_THRESHOLD = 50;
const SMS_PERSONALIZED_DELAY_MS = 100;
const EMAIL_SEND_DELAY_MS = 80;

const draining = new Set();

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeTagSlug(label) {
  const slug = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || null;
}

function normalizeSources(value) {
  const sources = String(value || "both").trim().toLowerCase();
  if (sources === "members" || sources === "registrations" || sources === "both") return sources;
  return null;
}

function parseTagIds(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseTagIds(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function fillPlaceholders(text, values) {
  return String(text ?? "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => values[key] ?? "");
}

function firstName(fullName) {
  const part = String(fullName || "").trim().split(/\s+/)[0];
  return part || "there";
}

function recipientValues(person) {
  return {
    first_name: firstName(person.full_name),
    full_name: String(person.full_name || "").trim(),
    email: String(person.email || "").trim().toLowerCase(),
    mobile: String(person.mobile || "").trim(),
    chapter: String(person.chapter || "").trim(),
    reference: String(person.reference || "").trim(),
    amount: "",
    due_date: "",
    when: "",
    pay_url: "",
    pass_url: "",
    installment: "",
    product: String(person.product_name || person.ticket_type || "").trim(),
    plan_note: "",
  };
}

export const AUDIENCE_TAGS = {
  firstMoverPaid: { slug: "first-mover-paid", label: "First Mover - Paid", color: "#0E7A4A" },
  firstMoverInstallment: { slug: "first-mover-installment", label: "First Mover - Installment", color: "#D0202E" },
  notRegistered: { slug: "not-registered", label: "Not Registered", color: "#5C5C63" },
};

const MANAGED_TAG_SLUGS = new Set(Object.values(AUDIENCE_TAGS).map((tag) => tag.slug));

function presentTag(row) {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    color: row.color || "#A8131F",
    managed: MANAGED_TAG_SLUGS.has(row.slug),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function presentGroup(row) {
  return {
    id: row.id,
    name: row.name,
    sources: row.sources,
    tagIds: parseTagIds(row.tag_ids),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function presentBlast(row) {
  return {
    id: row.id,
    channel: row.channel,
    groupId: row.group_id,
    audience: typeof row.audience_json === "string" ? JSON.parse(row.audience_json) : row.audience_json,
    templateId: row.template_id,
    subject: row.subject,
    body: row.body,
    status: row.status,
    total: row.total,
    sent: row.sent,
    failed: row.failed,
    skipped: row.skipped,
    createdBy: row.created_by,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function listMessageTags(db) {
  return db.prepare("SELECT * FROM message_tags ORDER BY lower(label), id").all().map(presentTag);
}

export function ensureAudienceTags(db) {
  const tags = {};
  for (const [key, spec] of Object.entries(AUDIENCE_TAGS)) {
    const result = upsertMessageTag(db, spec);
    tags[key] = result.tag;
  }
  return tags;
}

function tagIdBySlug(db, slug) {
  return db.prepare("SELECT id FROM message_tags WHERE slug = ?").get(slug)?.id || null;
}

function assignMemberTag(db, memberId, tagId) {
  if (!memberId || !tagId) return;
  db.prepare("INSERT OR IGNORE INTO member_tag_assignments (member_id, tag_id) VALUES (?, ?)").run(memberId, tagId);
}

function clearMemberTag(db, memberId, tagId) {
  if (!memberId || !tagId) return;
  db.prepare("DELETE FROM member_tag_assignments WHERE member_id = ? AND tag_id = ?").run(memberId, tagId);
}

function assignRegistrationTag(db, registrationId, tagId) {
  if (!registrationId || !tagId) return;
  db.prepare("INSERT OR IGNORE INTO registration_tag_assignments (registration_id, tag_id) VALUES (?, ?)").run(registrationId, tagId);
}

function clearRegistrationTag(db, registrationId, tagId) {
  if (!registrationId || !tagId) return;
  db.prepare("DELETE FROM registration_tag_assignments WHERE registration_id = ? AND tag_id = ?").run(registrationId, tagId);
}

function memberIdForEmail(db, email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return null;
  return db.prepare("SELECT id FROM members WHERE email = ?").get(value)?.id || null;
}

function registrationHasPayment(db, registrationId) {
  return db.prepare("SELECT COUNT(*) AS count FROM payments WHERE registration_id = ?").get(registrationId).count > 0;
}

function memberHasConfirmedRegistration(db, email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value) return false;
  return Boolean(db.prepare(`
    SELECT id FROM registrations
    WHERE lower(email) = ? AND status = 'confirmed'
    LIMIT 1
  `).get(value));
}

export function syncMemberNotRegisteredTag(db, memberId) {
  const tags = ensureAudienceTags(db);
  const member = db.prepare("SELECT id, email FROM members WHERE id = ?").get(memberId);
  if (!member) return;
  const notRegisteredId = tags.notRegistered.id;
  if (memberHasConfirmedRegistration(db, member.email)) clearMemberTag(db, member.id, notRegisteredId);
  else assignMemberTag(db, member.id, notRegisteredId);
}

export function syncRegistrationAudienceTags(db, registrationId) {
  const tags = ensureAudienceTags(db);
  const registration = db.prepare(`
    SELECT r.id, r.email, r.status, r.payment_plan, r.fully_paid_at, p.code AS product_code
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE r.id = ?
  `).get(registrationId);
  if (!registration) return;

  const paidId = tags.firstMoverPaid.id;
  const installmentId = tags.firstMoverInstallment.id;
  const memberId = memberIdForEmail(db, registration.email);
  const clearFirstMover = () => {
    clearRegistrationTag(db, registration.id, paidId);
    clearRegistrationTag(db, registration.id, installmentId);
    if (memberId) {
      clearMemberTag(db, memberId, paidId);
      clearMemberTag(db, memberId, installmentId);
    }
  };

  if (registration.status !== "confirmed" || registration.product_code !== "first_mover") {
    clearFirstMover();
  } else if (registration.fully_paid_at) {
    clearRegistrationTag(db, registration.id, installmentId);
    assignRegistrationTag(db, registration.id, paidId);
    if (memberId) {
      clearMemberTag(db, memberId, installmentId);
      assignMemberTag(db, memberId, paidId);
    }
  } else if (registration.payment_plan === "installment" && registrationHasPayment(db, registration.id)) {
    clearRegistrationTag(db, registration.id, paidId);
    assignRegistrationTag(db, registration.id, installmentId);
    if (memberId) {
      clearMemberTag(db, memberId, paidId);
      assignMemberTag(db, memberId, installmentId);
    }
  } else {
    clearFirstMover();
  }

  if (memberId) syncMemberNotRegisteredTag(db, memberId);
}

export function syncAudienceTags(db) {
  const tags = ensureAudienceTags(db);
  const paidId = tags.firstMoverPaid.id;
  const installmentId = tags.firstMoverInstallment.id;
  const notRegisteredId = tags.notRegistered.id;

  db.prepare("DELETE FROM registration_tag_assignments WHERE tag_id IN (?, ?)").run(paidId, installmentId);
  db.prepare("DELETE FROM member_tag_assignments WHERE tag_id IN (?, ?, ?)").run(paidId, installmentId, notRegisteredId);

  const firstMovers = db.prepare(`
    SELECT r.id
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE p.code = 'first_mover' AND r.status = 'confirmed'
  `).all();
  for (const row of firstMovers) syncRegistrationAudienceTags(db, row.id);

  const members = db.prepare("SELECT id FROM members").all();
  for (const row of members) syncMemberNotRegisteredTag(db, row.id);

  return {
    tags,
    firstMoverPaid: db.prepare("SELECT COUNT(*) AS count FROM registration_tag_assignments WHERE tag_id = ?").get(paidId).count,
    firstMoverInstallment: db.prepare("SELECT COUNT(*) AS count FROM registration_tag_assignments WHERE tag_id = ?").get(installmentId).count,
    notRegistered: db.prepare("SELECT COUNT(*) AS count FROM member_tag_assignments WHERE tag_id = ?").get(notRegisteredId).count,
  };
}

export function upsertMessageTag(db, input = {}) {
  const label = String(input.label || "").trim();
  if (!label) return { error: "Tag label is required", status: 400 };
  const slug = normalizeTagSlug(input.slug || label);
  if (!slug) return { error: "Tag label must include letters or numbers", status: 400 };
  const color = String(input.color || "#A8131F").trim() || "#A8131F";
  const id = Number(input.id) || 0;

  if (id) {
    const existing = db.prepare("SELECT id FROM message_tags WHERE id = ?").get(id);
    if (!existing) return { error: "Tag not found", status: 404 };
    const clash = db.prepare("SELECT id FROM message_tags WHERE slug = ? AND id != ?").get(slug, id);
    if (clash) return { error: "Another tag already uses that name", status: 400 };
    db.prepare(`
      UPDATE message_tags SET slug = ?, label = ?, color = ?, updated_at = datetime('now') WHERE id = ?
    `).run(slug, label, color, id);
    return { tag: presentTag(db.prepare("SELECT * FROM message_tags WHERE id = ?").get(id)) };
  }

  const existingSlug = db.prepare("SELECT * FROM message_tags WHERE slug = ?").get(slug);
  if (existingSlug) {
    db.prepare(`
      UPDATE message_tags SET label = ?, color = ?, updated_at = datetime('now') WHERE id = ?
    `).run(label, color, existingSlug.id);
    return { tag: presentTag(db.prepare("SELECT * FROM message_tags WHERE id = ?").get(existingSlug.id)) };
  }

  const result = db.prepare(`
    INSERT INTO message_tags (slug, label, color) VALUES (?, ?, ?)
  `).run(slug, label, color);
  return { tag: presentTag(db.prepare("SELECT * FROM message_tags WHERE id = ?").get(result.lastInsertRowid)) };
}

export function deleteMessageTag(db, id) {
  const existing = db.prepare("SELECT id, slug FROM message_tags WHERE id = ?").get(id);
  if (!existing) return { error: "Tag not found", status: 404 };
  if (MANAGED_TAG_SLUGS.has(existing.slug)) return { error: "That tag is managed by payment status", status: 400 };
  db.prepare("DELETE FROM message_tags WHERE id = ?").run(id);
  return { ok: true };
}

export function tagsForMember(db, memberId) {
  return db.prepare(`
    SELECT t.* FROM message_tags t
    INNER JOIN member_tag_assignments a ON a.tag_id = t.id
    WHERE a.member_id = ?
    ORDER BY lower(t.label), t.id
  `).all(memberId).map(presentTag);
}

export function tagsForRegistration(db, registrationId) {
  return db.prepare(`
    SELECT t.* FROM message_tags t
    INNER JOIN registration_tag_assignments a ON a.tag_id = t.id
    WHERE a.registration_id = ?
    ORDER BY lower(t.label), t.id
  `).all(registrationId).map(presentTag);
}

function managedTagIds(db) {
  ensureAudienceTags(db);
  return new Set(
    db.prepare(`
      SELECT id FROM message_tags WHERE slug IN (${[...MANAGED_TAG_SLUGS].map(() => "?").join(", ")})
    `).all(...MANAGED_TAG_SLUGS).map((row) => row.id),
  );
}

function syncMemberAudienceFromRegistrations(db, memberId) {
  const member = db.prepare("SELECT id, email FROM members WHERE id = ?").get(memberId);
  if (!member) return;
  const regs = db.prepare(`
    SELECT r.id
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE lower(r.email) = lower(?) AND p.code = 'first_mover' AND r.status = 'confirmed'
  `).all(member.email);
  for (const row of regs) syncRegistrationAudienceTags(db, row.id);
  syncMemberNotRegisteredTag(db, member.id);
}

export function setMemberTags(db, memberId, tagIdsInput) {
  const member = db.prepare("SELECT id FROM members WHERE id = ?").get(memberId);
  if (!member) return { error: "Member not found", status: 404 };
  const managed = managedTagIds(db);
  const tagIds = parseTagIds(tagIdsInput).filter((tagId) => !managed.has(tagId));
  for (const tagId of tagIds) {
    if (!db.prepare("SELECT id FROM message_tags WHERE id = ?").get(tagId)) {
      return { error: `Unknown tag ${tagId}`, status: 400 };
    }
  }
  const sync = db.transaction(() => {
    db.prepare(`
      DELETE FROM member_tag_assignments
      WHERE member_id = ? AND tag_id NOT IN (${[...managed].map(() => "?").join(", ") || "NULL"})
    `).run(memberId, ...managed);
    const insert = db.prepare("INSERT OR IGNORE INTO member_tag_assignments (member_id, tag_id) VALUES (?, ?)");
    for (const tagId of tagIds) insert.run(memberId, tagId);
  });
  sync();
  syncMemberAudienceFromRegistrations(db, memberId);
  return { tags: tagsForMember(db, memberId) };
}

export function setRegistrationTags(db, registrationId, tagIdsInput) {
  const registration = db.prepare("SELECT id FROM registrations WHERE id = ?").get(registrationId);
  if (!registration) return { error: "Registration not found", status: 404 };
  const managed = managedTagIds(db);
  const tagIds = parseTagIds(tagIdsInput).filter((tagId) => !managed.has(tagId));
  for (const tagId of tagIds) {
    if (!db.prepare("SELECT id FROM message_tags WHERE id = ?").get(tagId)) {
      return { error: `Unknown tag ${tagId}`, status: 400 };
    }
  }
  const sync = db.transaction(() => {
    db.prepare(`
      DELETE FROM registration_tag_assignments
      WHERE registration_id = ? AND tag_id NOT IN (${[...managed].map(() => "?").join(", ") || "NULL"})
    `).run(registrationId, ...managed);
    const insert = db.prepare("INSERT OR IGNORE INTO registration_tag_assignments (registration_id, tag_id) VALUES (?, ?)");
    for (const tagId of tagIds) insert.run(registrationId, tagId);
  });
  sync();
  syncRegistrationAudienceTags(db, registrationId);
  return { tags: tagsForRegistration(db, registrationId) };
}

export function memberTagMap(db) {
  const rows = db.prepare("SELECT member_id, tag_id FROM member_tag_assignments").all();
  const map = {};
  for (const row of rows) {
    if (!map[row.member_id]) map[row.member_id] = [];
    map[row.member_id].push(row.tag_id);
  }
  return map;
}

export function registrationTagMap(db) {
  const rows = db.prepare("SELECT registration_id, tag_id FROM registration_tag_assignments").all();
  const map = {};
  for (const row of rows) {
    if (!map[row.registration_id]) map[row.registration_id] = [];
    map[row.registration_id].push(row.tag_id);
  }
  return map;
}

export function listMessageGroups(db) {
  return db.prepare("SELECT * FROM message_groups ORDER BY lower(name), id").all().map(presentGroup);
}

export function saveMessageGroup(db, input = {}) {
  const name = String(input.name || "").trim();
  if (!name) return { error: "Group name is required", status: 400 };
  const sources = normalizeSources(input.sources);
  if (!sources) return { error: "Sources must be members, registrations, or both", status: 400 };
  const tagIds = parseTagIds(input.tagIds ?? input.tag_ids);
  for (const tagId of tagIds) {
    if (!db.prepare("SELECT id FROM message_tags WHERE id = ?").get(tagId)) {
      return { error: `Unknown tag ${tagId}`, status: 400 };
    }
  }
  const tagJson = JSON.stringify(tagIds);
  const id = Number(input.id) || 0;
  if (id) {
    const existing = db.prepare("SELECT id FROM message_groups WHERE id = ?").get(id);
    if (!existing) return { error: "Group not found", status: 404 };
    db.prepare(`
      UPDATE message_groups SET name = ?, sources = ?, tag_ids = ?, updated_at = datetime('now') WHERE id = ?
    `).run(name, sources, tagJson, id);
    return { group: presentGroup(db.prepare("SELECT * FROM message_groups WHERE id = ?").get(id)) };
  }
  const result = db.prepare(`
    INSERT INTO message_groups (name, sources, tag_ids) VALUES (?, ?, ?)
  `).run(name, sources, tagJson);
  return { group: presentGroup(db.prepare("SELECT * FROM message_groups WHERE id = ?").get(result.lastInsertRowid)) };
}

export function deleteMessageGroup(db, id) {
  const existing = db.prepare("SELECT id FROM message_groups WHERE id = ?").get(id);
  if (!existing) return { error: "Group not found", status: 404 };
  db.prepare("DELETE FROM message_groups WHERE id = ?").run(id);
  return { ok: true };
}

function loadAudienceSpec(db, input = {}) {
  let sources = normalizeSources(input.sources) || "both";
  let tagIds = parseTagIds(input.tagIds ?? input.tag_ids);
  let groupId = null;
  let groupName = null;

  const requestedGroupId = Number(input.groupId ?? input.group_id) || 0;
  if (requestedGroupId) {
    const group = db.prepare("SELECT * FROM message_groups WHERE id = ?").get(requestedGroupId);
    if (!group) return { error: "Group not found", status: 404 };
    sources = group.sources;
    tagIds = parseTagIds(group.tag_ids);
    groupId = group.id;
    groupName = group.name;
  }

  return { sources, tagIds, groupId, groupName };
}

function loadPeople(db, sources, tagIds) {
  const people = [];
  const includeMembers = sources === "members" || sources === "both";
  const includeRegistrations = sources === "registrations" || sources === "both";
  const useTags = tagIds.length > 0;

  if (includeMembers) {
    let rows;
    if (useTags) {
      const placeholders = tagIds.map(() => "?").join(",");
      rows = db.prepare(`
        SELECT DISTINCT m.id, m.full_name, m.email, m.mobile, m.phone_key, m.chapter, m.ticket_type AS product_name, NULL AS reference
        FROM members m
        INNER JOIN member_tag_assignments a ON a.member_id = m.id
        WHERE a.tag_id IN (${placeholders})
        ORDER BY m.id
      `).all(...tagIds);
    } else {
      rows = db.prepare(`
        SELECT id, full_name, email, mobile, phone_key, chapter, ticket_type AS product_name, NULL AS reference
        FROM members
        ORDER BY id
      `).all();
    }
    for (const row of rows) {
      people.push({
        source: "member",
        source_id: row.id,
        full_name: row.full_name,
        email: row.email,
        mobile: row.mobile,
        phone_key: row.phone_key,
        chapter: row.chapter,
        product_name: row.product_name,
        reference: null,
      });
    }
  }

  if (includeRegistrations) {
    let rows;
    if (useTags) {
      const placeholders = tagIds.map(() => "?").join(",");
      rows = db.prepare(`
        SELECT DISTINCT r.id, r.full_name, r.email, r.mobile, r.phone_key, r.chapter, r.reference, p.name AS product_name
        FROM registrations r
        LEFT JOIN ticket_products p ON p.id = r.product_id
        INNER JOIN registration_tag_assignments a ON a.registration_id = r.id
        WHERE a.tag_id IN (${placeholders})
          AND r.status != 'cancelled'
        ORDER BY r.id
      `).all(...tagIds);
    } else {
      rows = db.prepare(`
        SELECT r.id, r.full_name, r.email, r.mobile, r.phone_key, r.chapter, r.reference, p.name AS product_name
        FROM registrations r
        LEFT JOIN ticket_products p ON p.id = r.product_id
        WHERE r.status != 'cancelled'
        ORDER BY r.id
      `).all();
    }
    for (const row of rows) {
      people.push({
        source: "registration",
        source_id: row.id,
        full_name: row.full_name,
        email: row.email,
        mobile: row.mobile,
        phone_key: row.phone_key,
        chapter: row.chapter,
        product_name: row.product_name,
        reference: row.reference,
      });
    }
  }

  return people;
}

function contactKeyForChannel(channel, person) {
  if (channel === "email") {
    const email = String(person.email || "").trim().toLowerCase();
    return EMAIL_RE.test(email) ? `email:${email}` : null;
  }
  const mobile = philippineMobile(person.mobile) || (person.phone_key ? philippineMobile(`0${person.phone_key}`) : null);
  const semaphore = mobile ? semaphoreMobile(mobile) : null;
  return semaphore ? `sms:${semaphore}` : null;
}

function dedupeAudience(channel, people) {
  const byKey = new Map();
  for (const person of people) {
    const key = contactKeyForChannel(channel, person);
    if (!key) {
      if (!byKey.has(`missing:${person.source}:${person.source_id}`)) {
        byKey.set(`missing:${person.source}:${person.source_id}`, { ...person, contact_key: null, eligible: false });
      }
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...person, contact_key: key, eligible: true });
      continue;
    }
    // Prefer member over registration when the same contact appears in both.
    if (existing.source === "registration" && person.source === "member") {
      byKey.set(key, { ...person, contact_key: key, eligible: true });
    }
  }
  return [...byKey.values()];
}

export function previewAudience(db, input = {}) {
  const channel = String(input.channel || "").trim().toLowerCase();
  if (channel !== "email" && channel !== "sms") return { error: "Channel must be email or sms", status: 400 };
  const spec = loadAudienceSpec(db, input);
  if (spec.error) return spec;
  const people = loadPeople(db, spec.sources, spec.tagIds);
  const resolved = dedupeAudience(channel, people);
  const eligible = resolved.filter((row) => row.eligible);
  const missing = resolved.filter((row) => !row.eligible);
  return {
    channel,
    sources: spec.sources,
    tagIds: spec.tagIds,
    groupId: spec.groupId,
    groupName: spec.groupName,
    total: resolved.length,
    eligible: eligible.length,
    missingContact: missing.length,
    sample: eligible.slice(0, 8).map((row) => ({
      source: row.source,
      sourceId: row.source_id,
      fullName: row.full_name,
      contact: channel === "email" ? row.email : row.mobile,
    })),
  };
}

function bodyHasPlaceholders(body) {
  return PLACEHOLDER_RE.test(String(body || ""));
}

function readBlastMessage(db, input = {}) {
  const channel = String(input.channel || "").trim().toLowerCase();
  if (channel !== "email" && channel !== "sms") return { error: "Channel must be email or sms", status: 400 };

  let templateId = Number(input.templateId ?? input.template_id) || null;
  let subject = String(input.subject || "").trim();
  let body = String(input.body || "").trim();

  if (templateId) {
    const template = db.prepare("SELECT * FROM message_templates WHERE id = ?").get(templateId);
    if (!template) return { error: "Template not found", status: 404 };
    if (template.channel !== channel) return { error: "Template channel does not match", status: 400 };
    if (!body) body = String(template.body || "").trim();
    if (channel === "email" && !subject) subject = String(template.subject || "").trim();
  }

  if (!body) return { error: "Message body is required", status: 400 };
  if (channel === "email" && !subject) return { error: "Email subject is required", status: 400 };
  if (channel === "sms" && /^\s*test\b/i.test(body)) return { error: "SMS cannot start with the word test", status: 400 };

  return { channel, templateId, subject: channel === "email" ? subject : null, body };
}

export function createBlast(db, input = {}, { createdBy = null } = {}) {
  const message = readBlastMessage(db, input);
  if (message.error) return message;
  const spec = loadAudienceSpec(db, input);
  if (spec.error) return spec;

  const people = loadPeople(db, spec.sources, spec.tagIds);
  const resolved = dedupeAudience(message.channel, people);
  const eligible = resolved.filter((row) => row.eligible);

  if (eligible.length === 0) return { error: "No eligible recipients for this audience and channel", status: 400 };
  if (eligible.length >= SEND_CONFIRM_THRESHOLD && String(input.confirmText || "").trim() !== "SEND") {
    return { error: `Type SEND to confirm a blast to ${eligible.length} recipients`, status: 400, requiresConfirm: true, eligible: eligible.length };
  }

  const audience = {
    sources: spec.sources,
    tagIds: spec.tagIds,
    groupId: spec.groupId,
    groupName: spec.groupName,
    eligible: eligible.length,
    missingContact: resolved.length - eligible.length,
  };

  const insertBlast = db.prepare(`
    INSERT INTO message_blasts (
      channel, group_id, audience_json, template_id, subject, body, status, total, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
  `);
  const insertDelivery = db.prepare(`
    INSERT INTO message_blast_deliveries (
      blast_id, source, source_id, full_name, contact, contact_key, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const blastId = db.transaction(() => {
    const result = insertBlast.run(
      message.channel,
      spec.groupId,
      JSON.stringify(audience),
      message.templateId,
      message.subject,
      message.body,
      resolved.length,
      createdBy,
    );
    const id = result.lastInsertRowid;
    for (const person of resolved) {
      const contact = message.channel === "email" ? String(person.email || "").trim().toLowerCase() : String(person.mobile || "").trim();
      insertDelivery.run(
        id,
        person.source,
        person.source_id,
        person.full_name,
        contact,
        person.contact_key,
        person.eligible ? "pending" : "skipped",
      );
    }
    const skipped = resolved.length - eligible.length;
    if (skipped) {
      db.prepare("UPDATE message_blasts SET skipped = ? WHERE id = ?").run(skipped, id);
      db.prepare(`
        UPDATE message_blast_deliveries
        SET error = 'missing_contact'
        WHERE blast_id = ? AND status = 'skipped'
      `).run(id);
    }
    return id;
  })();

  scheduleBlastDrain(db, blastId);
  return { blast: presentBlast(db.prepare("SELECT * FROM message_blasts WHERE id = ?").get(blastId)) };
}

export function listBlasts(db, { limit = 50 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return db.prepare(`
    SELECT * FROM message_blasts ORDER BY id DESC LIMIT ?
  `).all(capped).map(presentBlast);
}

export function getBlastReport(db, blastId, { status = "" } = {}) {
  const blast = db.prepare("SELECT * FROM message_blasts WHERE id = ?").get(blastId);
  if (!blast) return { error: "Blast not found", status: 404 };
  const filter = String(status || "").trim().toLowerCase();
  const deliveries = filter
    ? db.prepare(`
        SELECT * FROM message_blast_deliveries WHERE blast_id = ? AND status = ? ORDER BY id
      `).all(blastId, filter)
    : db.prepare(`
        SELECT * FROM message_blast_deliveries WHERE blast_id = ? ORDER BY id
      `).all(blastId);
  return {
    blast: presentBlast(blast),
    deliveries: deliveries.map((row) => ({
      id: row.id,
      source: row.source,
      sourceId: row.source_id,
      fullName: row.full_name,
      contact: row.contact,
      status: row.status,
      providerId: row.provider_id,
      error: row.error,
      sentAt: row.sent_at,
    })),
  };
}

function bumpBlastCounters(db, blastId) {
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
    FROM message_blast_deliveries
    WHERE blast_id = ?
  `).get(blastId);
  db.prepare(`
    UPDATE message_blasts SET sent = ?, failed = ?, skipped = ? WHERE id = ?
  `).run(counts.sent || 0, counts.failed || 0, counts.skipped || 0, blastId);
}

function markDelivery(db, deliveryId, { status, providerId = null, error = null }) {
  db.prepare(`
    UPDATE message_blast_deliveries
    SET status = ?, provider_id = ?, error = ?, sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE sent_at END
    WHERE id = ?
  `).run(status, providerId, error, status, deliveryId);
}

async function deliverEmail(db, blast, delivery, person) {
  const values = recipientValues(person);
  const subject = fillPlaceholders(blast.subject, values);
  const text = fillPlaceholders(blast.body, values).trim();
  const html = renderPlainEmail({ subject, text });
  const result = await sendEmail({
    to: delivery.contact,
    subject,
    text,
    html,
    idempotencyKey: `blast-${blast.id}-${delivery.id}`,
    deliveryKind: "message_blast",
  });
  markDelivery(db, delivery.id, {
    status: result.status,
    providerId: result.providerId || null,
    error: result.error || null,
  });
}

async function deliverPersonalizedSms(db, blast, delivery, person) {
  const values = recipientValues(person);
  const text = fillPlaceholders(blast.body, values).trim();
  const result = await sendSms({ to: delivery.contact, message: text });
  markDelivery(db, delivery.id, {
    status: result.status,
    providerId: result.providerId || null,
    error: result.error || null,
  });
}

async function deliverBulkSms(db, blast, pending) {
  const numbers = pending.map((row) => row.contact);
  const result = await sendSmsBulk(numbers, blast.body);
  if (result.status === "skipped" || result.status === "failed") {
    for (const row of pending) {
      markDelivery(db, row.id, {
        status: result.status === "skipped" ? "skipped" : "failed",
        error: result.error || "sms_bulk_failed",
      });
    }
    return;
  }

  const byNumber = new Map();
  for (const item of result.results || []) {
    const number = semaphoreMobile(item.number || item.recipient || "");
    if (number && item.message_id) byNumber.set(number, String(item.message_id));
  }

  for (const row of pending) {
    const key = semaphoreMobile(row.contact);
    const providerId = key && byNumber.get(key);
    markDelivery(db, row.id, {
      status: providerId ? "sent" : "failed",
      providerId: providerId || null,
      error: providerId ? null : "sms_missing_id",
    });
  }
}

export async function drainBlast(db, blastId) {
  if (draining.has(blastId)) return;
  draining.add(blastId);
  try {
    const blast = db.prepare("SELECT * FROM message_blasts WHERE id = ?").get(blastId);
    if (!blast) return;
    if (blast.status === "completed" || blast.status === "failed") return;

    db.prepare(`
      UPDATE message_blasts
      SET status = 'sending', started_at = COALESCE(started_at, datetime('now'))
      WHERE id = ?
    `).run(blastId);

    const pending = db.prepare(`
      SELECT * FROM message_blast_deliveries
      WHERE blast_id = ? AND status = 'pending'
      ORDER BY id
    `).all(blastId);

    if (blast.channel === "sms" && !bodyHasPlaceholders(blast.body) && pending.length > 0) {
      await deliverBulkSms(db, blast, pending);
    } else {
      for (const delivery of pending) {
        const person = {
          full_name: delivery.full_name,
          email: blast.channel === "email" ? delivery.contact : "",
          mobile: blast.channel === "sms" ? delivery.contact : "",
          chapter: "",
          reference: "",
          product_name: "",
        };
        if (delivery.source === "member") {
          const row = db.prepare("SELECT * FROM members WHERE id = ?").get(delivery.source_id);
          if (row) {
            person.full_name = row.full_name;
            person.email = row.email;
            person.mobile = row.mobile;
            person.chapter = row.chapter || "";
            person.product_name = row.ticket_type || "";
          }
        } else {
          const row = db.prepare(`
            SELECT r.*, p.name AS product_name
            FROM registrations r
            LEFT JOIN ticket_products p ON p.id = r.product_id
            WHERE r.id = ?
          `).get(delivery.source_id);
          if (row) {
            person.full_name = row.full_name;
            person.email = row.email;
            person.mobile = row.mobile;
            person.chapter = row.chapter || "";
            person.reference = row.reference || "";
            person.product_name = row.product_name || "";
          }
        }

        if (blast.channel === "email") {
          await deliverEmail(db, blast, delivery, person);
          await pause(EMAIL_SEND_DELAY_MS);
        } else {
          await deliverPersonalizedSms(db, blast, delivery, person);
          await pause(SMS_PERSONALIZED_DELAY_MS);
        }
      }
    }

    bumpBlastCounters(db, blastId);
    const leftover = db.prepare(`
      SELECT COUNT(*) AS count FROM message_blast_deliveries WHERE blast_id = ? AND status = 'pending'
    `).get(blastId).count;
    db.prepare(`
      UPDATE message_blasts
      SET status = ?, completed_at = datetime('now'), error = NULL
      WHERE id = ?
    `).run(leftover > 0 ? "failed" : "completed", blastId);
    if (leftover > 0) {
      db.prepare(`
        UPDATE message_blasts SET error = 'incomplete_drain' WHERE id = ?
      `).run(blastId);
    }
  } catch (error) {
    db.prepare(`
      UPDATE message_blasts
      SET status = 'failed', error = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(String(error?.message || error), blastId);
    bumpBlastCounters(db, blastId);
  } finally {
    draining.delete(blastId);
  }
}

export function scheduleBlastDrain(db, blastId) {
  setImmediate(() => {
    drainBlast(db, blastId).catch((error) => {
      console.error("[messaging] blast drain failed", blastId, error);
    });
  });
}

/** @internal test helper */
export function _testHelpers() {
  return {
    fillPlaceholders,
    contactKeyForChannel,
    dedupeAudience,
    bodyHasPlaceholders,
    SEND_CONFIRM_THRESHOLD,
  };
}

import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { findMemberRow } from "./members.js";
import { sendEmail } from "./providers.js";
import { findRegistrationByContact } from "./registrations.js";

const TEN_MINUTES = 10 * 60 * 1000;
const RESEND_WAIT = 30 * 1000;
const MAX_ATTEMPTS = 5;

function purposeSecret(envName, purpose) {
  const dedicated = String(process.env[envName] || "").trim();
  if (dedicated) return dedicated;
  const root = String(process.env.ADMIN_SESSION_SECRET || "").trim();
  if (root) return createHmac("sha256", root).update(purpose).digest("hex");
  return "ibmc-dev-session";
}

function secret() {
  return purposeSecret("OTP_SECRET", "ibmc-otp-v1");
}

function editSecret() {
  return purposeSecret("MEMBER_EDIT_SECRET", "ibmc-member-edit-v1");
}

function hashCode(email, code) {
  return createHmac("sha256", secret()).update(`${email}:${code}`).digest("hex");
}

function hashRegistrationCode(email, code) {
  return createHmac("sha256", secret()).update(`registration:${email}:${code}`).digest("hex");
}

function sameHash(actual, expected) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function maskEmail(email) {
  const [name, domain] = String(email).split("@");
  const shown = name.slice(0, 2);
  return `${shown}${"*".repeat(Math.max(1, name.length - shown.length))}@${domain}`;
}

export function issueMemberOtp(db, query) {
  const member = findMemberRow(db, query);
  if (!member) return { error: "We couldn't find that membership", status: 404 };
  const normalized = member.email.trim().toLowerCase();
  const recent = db.prepare("SELECT created_at FROM member_otps WHERE email = ? ORDER BY id DESC LIMIT 1").get(normalized);
  if (recent && Date.now() - recent.created_at < RESEND_WAIT) {
    return { maskedEmail: maskEmail(normalized), waited: true };
  }
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const createdAt = Date.now();
  db.prepare("DELETE FROM member_otps WHERE email = ?").run(normalized);
  const result = db.prepare(`
    INSERT INTO member_otps (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)
  `).run(normalized, hashCode(normalized, code), createdAt + TEN_MINUTES, createdAt);
  return { id: Number(result.lastInsertRowid), email: normalized, code, createdAt, maskedEmail: maskEmail(normalized) };
}

export async function sendMemberOtp(db, email) {
  const issued = issueMemberOtp(db, email);
  if (issued.error || issued.waited) return issued;
  const delivery = await sendEmail({
    to: issued.email,
    subject: "Your IBMC 2027 code",
    text: `Your IBMC 2027 code is ${issued.code}. It expires in 10 minutes. If you did not ask to edit your details, you can ignore this email.`,
    html: `<p style="font-family:Inter,Arial,sans-serif;color:#141416">Your IBMC 2027 code is <strong style="letter-spacing:0.2em">${issued.code}</strong>.</p><p style="font-family:Inter,Arial,sans-serif;color:#5C5C63">It expires in 10 minutes. If you did not ask to edit your details, you can ignore this email.</p>`,
    idempotencyKey: `member-otp/${issued.email}/${issued.createdAt}`,
  });
  if (delivery.status !== "sent") {
    db.prepare("DELETE FROM member_otps WHERE id = ?").run(issued.id);
    if (delivery.error === "staging_safe_mode") {
      return { error: "Email login codes are disabled while staging safe mode is on.", status: 503 };
    }
    return { error: "We couldn't send the code. Try again.", status: 502 };
  }
  return { maskedEmail: issued.maskedEmail };
}

export function verifyMemberOtp(db, query, code) {
  const member = findMemberRow(db, query);
  if (!member) return { error: "We couldn't find that membership", status: 404 };
  const normalized = member.email.trim().toLowerCase();
  const entered = String(code || "").replace(/\D/g, "");
  const row = db.prepare("SELECT * FROM member_otps WHERE email = ? ORDER BY id DESC LIMIT 1").get(normalized);
  if (!row || row.expires_at < Date.now() || row.attempts >= MAX_ATTEMPTS) {
    return { error: "That code has expired. Send a new one.", status: 400 };
  }
  if (!/^\d{6}$/.test(entered) || !sameHash(hashCode(normalized, entered), row.code_hash)) {
    db.prepare("UPDATE member_otps SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    return { error: "That code is wrong.", status: 400 };
  }
  db.prepare("DELETE FROM member_otps WHERE email = ?").run(normalized);
  return { ok: true, editToken: memberEditToken(normalized), email: normalized };
}

const EDIT_WINDOW = 30 * 60 * 1000;

export function memberEditToken(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + EDIT_WINDOW })).toString("base64url");
  const signature = createHmac("sha256", editSecret()).update(`member-edit:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function issueRegistrationOtp(db, query) {
  const registration = findRegistrationByContact(db, query);
  if (!registration) return { error: "We couldn't find a registration with that email or mobile.", status: 404 };
  const email = registration.email.trim().toLowerCase();
  const recent = db.prepare("SELECT created_at FROM registration_otps WHERE email = ? ORDER BY id DESC LIMIT 1").get(email);
  if (recent && Date.now() - recent.created_at < RESEND_WAIT) {
    return { maskedEmail: maskEmail(email), waited: true };
  }
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const createdAt = Date.now();
  db.prepare("DELETE FROM registration_otps WHERE email = ?").run(email);
  const result = db.prepare(`
    INSERT INTO registration_otps (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)
  `).run(email, hashRegistrationCode(email, code), createdAt + TEN_MINUTES, createdAt);
  return { id: Number(result.lastInsertRowid), email, code, createdAt, maskedEmail: maskEmail(email) };
}

export async function sendRegistrationOtp(db, query) {
  const issued = issueRegistrationOtp(db, query);
  if (issued.error || issued.waited) return issued;
  const delivery = await sendEmail({
    to: issued.email,
    subject: "Your IBMC 2027 code",
    text: `Your IBMC 2027 code is ${issued.code}. It expires in 10 minutes. Check your email for this code. If you did not ask to manage your registration, you can ignore this email.`,
    html: `<p style="font-family:Inter,Arial,sans-serif;color:#141416">Your IBMC 2027 code is <strong style="letter-spacing:0.2em">${issued.code}</strong>.</p><p style="font-family:Inter,Arial,sans-serif;color:#5C5C63">It expires in 10 minutes. Check your email for this code. If you did not ask to manage your registration, you can ignore this email.</p>`,
    idempotencyKey: `registration-otp/${issued.email}/${issued.createdAt}`,
  });
  if (delivery.status !== "sent") {
    db.prepare("DELETE FROM registration_otps WHERE id = ?").run(issued.id);
    if (delivery.error === "staging_safe_mode") {
      return { error: "Email login codes are disabled while staging safe mode is on.", status: 503 };
    }
    return { error: "We couldn't send the code. Try again.", status: 502 };
  }
  return { maskedEmail: issued.maskedEmail };
}

export function verifyRegistrationOtp(db, query, code) {
  const registration = findRegistrationByContact(db, query);
  if (!registration) return { error: "We couldn't find a registration with that email or mobile.", status: 404 };
  const email = registration.email.trim().toLowerCase();
  const entered = String(code || "").replace(/\D/g, "");
  const row = db.prepare("SELECT * FROM registration_otps WHERE email = ? ORDER BY id DESC LIMIT 1").get(email);
  if (!row || row.expires_at < Date.now() || row.attempts >= MAX_ATTEMPTS) {
    return { error: "That code has expired. Send a new one.", status: 400 };
  }
  if (!/^\d{6}$/.test(entered) || !sameHash(hashRegistrationCode(email, entered), row.code_hash)) {
    db.prepare("UPDATE registration_otps SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    return { error: "That code is wrong.", status: 400 };
  }
  db.prepare("DELETE FROM registration_otps WHERE email = ?").run(email);
  return { ok: true, registration };
}

export function readMemberEditToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return "";
  const expected = createHmac("sha256", editSecret()).update(`member-edit:${payload}`).digest("base64url");
  if (!sameHash(signature, expected)) return "";
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data?.email || Number(data.exp) < Date.now()) return "";
    return String(data.email);
  } catch {
    return "";
  }
}

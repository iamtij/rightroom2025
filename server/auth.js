import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SESSION_MS = 12 * 60 * 60 * 1000;
const SETUP_MS = 10 * 60 * 1000;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function seedAdmin(db) {
  const email = (process.env.ADMIN_EMAIL || "admin@ibmcph.com").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (password) {
    const existing = db.prepare("SELECT id, role FROM admin_users WHERE email = ?").get(email);
    if (!existing) {
      db.prepare("INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, 'super')").run(email, hashPassword(password));
    } else if (existing.role !== "super") {
      db.prepare("UPDATE admin_users SET role = 'super' WHERE id = ?").run(existing.id);
    }
  }
  const superCount = db.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE role = 'super'").get().n;
  if (superCount > 0) return;
  const target = db.prepare("SELECT id FROM admin_users WHERE email = ?").get(email)
    || db.prepare("SELECT id FROM admin_users ORDER BY id ASC LIMIT 1").get();
  if (target) db.prepare("UPDATE admin_users SET role = 'super' WHERE id = ?").run(target.id);
}

export function listAdmins(db) {
  return db.prepare(`
    SELECT id, email, role, totp_enabled, created_at
    FROM admin_users
    ORDER BY CASE role WHEN 'super' THEN 0 ELSE 1 END, id
  `).all().map(presentAdmin);
}

export function createAdmin(db, input) {
  const email = String(input?.email || "").trim().toLowerCase();
  const password = String(input?.password || "");
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return { error: "Add a valid email.", status: 400 };
  }
  if (password.length < 8) return { error: "Use a password of at least 8 characters.", status: 400 };
  const existing = db.prepare("SELECT id FROM admin_users WHERE email = ?").get(email);
  if (existing) return { error: "That email is already an admin.", status: 400 };
  const result = db.prepare("INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, 'admin')").run(email, hashPassword(password));
  const admin = db.prepare("SELECT id, email, role, totp_enabled, created_at FROM admin_users WHERE id = ?").get(result.lastInsertRowid);
  return { admin: presentAdmin(admin) };
}

function presentAdmin(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role === "super" ? "super" : "admin",
    authenticator: Boolean(row.totp_enabled),
    createdAt: row.created_at,
  };
}

function secret() {
  return process.env.ADMIN_SESSION_SECRET || "ibmc-dev-session";
}

function signPayload(payload, prefix) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(`${prefix}${body}`).digest("base64url");
  return `${body}.${sig}`;
}

function readPayload(token, prefix) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", secret()).update(`${prefix}${body}`).digest("base64url");
  const actual = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

export function signSession(db, adminId) {
  const sid = randomBytes(18).toString("base64url");
  const exp = Date.now() + SESSION_MS;
  db.prepare("INSERT INTO admin_sessions (id, admin_id, expires_at) VALUES (?, ?, ?)").run(sid, adminId, exp);
  return signPayload({ id: adminId, sid, exp }, "session:");
}

export function readSession(db, token) {
  const payload = readPayload(token, "session:");
  if (!payload?.id || !payload.sid || payload.exp < Date.now()) return null;
  const row = db.prepare("SELECT admin_id, expires_at FROM admin_sessions WHERE id = ?").get(payload.sid);
  if (!row || row.admin_id !== payload.id || row.expires_at < Date.now()) return null;
  return payload;
}

export function revokeSession(db, token) {
  const payload = readPayload(token, "session:");
  if (payload?.sid) db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(payload.sid);
}

export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `ibmc_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `ibmc_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(text) {
  const clean = String(text || "").toUpperCase().replace(/=+$/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(key, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(binary).padStart(6, "0");
}

export function currentTotp(base32Secret, at = Date.now()) {
  return hotp(decodeBase32(base32Secret), Math.floor(at / 30000));
}

export function verifyTotp(base32Secret, code, at = Date.now()) {
  const entered = String(code || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(entered)) return false;
  const counter = Math.floor(at / 30000);
  for (let drift = -1; drift <= 1; drift += 1) {
    const expected = hotp(decodeBase32(base32Secret), counter + drift);
    const left = Buffer.from(entered);
    const right = Buffer.from(expected);
    if (left.length === right.length && timingSafeEqual(left, right)) return true;
  }
  return false;
}

export function beginMfaSetup(db, admin) {
  const secret = admin.totp_secret || encodeBase32(randomBytes(20));
  if (!admin.totp_secret) {
    db.prepare("UPDATE admin_users SET totp_secret = ? WHERE id = ?").run(secret, admin.id);
  }
  const label = encodeURIComponent(admin.email);
  return {
    secret,
    setupToken: signPayload({ id: admin.id, exp: Date.now() + SETUP_MS, purpose: "mfa-setup" }, "mfa:"),
    otpauthUrl: `otpauth://totp/IBMC:${label}?secret=${secret}&issuer=IBMC&digits=6&period=30`,
  };
}

export function readMfaSetup(token) {
  const payload = readPayload(token, "mfa:");
  if (!payload?.id || payload.purpose !== "mfa-setup" || payload.exp < Date.now()) return null;
  return payload;
}

export function cookieValue(header, name) {
  const parts = String(header || "").split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

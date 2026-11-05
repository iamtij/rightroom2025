import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

const WEEK = 7 * 24 * 60 * 60;

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
  if (!password) return;
  const existing = db.prepare("SELECT id FROM admin_users WHERE email = ?").get(email);
  if (existing) return;
  db.prepare("INSERT INTO admin_users (email, password_hash) VALUES (?, ?)").run(email, hashPassword(password));
}

function secret() {
  return process.env.ADMIN_SESSION_SECRET || "ibmc-dev-session";
}

export function signSession(adminId) {
  const body = Buffer.from(JSON.stringify({ id: adminId, exp: Date.now() + WEEK * 1000 })).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readSession(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const actual = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (!payload?.id || payload.exp < Date.now()) return null;
  return payload;
}

export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `ibmc_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${WEEK}${secure}`;
}

export function clearSessionCookie() {
  return "ibmc_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

export function cookieValue(header, name) {
  const parts = String(header || "").split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

import crypto from "crypto";
import { getRegistration, recordPayment } from "./registrations.js";
import { isChannelEnabled } from "./payment-channels.js";

const locks = new Set();
const DEFAULT_CHECKOUT_TTL_MINUTES = 30;
const SANDBOX_CHECKOUT = "https://testpti.payserv.net/webpayment/default.aspx";

const SUCCESS_CODES = new Set(["GR001", "GR002", "GR024"]);
const PENDING_CODES = new Set(["GR033", "GR038", "GR064"]);
const FAILURE_CODES = new Set([
  "GR003", "GR004", "GR005", "GR006", "GR007", "GR008", "GR009", "GR010", "GR011", "GR012",
  "GR013", "GR014", "GR015", "GR016", "GR017", "GR018", "GR019", "GR021", "GR022", "GR023",
  "GR025", "GR034", "GR035", "GR036", "GR037", "GR039", "GR091", "GR092", "GR093",
]);

export function paynamicsSha512(value) {
  return crypto.createHash("sha512").update(String(value || ""), "utf8").digest("hex");
}

export function paynamicsRequestSignature(fields, merchantKey) {
  const parts = [
    fields.mid,
    fields.request_id,
    fields.ip_address,
    fields.notification_url,
    fields.response_url,
    fields.fname,
    fields.lname,
    fields.mname,
    fields.address1,
    fields.address2,
    fields.city,
    fields.state,
    fields.country,
    fields.zip,
    fields.email,
    fields.phone,
    fields.client_ip,
    fields.amount,
    fields.currency,
    fields.secure3d,
    merchantKey,
  ];
  return paynamicsSha512(parts.map((item) => String(item ?? "")).join(""));
}

export function paynamicsResponseSignature(fields, merchantKey) {
  const parts = [
    fields.merchantid,
    fields.request_id,
    fields.response_id,
    fields.response_code,
    fields.response_message,
    fields.response_advise,
    fields.timestamp,
    fields.rebill_id,
    merchantKey,
  ];
  return paynamicsSha512(parts.map((item) => String(item ?? "")).join(""));
}

export function paynamicsSignaturesMatch(expected, provided) {
  const got = String(provided || "").trim().toLowerCase();
  const want = String(expected || "").trim().toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(got) || !/^[0-9a-f]{128}$/.test(want)) return false;
  return crypto.timingSafeEqual(Buffer.from(want, "utf8"), Buffer.from(got, "utf8"));
}

export function paynamicsOutcome(responseCode) {
  const code = String(responseCode || "").trim().toUpperCase();
  if (!code) return "pending";
  if (SUCCESS_CODES.has(code)) return "paid";
  if (PENDING_CODES.has(code)) return "pending";
  if (FAILURE_CODES.has(code)) return "failed";
  if (code.startsWith("GR")) return "failed";
  return "pending";
}

export function paynamicsAmountCents(amountText) {
  const normalized = String(amountText || "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function xmlTag(xml, tag) {
  const source = String(xml || "");
  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

export function parsePaynamicsXml(xml) {
  const body = String(xml || "").trim();
  if (!body) return {};
  return {
    merchantid: xmlTag(body, "merchantid") || xmlTag(body, "mid"),
    request_id: xmlTag(body, "request_id"),
    response_id: xmlTag(body, "response_id"),
    response_code: xmlTag(body, "response_code"),
    response_message: xmlTag(body, "response_message"),
    response_advise: xmlTag(body, "response_advise"),
    timestamp: xmlTag(body, "timestamp"),
    ptype: xmlTag(body, "ptype"),
    rebill_id: xmlTag(body, "rebill_id"),
    amount: xmlTag(body, "amount"),
    currency: xmlTag(body, "currency"),
    signature: xmlTag(body, "signature"),
  };
}

export function decodePaymentPayload(input) {
  if (!input) return "";
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("<")) return trimmed;
    try {
      return Buffer.from(trimmed, "base64").toString("utf8");
    } catch {
      return trimmed;
    }
  }
  if (typeof input === "object") {
    const value = input.paymentresponse || input.paymentResponse || input.PaymentResponse || "";
    if (typeof value === "string" && value.trim()) return decodePaymentPayload(value);
  }
  return "";
}

export function paymentAccepted(payload, row, merchantKey) {
  if (!payload || !row || !merchantKey) return false;
  if (String(payload.request_id || "") !== String(row.request_id || "")) return false;
  if (String(payload.merchantid || "") && String(process.env.PAYNAMICS_MERCHANT_ID || "").trim()) {
    if (String(payload.merchantid) !== String(process.env.PAYNAMICS_MERCHANT_ID).trim()) return false;
  }
  const expected = paynamicsResponseSignature(payload, merchantKey);
  if (!paynamicsSignaturesMatch(expected, payload.signature)) return false;
  return paynamicsOutcome(payload.response_code) === "paid";
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error("Paynamics is not available right now.");
  return value;
}

function optional(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function ttlMinutes() {
  const value = Number(process.env.PAYNAMICS_CHECKOUT_TTL_MINUTES || DEFAULT_CHECKOUT_TTL_MINUTES);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_CHECKOUT_TTL_MINUTES;
  return Math.min(Math.round(value), 24 * 60);
}

function publicOrigin() {
  const raw = String(process.env.PUBLIC_WEB_URL || process.env.SITE_URL || "").trim();
  if (!raw) throw new Error("Paynamics needs PUBLIC_WEB_URL.");
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error("Paynamics needs an https site URL.");
  return url.origin;
}

function sandboxCheckoutHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "testpti.payserv.net" || host.endsWith(".testpti.payserv.net");
}

export function paynamicsCheckoutUrl() {
  const env = String(process.env.PAYNAMICS_ENV || "sandbox").toLowerCase();
  const configured = String(process.env.PAYNAMICS_CHECKOUT_URL || "").trim();
  const url = configured || (env === "production" ? "" : SANDBOX_CHECKOUT);
  if (!url) throw new Error("Paynamics checkout URL is not configured.");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Paynamics checkout URL is not valid.");
  }
  if (parsed.protocol !== "https:") throw new Error("Paynamics checkout URL must be https.");
  if (!sandboxCheckoutHost(parsed.hostname) && process.env.PAYNAMICS_ALLOW_PRODUCTION !== "true") {
    throw new Error("Paynamics production checkout is disabled.");
  }
  return url;
}

function notificationUrl() {
  if (process.env.PAYNAMICS_NOTIFICATION_URL) return String(process.env.PAYNAMICS_NOTIFICATION_URL).trim();
  return `${publicOrigin()}/api/webhooks/paynamics`;
}

function responseUrl(requestId) {
  const url = new URL("/register", `${publicOrigin()}/`);
  url.searchParams.set("paynamicsRequest", requestId);
  return url.toString();
}

function cancelUrl() {
  if (process.env.PAYNAMICS_CANCEL_URL) return String(process.env.PAYNAMICS_CANCEL_URL).trim();
  return `${publicOrigin()}/register`;
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { fname: "Guest", lname: "Attendee", mname: "" };
  if (parts.length === 1) return { fname: parts[0], lname: parts[0], mname: "" };
  return { fname: parts[0], lname: parts[parts.length - 1], mname: parts.slice(1, -1).join(" ") };
}

function formatPhone(mobile) {
  const digits = String(mobile || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("63") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.length === 10) return `+63${digits}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function amountLabel(cents) {
  return (Math.round(cents) / 100).toFixed(2);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCheckoutXml(fields) {
  const tags = [
    ["mid", fields.mid],
    ["request_id", fields.request_id],
    ["ip_address", fields.ip_address],
    ["notification_url", fields.notification_url],
    ["response_url", fields.response_url],
    ["cancel_url", fields.cancel_url],
    ["mtac_url", fields.mtac_url],
    ["descriptor_note", fields.descriptor_note],
    ["fname", fields.fname],
    ["lname", fields.lname],
    ["mname", fields.mname],
    ["address1", fields.address1],
    ["address2", fields.address2],
    ["city", fields.city],
    ["state", fields.state],
    ["country", fields.country],
    ["zip", fields.zip],
    ["email", fields.email],
    ["phone", fields.phone],
    ["mobile", fields.mobile],
    ["client_ip", fields.client_ip],
    ["amount", fields.amount],
    ["currency", fields.currency],
    ["trxtype", fields.trxtype],
    ["pmethod", fields.pmethod],
    ["secure3d", fields.secure3d],
    ["signature", fields.signature],
  ];
  return `<Request>${tags.map(([tag, value]) => `<${tag}>${xmlEscape(value)}</${tag}>`).join("")}</Request>`;
}

export function encodeCheckoutRequest(fields, merchantKey) {
  const signature = paynamicsRequestSignature(fields, merchantKey);
  const xml = buildCheckoutXml({ ...fields, signature });
  return Buffer.from(xml, "utf8").toString("base64");
}

function hold(key) {
  if (locks.has(key)) return false;
  locks.add(key);
  return true;
}

function release(key) {
  locks.delete(key);
}

function dueInstallment(registration) {
  return registration.installments.find((item) => item.status === "due") || null;
}

function expiresAt(minutes = ttlMinutes()) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function findRequest(db, requestId) {
  return db.prepare("SELECT * FROM paynamics_payments WHERE request_id = ?").get(requestId) || null;
}

function presentPaynamics(row) {
  return {
    requestId: row.request_id,
    status: row.status,
    checkoutUrl: row.checkout_url,
    paymentRequest: row.payment_request || "",
    gatewayResponseCode: row.gateway_response_code || "",
    gatewayMessage: row.gateway_message || "",
    expiresAt: row.expires_at || "",
  };
}

function view(db, registration, row, extra = {}) {
  return { registration, paynamics: presentPaynamics(row), ...extra };
}

function savePaynamics(db, row, patch) {
  db.prepare(`
    UPDATE paynamics_payments
    SET status = ?, gateway_response_code = COALESCE(?, gateway_response_code),
        gateway_message = COALESCE(?, gateway_message),
        gateway_response_id = COALESCE(?, gateway_response_id),
        payment_channel = COALESCE(?, payment_channel),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    patch.status || row.status,
    patch.gatewayResponseCode || null,
    patch.gatewayMessage || null,
    patch.gatewayResponseId || null,
    patch.paymentChannel || null,
    row.id,
  );
  return db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(row.id);
}

function settlePaynamics(db, row) {
  const run = db.transaction(() => {
    const current = db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(row.id);
    if (!current) return null;
    if (current.status === "paid") return getRegistration(db, current.registration_id);
    const existing = db.prepare("SELECT id FROM payments WHERE external_reference = ?").get(current.request_id);
    if (!existing) {
      recordPayment(db, {
        registrationId: current.registration_id,
        installmentId: current.installment_id,
        amountCents: current.amount_cents,
        method: "paynamics",
        externalReference: current.request_id,
      });
    }
    db.prepare(`
      UPDATE paynamics_payments
      SET status = 'paid', updated_at = datetime('now')
      WHERE id = ?
    `).run(current.id);
    return getRegistration(db, current.registration_id);
  });
  return run();
}

function applyPaynamicsPayload(db, payload, merchantKey) {
  const row = findRequest(db, payload?.request_id);
  if (!row || row.status === "paid") return row;
  if (String(payload.merchantid || "") && String(process.env.PAYNAMICS_MERCHANT_ID || "").trim()) {
    if (String(payload.merchantid) !== String(process.env.PAYNAMICS_MERCHANT_ID).trim()) {
      return savePaynamics(db, row, { status: "failed", gatewayResponseCode: "mismatch", gatewayMessage: "merchantid mismatch" });
    }
  }
  const expected = paynamicsResponseSignature(payload, merchantKey);
  if (!paynamicsSignaturesMatch(expected, payload.signature)) {
    return savePaynamics(db, row, { status: "failed", gatewayResponseCode: "sig", gatewayMessage: "signature mismatch" });
  }
  if (payload.amount) {
    const cents = paynamicsAmountCents(payload.amount);
    if (cents !== null && cents !== row.amount_cents) {
      return savePaynamics(db, row, {
        status: "failed",
        gatewayResponseCode: payload.response_code || "amount",
        gatewayMessage: "amount mismatch",
        gatewayResponseId: payload.response_id || null,
        paymentChannel: payload.ptype || null,
      });
    }
  }
  const outcome = paynamicsOutcome(payload.response_code);
  const patch = {
    gatewayResponseCode: payload.response_code || row.gateway_response_code,
    gatewayMessage: payload.response_message || row.gateway_message,
    gatewayResponseId: payload.response_id || row.gateway_response_id,
    paymentChannel: payload.ptype || row.payment_channel,
  };
  if (outcome === "paid") {
    settlePaynamics(db, row);
    return db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(row.id);
  }
  if (outcome === "failed") {
    return savePaynamics(db, row, { ...patch, status: "failed" });
  }
  return savePaynamics(db, row, { ...patch, status: row.status === "expired" ? "expired" : "pending" });
}

export async function startPaynamicsPayment(db, registration, clientIp = "") {
  if (!isChannelEnabled(db, "paynamics")) return { error: "That payment option is turned off.", status: 400, registration };
  if (registration.currency !== "PHP") return { error: "Paynamics collects peso payments.", status: 400, registration };
  const due = dueInstallment(registration);
  const amountCents = due ? due.amount_cents - due.amount_paid_cents : 0;
  if (!due || amountCents <= 0) return { registration, paynamics: null };
  const lock = `paynamics:${due.id}`;
  if (!hold(lock)) return { error: "Payment is already starting.", status: 409, registration };
  try {
    const open = db.prepare(`
      SELECT * FROM paynamics_payments
      WHERE installment_id = ? AND status = 'pending'
      ORDER BY id DESC
      LIMIT 1
    `).get(due.id);
    if (open) {
      const expires = Date.parse(open.expires_at || "");
      if (!Number.isFinite(expires) || Date.now() < expires) {
        return view(db, registration, open);
      }
      db.prepare(`
        UPDATE paynamics_payments SET status = 'expired', updated_at = datetime('now')
        WHERE id = ? AND status = 'pending'
      `).run(open.id);
    }
    const merchantId = required("PAYNAMICS_MERCHANT_ID");
    const merchantKey = required("PAYNAMICS_MERCHANT_KEY");
    const merchantIp = required("PAYNAMICS_MERCHANT_IP");
    const checkoutUrl = paynamicsCheckoutUrl();
    const requestId = crypto.randomBytes(12).toString("hex");
    const name = splitName(registration.full_name);
    const phone = formatPhone(registration.mobile);
    const fields = {
      mid: merchantId,
      request_id: requestId,
      ip_address: merchantIp,
      notification_url: notificationUrl(),
      response_url: responseUrl(requestId),
      cancel_url: cancelUrl(),
      mtac_url: optional("PAYNAMICS_MTAC_URL", responseUrl(requestId)),
      descriptor_note: optional("PAYNAMICS_DESCRIPTOR", `IBMC 2027 ${registration.reference}`),
      fname: name.fname,
      lname: name.lname,
      mname: name.mname,
      address1: optional("PAYNAMICS_DEFAULT_ADDRESS1", "Makati"),
      address2: "",
      city: optional("PAYNAMICS_DEFAULT_CITY", "Makati"),
      state: optional("PAYNAMICS_DEFAULT_STATE", "NCR"),
      country: optional("PAYNAMICS_DEFAULT_COUNTRY", "PH"),
      zip: optional("PAYNAMICS_DEFAULT_ZIP", "1200"),
      email: registration.email,
      phone,
      mobile: phone,
      client_ip: String(clientIp || merchantIp),
      amount: amountLabel(amountCents),
      currency: "PHP",
      trxtype: "Sale",
      pmethod: optional("PAYNAMICS_PMETHOD"),
      secure3d: optional("PAYNAMICS_SECURE3D", "enabled"),
    };
    const paymentRequest = encodeCheckoutRequest(fields, merchantKey);
    const row = db.prepare(`
      INSERT INTO paynamics_payments (
        registration_id, installment_id, request_id, amount_cents, currency, status,
        checkout_url, payment_request, expires_at
      ) VALUES (?, ?, ?, ?, 'PHP', 'pending', ?, ?, ?)
    `).run(
      registration.id,
      due.id,
      requestId,
      amountCents,
      checkoutUrl,
      paymentRequest,
      expiresAt(),
    );
    const saved = db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(row.lastInsertRowid);
    return view(db, registration, saved);
  } finally {
    release(lock);
  }
}

export async function refreshPaynamicsPayment(db, requestId) {
  const row = findRequest(db, requestId);
  if (!row) return { error: "Payment not found", status: 404 };
  const registration = getRegistration(db, row.registration_id);
  const expires = Date.parse(row.expires_at || "");
  if (row.status === "pending" && Number.isFinite(expires) && Date.now() >= expires) {
    savePaynamics(db, row, { status: "expired", gatewayMessage: "checkout expired" });
    row.status = "expired";
  }
  return view(db, registration, db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(row.id));
}

export async function handlePaynamicsNotification(db, body, merchantKey = String(process.env.PAYNAMICS_MERCHANT_KEY || "").trim()) {
  if (!merchantKey) return { status: 503, body: "unconfigured" };
  const xml = decodePaymentPayload(body);
  if (!xml) return { status: 400, body: "invalid payload" };
  const payload = parsePaynamicsXml(xml);
  if (!payload.request_id || !payload.signature) return { status: 400, body: "invalid payload" };
  try {
    applyPaynamicsPayload(db, payload, merchantKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("No installment is due") || message.includes("not payable")) {
      return { status: 200, body: "OK" };
    }
    console.error(message || error);
    return { status: 500, body: "error" };
  }
  return { status: 200, body: "OK" };
}

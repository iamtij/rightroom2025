import crypto from "crypto";
import QRCode from "qrcode";
import { getRegistration, recordPayment } from "./registrations.js";
import { isChannelEnabled } from "./payment-channels.js";
import { paymentCharge, settlementBaseCents } from "./convenience-fee.js";

const QR_CAP = 3;
const QR_GRACE_MS = 2 * 60 * 1000;
const ONLINE_MS = 5 * 60 * 1000;
const locks = new Set();

const CHANNEL_CODE = {
  qr: "hitpay_qr",
  online: "hitpay_online",
};

export function hitpaySignaturesMatch(rawBody, signature, salt) {
  const got = String(signature || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(got)) return false;
  const expected = crypto.createHmac("sha256", salt).update(String(rawBody || ""), "utf8").digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(got, "utf8"));
}

export function allowedHitpayUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    if (host !== "hit-pay.com" && !host.endsWith(".hit-pay.com")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function hitpayCentavos(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function paymentAccepted(payload, row) {
  if (!payload || !row) return false;
  if (String(payload.status || "").toLowerCase() !== "completed") return false;
  if (String(payload.reference_number || "") !== row.session_id) return false;
  if (String(payload.currency || "").toLowerCase() !== "php") return false;
  if (hitpayCentavos(payload.amount) !== row.amount_cents) return false;
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  return payments.some((payment) => (
    String(payment?.status || "").toLowerCase() === "succeeded"
    && String(payment?.currency || "").toLowerCase() === "php"
    && hitpayCentavos(payment?.amount) === row.amount_cents
  ));
}

export function qrPayload(body) {
  const nested = body?.qr_code_data?.qr_code;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  return typeof body?.qr_code === "string" ? body.qr_code.trim() : "";
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error("HitPay is not available right now.");
  return value;
}

function ttlMinutes() {
  const value = Number(process.env.HITPAY_CHECKOUT_TTL_MINUTES || 15);
  if (!Number.isFinite(value) || value < 1) return 15;
  return Math.min(Math.round(value), 24 * 60);
}

function publicOrigin() {
  const raw = String(process.env.PUBLIC_WEB_URL || process.env.SITE_URL || "").trim();
  if (!raw) throw new Error("HitPay online banking needs PUBLIC_WEB_URL.");
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error("HitPay online banking needs an https site URL.");
  return url.origin;
}

function redirectUrl(sessionId) {
  const url = new URL("/register", `${publicOrigin()}/`);
  url.searchParams.set("paySession", sessionId);
  return url.toString();
}

function hitpayMessage(body, status) {
  const message = body?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  if (message && typeof message === "object") {
    const text = Object.values(message).flat().map((item) => String(item || "")).filter(Boolean).join(" ");
    if (text) return text;
  }
  return `HitPay could not start the payment (${status}).`;
}

function apiBase() {
  return (process.env.HITPAY_API_BASE_URL || "https://api.hit-pay.com").replace(/\/$/, "");
}

async function hitpayFetch(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    method: options.method || "GET",
    headers: {
      "X-BUSINESS-API-KEY": required("HITPAY_API_KEY"),
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: payload };
}

function dueInstallment(registration) {
  return registration.installments.find((item) => item.status === "due") || null;
}

function hold(key) {
  if (locks.has(key)) return false;
  locks.add(key);
  return true;
}

function release(key) {
  locks.delete(key);
}

function refreshesLeft(db, installmentId) {
  const count = db.prepare(`
    SELECT COUNT(*) AS count FROM hitpay_payments
    WHERE installment_id = ? AND channel = 'qr' AND status != 'failed'
  `).get(installmentId).count;
  return Math.max(0, QR_CAP - count);
}

function windowState(row, now = Date.now()) {
  const expires = Date.parse(row?.expires_at || "");
  if (!Number.isFinite(expires)) return "open";
  if (now < expires) return "open";
  if (row.channel === "qr" && now <= expires + QR_GRACE_MS) return "refresh";
  return "closed";
}

async function qrImage(value) {
  const code = String(value || "").trim();
  if (!code) return "";
  if (code.startsWith("data:image")) return code;
  try {
    return await QRCode.toDataURL(code, { errorCorrectionLevel: "M", margin: 2, width: 280 });
  } catch {
    return "";
  }
}

async function presentHitpay(db, row) {
  const left = row.channel === "qr" ? refreshesLeft(db, row.installment_id) : 0;
  const state = windowState(row);
  return {
    sessionId: row.session_id,
    channel: row.channel,
    status: row.status,
    qrDataUrl: row.channel === "qr" ? await qrImage(row.qr_code) : "",
    paymentUrl: allowedHitpayUrl(row.payment_url),
    expiresAt: row.expires_at || "",
    refreshesLeft: left,
    canRefresh: row.channel === "qr" && row.status !== "paid" && row.status !== "failed" && left > 0 && state === "refresh",
  };
}

function view(db, registration, row, extra = {}) {
  return presentHitpay(db, row).then((hitpay) => ({ registration, hitpay, ...extra }));
}

function findSession(db, payload) {
  const reference = String(payload?.reference_number || "");
  const id = String(payload?.id || "");
  if (reference) {
    const row = db.prepare("SELECT * FROM hitpay_payments WHERE session_id = ?").get(reference);
    if (row) return row;
  }
  if (!id) return null;
  return db.prepare("SELECT * FROM hitpay_payments WHERE gateway_ref = ?").get(id) || null;
}

function saveHitpay(db, row, patch) {
  db.prepare(`
    UPDATE hitpay_payments
    SET status = ?, gateway_status = ?, gateway_ref = COALESCE(?, gateway_ref), updated_at = datetime('now')
    WHERE id = ?
  `).run(patch.status || row.status, patch.gatewayStatus ?? row.gateway_status, patch.gatewayRef || null, row.id);
  return db.prepare("SELECT * FROM hitpay_payments WHERE id = ?").get(row.id);
}

function completedMismatch(payload, row) {
  if (String(payload?.status || "").toLowerCase() !== "completed") return false;
  if (String(payload.reference_number || "") !== row.session_id) return true;
  if (String(payload.currency || "").toLowerCase() !== "php") return true;
  return hitpayCentavos(payload.amount) !== row.amount_cents;
}

function settleHitpay(db, row) {
  const run = db.transaction(() => {
    const current = db.prepare("SELECT * FROM hitpay_payments WHERE id = ?").get(row.id);
    if (!current) return null;
    if (current.status === "paid") return getRegistration(db, current.registration_id);
    const existing = db.prepare("SELECT id FROM payments WHERE external_reference = ?").get(current.session_id);
    if (!existing) {
      recordPayment(db, {
        registrationId: current.registration_id,
        installmentId: current.installment_id,
        amountCents: settlementBaseCents(current),
        method: `hitpay:${current.channel}`,
        externalReference: current.session_id,
      });
    }
    db.prepare(`
      UPDATE hitpay_payments
      SET status = 'paid', gateway_status = 'completed', updated_at = datetime('now')
      WHERE id = ?
    `).run(current.id);
    return getRegistration(db, current.registration_id);
  });
  return run();
}

async function applyHitpayPayload(db, payload) {
  const row = findSession(db, payload);
  if (!row || row.status === "paid" || row.gateway_status === "mismatch") return row;
  const gatewayRef = String(payload?.id || "") || null;
  if (paymentAccepted(payload, row)) {
    settleHitpay(db, row);
    return db.prepare("SELECT * FROM hitpay_payments WHERE id = ?").get(row.id);
  }
  const remote = String(payload?.status || "").toLowerCase();
  if (completedMismatch(payload, row)) return saveHitpay(db, row, { status: "failed", gatewayStatus: "mismatch", gatewayRef });
  if (remote === "expired") return saveHitpay(db, row, { status: "expired", gatewayStatus: remote, gatewayRef });
  if (remote === "failed" || remote === "canceled" || remote === "cancelled" || remote === "inactive") {
    return saveHitpay(db, row, { status: "failed", gatewayStatus: remote, gatewayRef });
  }
  if (gatewayRef && gatewayRef !== row.gateway_ref) return saveHitpay(db, row, { gatewayStatus: remote || row.gateway_status, gatewayRef });
  return row;
}

function requestBody(registration, sessionId, amountCents, channel) {
  const body = {
    amount: Math.round(amountCents) / 100,
    currency: "PHP",
    reference_number: sessionId,
    email: registration.email,
    name: String(registration.full_name || "").slice(0, 255),
    purpose: `IBMC 2027 ${registration.reference}`.slice(0, 255),
    expires_after: `${ttlMinutes()} mins`,
    allow_repeated_payments: "false",
    send_email: "false",
    send_sms: "false",
  };
  if (channel === "qr") {
    body.payment_methods = ["qrph_netbank"];
    body.generate_qr = true;
    return body;
  }
  body.payment_methods = ["upay_online"];
  body.redirect_url = redirectUrl(sessionId);
  return body;
}

async function retirePreviousHitpay(db, previousId) {
  if (!previousId) return null;
  const previous = db.prepare("SELECT * FROM hitpay_payments WHERE id = ?").get(previousId);
  if (!previous || previous.status === "paid" || previous.status === "failed" || !previous.gateway_ref) return null;
  let removed;
  try {
    removed = await hitpayFetch(`/v1/payment-requests/${encodeURIComponent(previous.gateway_ref)}`, { method: "DELETE" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HitPay could not cancel the previous QR.";
    return { error: message, status: 502 };
  }
  if (removed.ok || removed.status === 404) return null;
  try {
    const remote = await hitpayFetch(`/v1/payment-requests/${encodeURIComponent(previous.gateway_ref)}`);
    if (remote.ok) {
      await applyHitpayPayload(db, remote.body);
      const current = db.prepare("SELECT * FROM hitpay_payments WHERE id = ?").get(previous.id);
      if (current?.status === "paid") {
        return view(db, getRegistration(db, current.registration_id), current);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
  return {
    error: "The current payment is still open, so a new QR was not created.",
    status: 409,
    registration: getRegistration(db, previous.registration_id),
    hitpay: await presentHitpay(db, previous),
  };
}

async function createHitpaySession(db, registration, due, amountCents, channel, previousId, feeCents = 0) {
  const retired = await retirePreviousHitpay(db, previousId);
  if (retired) return retired;
  const sessionId = crypto.randomUUID();
  let created;
  try {
    created = await hitpayFetch("/v1/payment-requests", {
      method: "POST",
      body: requestBody(registration, sessionId, amountCents, channel),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HitPay could not start the payment.";
    return { error: message, status: 502, registration };
  }
  if (!created.ok) {
    return { error: hitpayMessage(created.body, created.status), status: created.status === 422 ? 422 : 502, registration };
  }
  const gatewayRef = String(created.body?.id || "");
  if (!gatewayRef) return { error: "HitPay did not return a payment.", status: 502, registration };
  const qr = channel === "qr" ? qrPayload(created.body) : "";
  const paymentUrl = channel === "online" ? allowedHitpayUrl(created.body?.url) : "";
  const failed = (channel === "qr" && !qr) || (channel === "online" && !paymentUrl);
  const expiresAt = new Date(Date.now() + (channel === "online" ? ONLINE_MS : ttlMinutes() * 60 * 1000)).toISOString();
  const insert = db.transaction(() => {
    if (previousId) {
      db.prepare(`
        UPDATE hitpay_payments
        SET status = 'expired', updated_at = datetime('now')
        WHERE id = ? AND status = 'pending'
      `).run(previousId);
    }
    const result = db.prepare(`
      INSERT INTO hitpay_payments (
        registration_id, installment_id, session_id, gateway_ref, amount_cents, fee_cents, currency, channel,
        status, gateway_status, qr_code, payment_url, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PHP', ?, ?, ?, ?, ?, ?)
    `).run(
      registration.id,
      due.id,
      sessionId,
      gatewayRef,
      amountCents,
      feeCents,
      channel,
      failed ? "failed" : "pending",
      failed ? "missing_checkout" : String(created.body.status || "pending"),
      qr || null,
      paymentUrl || null,
      expiresAt,
    );
    return db.prepare("SELECT * FROM hitpay_payments WHERE id = ?").get(result.lastInsertRowid);
  });
  const row = insert();
  if (failed) {
    const error = channel === "qr" ? "HitPay did not return a QR code." : "HitPay did not return a checkout page.";
    return { error, status: 502, registration, hitpay: await presentHitpay(db, row) };
  }
  return { registration, hitpay: await presentHitpay(db, row) };
}

export async function startHitpayPayment(db, registration, channel) {
  const setting = CHANNEL_CODE[channel];
  if (!setting) return { error: "Choose a payment option.", status: 400, registration };
  if (!isChannelEnabled(db, setting)) return { error: "That payment option is turned off.", status: 400, registration };
  if (registration.currency !== "PHP") return { error: "HitPay collects peso payments.", status: 400, registration };
  const due = dueInstallment(registration);
  const baseCents = due ? due.amount_cents - due.amount_paid_cents : 0;
  const quote = paymentCharge(db, registration, baseCents, { channel: setting });
  if (!due || quote.baseCents <= 0) return { registration, hitpay: null };
  const lock = `hitpay:${due.id}`;
  if (!hold(lock)) return { error: "Payment is already starting.", status: 409, registration };
  try {
    const open = db.prepare(`
      SELECT * FROM hitpay_payments
      WHERE installment_id = ? AND channel = ? AND status = 'pending'
      ORDER BY id DESC
      LIMIT 1
    `).get(due.id, channel);
    if (open) {
      const state = windowState(open);
      const sameCharge = open.amount_cents === quote.totalCents && (open.fee_cents || 0) === quote.feeCents;
      if (sameCharge && (state === "open" || (channel === "qr" && state === "refresh"))) return await view(db, registration, open);
    }
    if (channel === "qr" && refreshesLeft(db, due.id) <= 0) {
      return { error: "This payment already used its QR codes. Nothing was charged.", status: 400, registration };
    }
    return await createHitpaySession(db, registration, due, quote.totalCents, channel, open?.id, quote.feeCents);
  } finally {
    release(lock);
  }
}

export async function refreshHitpayPayment(db, sessionId) {
  const row = db.prepare("SELECT * FROM hitpay_payments WHERE session_id = ?").get(sessionId);
  if (!row) return { error: "Payment not found", status: 404 };
  const registration = getRegistration(db, row.registration_id);
  if (row.status === "paid" || row.gateway_status === "mismatch" || !row.gateway_ref) {
    return view(db, registration, row);
  }
  try {
    const remote = await hitpayFetch(`/v1/payment-requests/${encodeURIComponent(row.gateway_ref)}`);
    if (!remote.ok) {
      return view(db, registration, row, { error: hitpayMessage(remote.body, remote.status), status: 200 });
    }
    await applyHitpayPayload(db, remote.body);
    const next = db.prepare("SELECT * FROM hitpay_payments WHERE id = ?").get(row.id);
    return view(db, getRegistration(db, row.registration_id), next);
  } catch (error) {
    const message = error instanceof Error ? error.message : "HitPay could not confirm the payment.";
    if (message.includes("No installment is due") || message.includes("not payable")) {
      console.error(message);
      return view(db, getRegistration(db, row.registration_id), row, { status: 200 });
    }
    return view(db, registration, row, { error: message, status: 200 });
  }
}

export async function refreshHitpayQr(db, sessionId) {
  const row = db.prepare("SELECT * FROM hitpay_payments WHERE session_id = ?").get(sessionId);
  if (!row || row.channel !== "qr") return { error: "Payment not found", status: 404 };
  const registration = getRegistration(db, row.registration_id);
  if (!registration) return { error: "Registration not found", status: 404 };
  if (!isChannelEnabled(db, "hitpay_qr")) {
    return { error: "That payment option is turned off.", status: 400, registration, hitpay: await presentHitpay(db, row) };
  }
  if (row.status === "paid") return view(db, registration, row);
  if (row.status === "failed") {
    return { error: "This payment can't continue. Nothing was charged.", status: 400, registration, hitpay: await presentHitpay(db, row) };
  }
  const lock = `hitpay:${row.installment_id}`;
  if (!hold(lock)) return { error: "Payment is already starting.", status: 409, registration };
  try {
    let current = row;
    if (current.gateway_ref) {
      const remote = await hitpayFetch(`/v1/payment-requests/${encodeURIComponent(current.gateway_ref)}`);
      if (!remote.ok) {
        return { error: hitpayMessage(remote.body, remote.status), status: 502, registration, hitpay: await presentHitpay(db, current) };
      }
      await applyHitpayPayload(db, remote.body);
      current = db.prepare("SELECT * FROM hitpay_payments WHERE id = ?").get(row.id);
      const latestRegistration = getRegistration(db, row.registration_id);
      if (current.status === "paid") return view(db, latestRegistration, current);
      if (current.status === "failed") {
        return { error: "This payment can't continue. Nothing was charged.", status: 400, registration: latestRegistration, hitpay: await presentHitpay(db, current) };
      }
    }
    const state = windowState(current);
    const shown = await presentHitpay(db, current);
    if (state === "open") return { error: "This QR is still active.", status: 400, registration: getRegistration(db, row.registration_id), hitpay: shown };
    if (state === "closed") return { error: "This QR expired. Start the payment again.", status: 400, registration: getRegistration(db, row.registration_id), hitpay: shown };
    if (refreshesLeft(db, current.installment_id) <= 0) {
      return { error: "This payment already used its QR codes. Nothing was charged.", status: 400, registration: getRegistration(db, row.registration_id), hitpay: shown };
    }
    const due = getRegistration(db, row.registration_id)?.installments.find((item) => item.id === current.installment_id);
    if (!due || due.status !== "due") {
      return { error: "Nothing is due.", status: 400, registration: getRegistration(db, row.registration_id), hitpay: shown };
    }
    const latestRegistration = getRegistration(db, row.registration_id);
    const baseCents = due.amount_cents - due.amount_paid_cents;
    const quote = paymentCharge(db, latestRegistration, baseCents, { channel: "hitpay_qr" });
    return await createHitpaySession(db, latestRegistration, due, quote.totalCents, "qr", current.id, quote.feeCents);
  } catch (error) {
    const message = error instanceof Error ? error.message : "HitPay could not refresh the QR.";
    return { error: message, status: 502, registration: getRegistration(db, row.registration_id) };
  } finally {
    release(lock);
  }
}

export async function handleHitpayWebhook(db, rawBody, signature, headers = {}) {
  const salt = String(process.env.HITPAY_SALT || "").trim();
  if (!salt || !hitpaySignaturesMatch(rawBody, signature, salt)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }
  const eventType = String(headers.eventType || "").toLowerCase();
  const eventObject = String(headers.eventObject || "").toLowerCase();
  if ((eventType && eventType !== "completed") || (eventObject && eventObject !== "payment_request")) {
    return { status: 200, body: { ok: true } };
  }
  let payload;
  try {
    payload = JSON.parse(String(rawBody || ""));
  } catch {
    return { status: 200, body: { ok: true } };
  }
  try {
    await applyHitpayPayload(db, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error(message || error);
    if (message.includes("No installment is due") || message.includes("not payable")) {
      return { status: 200, body: { ok: true } };
    }
    return { status: 500, body: { error: "Payment was not recorded" } };
  }
  return { status: 200, body: { ok: true } };
}

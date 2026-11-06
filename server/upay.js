import crypto from "crypto";
import QRCode from "qrcode";
import { getRegistration, recordPayment } from "./registrations.js";
import { isChannelEnabled } from "./payment-channels.js";

const METHODS = new Set(["instapay", "paygate", "UB Online"]);
let cachedToken = null;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error("UnionBank Upay is not configured.");
  return value;
}

function billerUuid() {
  return required("UPAY_BILLER_UUID");
}

function aesKey() {
  const raw = String(process.env.UPAY_AES_KEY || "").trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const utf8 = Buffer.from(raw, "utf8");
  if (utf8.length === 32) return utf8;
  return null;
}

function baseUrl() {
  return (process.env.UPAY_BASE_URL || "https://api-uat.unionbankph.com/partners/sb").replace(/\/$/, "");
}

function callbackUrl() {
  const explicit = String(process.env.UPAY_CALLBACK_URL || "").trim();
  if (explicit) return explicit;
  const site = String(process.env.SITE_URL || "").replace(/\/$/, "");
  return site ? `${site}/api/payments/upay/callback` : "";
}

export function upayMobile(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length >= 12) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

export function tranRequestDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}.000`;
}

export function pesosFromCents(cents) {
  return Math.round(cents) / 100;
}

function valueForReference(name, input) {
  const label = String(name || "").toLowerCase();
  const names = input.fullName.trim().split(/\s+/).filter(Boolean);
  if (label.includes("email")) return input.email;
  if (label.includes("mobile") || label.includes("phone") || label.includes("contact")) return input.mobile;
  if (label.includes("last")) return names[names.length - 1] || input.fullName;
  if (label.includes("first")) return names[0] || input.fullName;
  if (label.includes("name") || label.includes("payor") || label.includes("customer")) return input.fullName;
  if (label.includes("amount")) return String(pesosFromCents(input.amountCents));
  return input.reference;
}

export function paymentReferences(fields, input) {
  const list = Array.isArray(fields) ? fields : [];
  const usable = list.filter((field) => {
    const rules = field.validations || {};
    const visible = rules.isVisible;
    const hidden = visible === false || visible === "false";
    return rules.isRequired || !hidden;
  });
  if (usable.length === 0) {
    return [
      { index: 1, value: input.fullName },
      { index: 2, value: input.reference },
      { index: 3, value: input.email },
      { index: 4, value: input.mobile },
    ];
  }
  return usable.map((field, position) => ({
    index: Number(field.index) || position + 1,
    value: String(valueForReference(field.name, input)).slice(0, Number(field.validations?.maxCharLength) || 100),
  }));
}

function unionbankMessage(body, status) {
  const info = body?.moreInformation || body?.httpMessage || body?.description || body?.message || body?.error;
  const text = Array.isArray(info) ? info.join(" ") : String(info || "");
  if (/not registered to plan/i.test(text)) {
    return "UnionBank accepted the login, then refused UPay. This sandbox app is not subscribed to UPay by UnionBank. Ask your UnionBank API contact to turn that product on, then try the ₱10 payment again.";
  }
  if (text) return `UnionBank could not start the payment. ${text}`;
  return `UnionBank could not start the payment (${status}).`;
}

async function partnerToken() {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) return cachedToken.value;
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: required("UPAY_CLIENT_ID"),
    username: required("UPAY_USERNAME"),
    password: required("UPAY_PASSWORD"),
    scope: process.env.UPAY_SCOPE || "upay_payments",
  });
  const response = await fetch(`${baseUrl()}/partners/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(unionbankMessage(payload, response.status));
  }
  cachedToken = {
    value: payload.access_token,
    expiresAt: now + (Number(payload.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

async function upayFetch(path, token, options = {}) {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-ibm-client-id": required("UPAY_CLIENT_ID"),
      "x-ibm-client-secret": required("UPAY_CLIENT_SECRET"),
      "x-partner-id": required("UPAY_PARTNER_ID"),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: payload };
}

function dueInstallment(registration) {
  return registration.installments.find((item) => item.status === "due") || null;
}

function senderRefId() {
  return `IBMC${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}

async function loadReferences(token, input) {
  const response = await upayFetch(`/upay/payments/v1/billers/${encodeURIComponent(billerUuid())}/references`, token);
  if (response.status === 404) {
    throw new Error("UnionBank does not have this biller in the sandbox yet.");
  }
  if (!response.ok) throw new Error(unionbankMessage(response.body, response.status));
  return paymentReferences(response.body.references, input);
}

function qrText(body) {
  const value = body?.qr || body?.qrCode;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function paymentLink(body) {
  for (const key of ["paymentUrl", "paymentLink", "redirectUrl", "url", "link"]) {
    const value = body?.[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  return "";
}

export function upayOutcome(body) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const latest = rows[rows.length - 1];
  if (latest) {
    const status = `${latest.status || ""} ${latest.billerPostStatus || ""}`.toUpperCase();
    if (/FAIL/.test(status)) return "failed";
    if (/(SUCCESS|PAID|POSTED|CREDITED|COMPLETED|\bTS\b)/.test(status)) return "paid";
    return "pending";
  }
  const code = String(body?.code || "").toUpperCase();
  if (code === "TS") return "paid";
  if (code === "TF") return "failed";
  return "pending";
}

function centsFrom(value) {
  const text = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100);
}

const COLLECTED_AMOUNT_KEYS = ["amount", "paidAmount", "transactionAmount", "paid_amount"];

export function upayCollectedCents(body) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const latest = rows.length ? rows[rows.length - 1] : null;
  const source = latest || (body && typeof body === "object" ? body : null);
  if (!source) return null;
  const found = [];
  for (const key of COLLECTED_AMOUNT_KEYS) {
    if (source[key] == null || source[key] === "") continue;
    const cents = centsFrom(source[key]);
    if (cents == null) return null;
    found.push(cents);
  }
  if (!found.length) return null;
  return found.every((value) => value === found[0]) ? found[0] : null;
}

export function upaySettlement(body, expectedCents) {
  const outcome = upayOutcome(body);
  if (outcome !== "paid") return outcome;
  const collected = upayCollectedCents(body);
  if (collected == null || collected !== expectedCents) return "pending";
  return "paid";
}

async function presentUpay(row) {
  let qrDataUrl = "";
  if (row.qr) {
    try {
      qrDataUrl = await QRCode.toDataURL(row.qr, { margin: 1, width: 280 });
    } catch {
      qrDataUrl = "";
    }
  }
  return {
    senderRefId: row.sender_ref_id,
    paymentMethod: row.payment_method,
    status: row.status,
    state: row.unionbank_state || "",
    code: row.unionbank_code || "",
    qrDataUrl,
    paymentUrl: row.payment_url || "",
    billerName: process.env.UPAY_BILLER_NAME || "UnionBank UPay",
  };
}

function saveUpay(db, row, patch) {
  db.prepare(`
    UPDATE upay_payments
    SET status = ?, unionbank_code = ?, unionbank_state = ?, transaction_id = ?, transaction_uuid = ?,
        qr = ?, payment_url = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    patch.status || row.status,
    patch.code ?? row.unionbank_code,
    patch.state ?? row.unionbank_state,
    patch.transactionId ?? row.transaction_id,
    patch.transactionUuid ?? row.transaction_uuid,
    patch.qr ?? row.qr,
    patch.paymentUrl ?? row.payment_url,
    row.id,
  );
  return db.prepare("SELECT * FROM upay_payments WHERE id = ?").get(row.id);
}

function settle(db, row) {
  const already = db.prepare("SELECT id FROM payments WHERE external_reference = ?").get(row.sender_ref_id);
  if (already) return getRegistration(db, row.registration_id);
  const registration = getRegistration(db, row.registration_id);
  const target = registration?.installments.find((item) => item.id === row.installment_id);
  if (!target || target.status !== "due") return registration;
  return recordPayment(db, {
    registrationId: registration.id,
    installmentId: target.id,
    amountCents: row.amount_cents,
    method: `upay:${row.payment_method}`,
    externalReference: row.sender_ref_id,
  });
}

async function readStatus(row, token) {
  const attempts = [];
  if (row.transaction_uuid) {
    attempts.push(`/upay/payments/v1/transactions/${encodeURIComponent(row.transaction_uuid)}/status`);
  }
  attempts.push(`/upay/payments/v1/transactions/${encodeURIComponent(row.sender_ref_id)}/status`);
  attempts.push(`/upay/payments/v1/transactions/${encodeURIComponent(billerUuid())}/status?senderRefId=${encodeURIComponent(row.sender_ref_id)}`);
  let last = null;
  for (const path of attempts) {
    const response = await upayFetch(path, token);
    last = response;
    if (response.ok) return response;
    if (response.status !== 404) break;
  }
  return last;
}

export async function startUpayPayment(db, registration, paymentMethod) {
  if (!isChannelEnabled(db, "upay")) {
    return { error: "UnionBank U Pay is not available.", status: 400, registration };
  }
  if (!METHODS.has(paymentMethod)) {
    return { error: "Choose UnionBank Online, InstaPay, or other banks.", status: 400, registration };
  }
  if (registration.currency !== "PHP") {
    return { error: "UnionBank Upay collects peso payments.", status: 400, registration };
  }
  const due = dueInstallment(registration);
  const amountCents = due ? due.amount_cents - due.amount_paid_cents : 0;
  if (!due || amountCents <= 0) {
    return { registration, upay: null };
  }
  const open = db.prepare(`
    SELECT * FROM upay_payments
    WHERE installment_id = ? AND payment_method = ? AND status = 'pending'
    ORDER BY id DESC
    LIMIT 1
  `).get(due.id, paymentMethod);
  if (open) {
    const refreshed = await refreshUpayPayment(db, open.sender_ref_id);
    if (refreshed.upay?.status === "pending" || refreshed.upay?.status === "paid") return refreshed;
  }
  const mobile = upayMobile(registration.mobile);
  if (mobile.length < 10) {
    return { error: "Add a Philippine mobile number so UnionBank can send the receipt.", status: 400, registration };
  }
  const input = {
    fullName: registration.full_name,
    email: registration.email,
    mobile,
    reference: registration.reference,
    amountCents,
  };
  let token;
  try {
    token = await partnerToken();
    const references = await loadReferences(token, input);
    const sender = senderRefId();
    const created = await upayFetch("/upay/payments/v1/transactions", token, {
      method: "POST",
      body: {
        senderRefId: sender,
        tranRequestDate: tranRequestDate(),
        billerUuid: billerUuid(),
        emailAddress: registration.email,
        mobileNumber: mobile,
        amount: pesosFromCents(amountCents),
        paymentMethod,
        callbackUrl: callbackUrl(),
        references,
      },
    });
    if (!created.ok) {
      return { error: unionbankMessage(created.body, created.status), status: created.status === 400 ? 400 : 502, registration };
    }
    const outcome = upayOutcome(created.body);
    const settlement = upaySettlement(created.body, amountCents);
    if (outcome === "paid" && settlement !== "paid") {
      console.error(`UPay amount was not confirmed for ${sender}`);
    }
    const result = db.prepare(`
      INSERT INTO upay_payments (
        registration_id, installment_id, sender_ref_id, amount_cents, currency, payment_method,
        status, unionbank_code, unionbank_state, transaction_id, transaction_uuid, qr, payment_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      registration.id,
      due.id,
      sender,
      amountCents,
      registration.currency,
      paymentMethod,
      settlement === "failed" ? "failed" : "pending",
      created.body.code || null,
      created.body.state || null,
      created.body.transactionId || null,
      created.body.uuid || null,
      qrText(created.body) || null,
      paymentLink(created.body) || null,
    );
    let row = db.prepare("SELECT * FROM upay_payments WHERE id = ?").get(result.lastInsertRowid);
    let current = registration;
    if (settlement === "paid") {
      current = settle(db, row);
      row = saveUpay(db, row, { status: "paid" });
    } else if (settlement === "failed") {
      row = saveUpay(db, row, { status: "failed" });
      return { error: created.body.state || "UnionBank declined the payment.", status: 402, registration: current, upay: await presentUpay(row) };
    }
    return { registration: current, upay: await presentUpay(row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UnionBank could not start the payment.";
    return { error: message, status: 502, registration };
  }
}

export async function refreshUpayPayment(db, senderRefIdValue) {
  const row = db.prepare("SELECT * FROM upay_payments WHERE sender_ref_id = ?").get(senderRefIdValue);
  if (!row) return { error: "Payment not found", status: 404 };
  if (row.status === "paid") {
    return { registration: getRegistration(db, row.registration_id), upay: await presentUpay(row) };
  }
  try {
    const token = await partnerToken();
    const response = await readStatus(row, token);
    if (!response?.ok) {
      return {
        registration: getRegistration(db, row.registration_id),
        upay: await presentUpay(row),
        error: unionbankMessage(response?.body, response?.status || 502),
        status: 200,
      };
    }
    const outcome = upayOutcome(response.body);
    const settlement = upaySettlement(response.body, row.amount_cents);
    if (outcome === "paid" && settlement !== "paid") {
      console.error(`UPay amount was not confirmed for ${row.sender_ref_id}`);
    }
    let current = getRegistration(db, row.registration_id);
    const next = saveUpay(db, row, {
      status: settlement,
      code: response.body.code || row.unionbank_code,
      state: response.body.state || row.unionbank_state,
      transactionId: response.body.transactionId || row.transaction_id,
      transactionUuid: response.body.uuid || row.transaction_uuid,
      qr: qrText(response.body) || row.qr,
      paymentUrl: paymentLink(response.body) || row.payment_url,
    });
    if (settlement === "paid") current = settle(db, next);
    return { registration: current, upay: await presentUpay(next) };
  } catch (error) {
    return {
      registration: getRegistration(db, row.registration_id),
      upay: await presentUpay(row),
      error: error instanceof Error ? error.message : "UnionBank could not confirm the payment.",
      status: 200,
    };
  }
}

function decryptAes(encoded, key) {
  const bytes = Buffer.from(String(encoded).trim(), "base64");
  if (bytes.length <= 16) throw new Error("short");
  try {
    const iv = bytes.subarray(0, 16);
    const data = bytes.subarray(16);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    const decipher = crypto.createDecipheriv("aes-256-ecb", key, null);
    return Buffer.concat([decipher.update(bytes), decipher.final()]).toString("utf8");
  }
}

export function readCallbackBody(body) {
  const encoded = typeof body === "string"
    ? body
    : body?.data || body?.payload || body?.encryptedData;
  const key = aesKey();
  if (!encoded || !key || (body && (body.senderRefId || body.sender_ref_id) && !body.data && !body.payload && !body.encryptedData)) {
    const error = new Error("Unsigned UPay callback");
    error.status = 401;
    throw error;
  }
  const text = decryptAes(encoded, key);
  return JSON.parse(text);
}

export async function handleUpayCallback(db, body) {
  let parsed;
  try {
    parsed = readCallbackBody(body);
  } catch {
    return { ok: false, status: 401 };
  }
  const sender = parsed?.senderRefId || parsed?.sender_ref_id;
  if (!sender) return { ok: false, status: 401 };
  await refreshUpayPayment(db, sender);
  return { ok: true, status: 200 };
}

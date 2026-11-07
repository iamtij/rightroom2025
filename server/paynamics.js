import crypto from "crypto";
import { getRegistration, recordPayment } from "./registrations.js";
import { isChannelEnabled } from "./payment-channels.js";

const locks = new Set();
const DEFAULT_CHECKOUT_TTL_MINUTES = 30;
const PAYMENT_ACTION = "url_link";

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

function joinSignature(parts) {
  return paynamicsSha512(parts.map((item) => String(item ?? "")).join(""));
}

/** Official Workflow Postman ordering (Share | WorkFlow). */
export function paynamicsTransactionSignature(transaction, merchantId, merchantKey) {
  const tx = transaction && typeof transaction === "object" ? transaction : {};
  const parts = [
    merchantId,
    tx.request_id,
    tx.notification_url,
    tx.response_url,
    tx.cancel_url,
    tx.pmethod,
    tx.payment_action,
    tx.schedule,
    tx.collection_method,
    tx.deferred_period,
    tx.deferred_time,
    tx.dp_balance_info,
    tx.amount,
    tx.currency,
    tx.descriptor_note,
    tx.payment_notification_status,
    tx.payment_notification_channel,
    merchantKey,
  ];
  return joinSignature(parts);
}

export function paynamicsCustomerSignature(customer, merchantKey) {
  const info = customer && typeof customer === "object" ? customer : {};
  return joinSignature([
    info.fname,
    info.lname,
    info.mname,
    info.email,
    info.phone,
    info.mobile,
    info.dob,
    merchantKey,
  ]);
}

export function paynamicsQuerySignature(requestId, orgTrxid2, merchantId, merchantKey) {
  return joinSignature([merchantId, requestId, orgTrxid2, merchantKey]);
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

export function paynamicsNotificationVerifyContract() {
  return String(process.env.PAYNAMICS_NOTIFICATION_VERIFY_CONTRACT || "").trim();
}

export function paynamicsSettlementEnabled() {
  if (process.env.PAYNAMICS_SETTLEMENT_ENABLED !== "true") return false;
  const contract = paynamicsNotificationVerifyContract();
  if (!contract) return false;
  if (contract === "workflow_mock_test_only") return process.env.NODE_ENV === "test" || process.env.PAYNAMICS_ALLOW_TEST_SETTLEMENT === "true";
  return false;
}

export function paynamicsQuerySettlementEnabled() {
  return process.env.PAYNAMICS_QUERY_SETTLEMENT_ENABLED === "true" && Boolean(paynamicsNotificationVerifyContract());
}

export function notificationVerified(payload) {
  if (!paynamicsSettlementEnabled()) return false;
  const contract = paynamicsNotificationVerifyContract();
  if (contract === "workflow_mock_test_only") return payload?.__testVerified === true;
  return false;
}

export function queryResponseVerified() {
  return false;
}

export function parseNotificationPayload(body) {
  if (!body) return {};
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return {};
    try {
      return parseNotificationPayload(JSON.parse(trimmed));
    } catch {
      return { raw: trimmed };
    }
  }
  if (typeof body !== "object") return {};
  const root = body;
  const transaction = root.transaction && typeof root.transaction === "object" ? root.transaction : root;
  return {
    request_id: transaction.request_id || root.request_id || "",
    response_id: transaction.response_id || root.response_id || "",
    response_code: transaction.response_code || root.response_code || "",
    response_message: transaction.response_message || root.response_message || "",
    amount: transaction.amount || root.amount || "",
    currency: transaction.currency || root.currency || "",
    merchantid: transaction.merchantid || root.merchantid || "",
    signature: transaction.signature || root.signature || "",
    pmethod: transaction.pmethod || root.pmethod || "",
    pchannel: transaction.pchannel || root.pchannel || "",
    raw: root,
  };
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

export function paynamicsApiBaseUrl() {
  return String(process.env.PAYNAMICS_API_BASE_URL || "").trim().replace(/\/$/, "");
}

export function paynamicsApiAccountConfirmed() {
  return process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED === "true";
}

export function paynamicsApiCallsEnabled() {
  return process.env.PAYNAMICS_API_CALLS_ENABLED === "true";
}

export function paynamicsApiCallsAllowed() {
  if (!paynamicsApiCallsEnabled()) return false;
  if (!paynamicsApiAccountConfirmed()) return false;
  const base = paynamicsApiBaseUrl();
  if (!base) return false;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:") return false;
  } catch {
    return false;
  }
  if (!String(process.env.PAYNAMICS_BASIC_AUTH_USER || "").trim()) return false;
  if (!String(process.env.PAYNAMICS_BASIC_AUTH_PASSWORD || "").trim()) return false;
  if (!String(process.env.PAYNAMICS_MERCHANT_ID || "").trim()) return false;
  if (!String(process.env.PAYNAMICS_MERCHANT_KEY || "").trim()) return false;
  if (process.env.PAYNAMICS_ALLOW_PRODUCTION !== "true" && process.env.PAYNAMICS_API_ENV !== "sandbox") return false;
  return true;
}

function basicAuthHeader() {
  const user = required("PAYNAMICS_BASIC_AUTH_USER");
  const pass = required("PAYNAMICS_BASIC_AUTH_PASSWORD");
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

async function paynamicsApiFetch(path, body) {
  if (!paynamicsApiCallsAllowed()) {
    throw new Error("Paynamics API calls are disabled until sandbox account details are confirmed.");
  }
  const base = paynamicsApiBaseUrl();
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: payload };
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

function allowedRedirectUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

/** Response payment-link field names are not in the sanitized Postman collection; verify against Paynamics Wiki §10.2. */
export function extractHostedPaymentUrl(payload) {
  if (!payload || typeof payload !== "object") return "";
  const candidates = [
    payload.redirect_url,
    payload.payment_url,
    payload.url,
    payload.url_link,
    payload?.transaction?.redirect_url,
    payload?.transaction?.payment_url,
    payload?.transaction?.url,
    payload?.data?.redirect_url,
    payload?.data?.payment_url,
    payload?.response?.redirect_url,
    payload?.response?.payment_url,
  ];
  for (const item of candidates) {
    const url = allowedRedirectUrl(item);
    if (url) return url;
  }
  return "";
}

export function buildWorkflowCreateBody({
  merchantId,
  merchantKey,
  requestId,
  registration,
  amountCents,
}) {
  const phone = formatPhone(registration.mobile);
  const name = splitName(registration.full_name);
  const amount = amountLabel(amountCents);
  const notification = notificationUrl();
  const response = responseUrl(requestId);
  const cancel = cancelUrl();
  const pmethod = optional("PAYNAMICS_PMETHOD");
  const pchannel = optional("PAYNAMICS_PCHANNEL");
  const descriptor = optional("PAYNAMICS_DESCRIPTOR", `IBMC 2027 ${registration.reference}`);
  const transaction = {
    request_id: requestId,
    notification_url: notification,
    response_url: response,
    cancel_url: cancel,
    pmethod,
    ...(pchannel ? { pchannel } : {}),
    payment_action: PAYMENT_ACTION,
    collection_method: optional("PAYNAMICS_COLLECTION_METHOD", "single_pay"),
    payment_notification_status: optional("PAYNAMICS_PAYMENT_NOTIFICATION_STATUS", "1"),
    payment_notification_channel: optional("PAYNAMICS_PAYMENT_NOTIFICATION_CHANNEL", "1"),
    schedule: "",
    deferred_period: "",
    deferred_time: "",
    dp_balance_info: "",
    amount,
    currency: "PHP",
    descriptor_note: descriptor,
  };
  transaction.signature = paynamicsTransactionSignature(transaction, merchantId, merchantKey);
  const customer_info = {
    fname: name.fname,
    lname: name.lname,
    mname: name.mname,
    email: registration.email,
    phone,
    mobile: phone,
    dob: optional("PAYNAMICS_DEFAULT_DOB", ""),
  };
  customer_info.signature = paynamicsCustomerSignature(customer_info, merchantKey);
  const billing_info = {
    billing_address1: optional("PAYNAMICS_DEFAULT_ADDRESS1", "Makati"),
    billing_address2: optional("PAYNAMICS_DEFAULT_ADDRESS2", ""),
    billing_city: optional("PAYNAMICS_DEFAULT_CITY", "Makati"),
    billing_state: optional("PAYNAMICS_DEFAULT_STATE", "PH-00"),
    billing_country: optional("PAYNAMICS_DEFAULT_COUNTRY", "PH"),
    billing_zip: optional("PAYNAMICS_DEFAULT_ZIP", "1200"),
  };
  const order_details = {
    orders: [
      {
        itemname: `IBMC 2027 ${registration.reference}`.slice(0, 100),
        quantity: 1,
        unitprice: amount,
        totalprice: amount,
      },
    ],
    subtotalprice: amount,
    shippingprice: "0.00",
    discountamount: "0.00",
    totalorderamount: amount,
  };
  return { transaction, customer_info, billing_info, order_details };
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
    paymentUrl: allowedRedirectUrl(row.payment_url),
    gatewayResponseCode: row.gateway_response_code || "",
    gatewayMessage: row.gateway_message || "",
    expiresAt: row.expires_at || "",
    settlementPendingVerification: !paynamicsSettlementEnabled(),
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
        payment_url = COALESCE(?, payment_url),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    patch.status || row.status,
    patch.gatewayResponseCode || null,
    patch.gatewayMessage || null,
    patch.gatewayResponseId || null,
    patch.paymentChannel || null,
    patch.paymentUrl || null,
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

function referenceMatches(row, payload) {
  if (!payload?.request_id) return false;
  return String(payload.request_id) === String(row.request_id);
}

function amountMatches(row, payload) {
  if (!payload?.amount) return true;
  const cents = paynamicsAmountCents(payload.amount);
  if (cents === null) return true;
  return cents === row.amount_cents;
}

function currencyMatches(payload) {
  if (!payload?.currency) return true;
  return String(payload.currency).toUpperCase() === "PHP";
}

export function applyPaynamicsStatus(db, row, payload, { allowSettle = false } = {}) {
  if (!row || row.status === "paid") return row;
  if (!referenceMatches(row, payload)) {
    return savePaynamics(db, row, { status: "failed", gatewayResponseCode: "ref", gatewayMessage: "request_id mismatch" });
  }
  if (!amountMatches(row, payload)) {
    return savePaynamics(db, row, {
      status: "failed",
      gatewayResponseCode: payload.response_code || "amount",
      gatewayMessage: "amount mismatch",
      gatewayResponseId: payload.response_id || null,
      paymentChannel: payload.pchannel || payload.pmethod || null,
    });
  }
  if (!currencyMatches(payload)) {
    return savePaynamics(db, row, { status: "failed", gatewayResponseCode: "currency", gatewayMessage: "currency mismatch" });
  }
  const patch = {
    gatewayResponseCode: payload.response_code || row.gateway_response_code,
    gatewayMessage: payload.response_message || row.gateway_message,
    gatewayResponseId: payload.response_id || row.gateway_response_id,
    paymentChannel: payload.pchannel || payload.pmethod || row.payment_channel,
  };
  const outcome = paynamicsOutcome(payload.response_code);
  if (outcome === "paid" && allowSettle) {
    settlePaynamics(db, row);
    return db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(row.id);
  }
  if (outcome === "failed") return savePaynamics(db, row, { ...patch, status: "failed" });
  if (outcome === "pending") return savePaynamics(db, row, { ...patch, status: "pending" });
  return savePaynamics(db, row, patch);
}

async function queryWorkflowStatus(row) {
  if (!paynamicsApiCallsAllowed()) return null;
  const merchantId = String(process.env.PAYNAMICS_MERCHANT_ID || "").trim();
  const merchantKey = String(process.env.PAYNAMICS_MERCHANT_KEY || "").trim();
  const queryRequestId = `Q${crypto.randomBytes(10).toString("hex")}`.slice(0, 32);
  const signature = paynamicsQuerySignature(queryRequestId, row.request_id, merchantId, merchantKey);
  try {
    const remote = await paynamicsApiFetch("/paygate/transactions/query", {
      request_id: queryRequestId,
      org_trxid2: row.request_id,
      signature,
    });
    return remote;
  } catch {
    return null;
  }
}

export async function startPaynamicsPayment(db, registration) {
  if (!isChannelEnabled(db, "paynamics")) return { error: "That payment option is turned off.", status: 400, registration };
  if (registration.currency !== "PHP") return { error: "Paynamics collects peso payments.", status: 400, registration };
  if (!paynamicsApiCallsAllowed()) {
    return {
      error: "Paynamics checkout is not enabled until sandbox API host and credentials are confirmed.",
      status: 503,
      registration,
    };
  }
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
    const requestId = crypto.randomBytes(12).toString("hex");
    const createBody = buildWorkflowCreateBody({ merchantId, merchantKey, requestId, registration, amountCents });
    let created;
    try {
      created = await paynamicsApiFetch("/paygate/transactions/", createBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Paynamics could not start the payment.";
      return { error: message, status: 502, registration };
    }
    const paymentUrl = extractHostedPaymentUrl(created.body);
    const gatewayCode = String(created.body?.response_code || created.body?.transaction?.response_code || "");
    const gatewayMessage = String(created.body?.response_message || created.body?.transaction?.response_message || "");
    const gatewayRef = String(created.body?.response_id || created.body?.transaction?.response_id || "");
    const failed = !created.ok || !paymentUrl;
    const insert = db.prepare(`
      INSERT INTO paynamics_payments (
        registration_id, installment_id, request_id, gateway_response_id, amount_cents, currency, status,
        gateway_response_code, gateway_message, payment_url, expires_at
      ) VALUES (?, ?, ?, ?, ?, 'PHP', ?, ?, ?, ?, ?)
    `);
    const result = insert.run(
      registration.id,
      due.id,
      requestId,
      gatewayRef || null,
      amountCents,
      failed ? "failed" : "pending",
      gatewayCode || (failed ? "create_failed" : null),
      gatewayMessage || (failed ? "hosted link missing or create failed" : null),
      paymentUrl || null,
      expiresAt(),
    );
    const saved = db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(result.lastInsertRowid);
    if (failed) {
      return {
        error: gatewayMessage || "Paynamics did not return a payment link.",
        status: 502,
        registration,
        paynamics: presentPaynamics(saved),
      };
    }
    return view(db, registration, saved);
  } finally {
    release(lock);
  }
}

export async function refreshPaynamicsPayment(db, requestId) {
  const row = findRequest(db, requestId);
  if (!row) return { error: "Payment not found", status: 404 };
  let current = row;
  const expires = Date.parse(current.expires_at || "");
  if (current.status === "pending" && Number.isFinite(expires) && Date.now() >= expires) {
    current = savePaynamics(db, current, { status: "expired", gatewayMessage: "checkout expired" });
  }
  if (current.status === "pending" && paynamicsApiCallsAllowed()) {
    const remote = await queryWorkflowStatus(current);
    if (remote?.body) {
      const payload = parseNotificationPayload(remote.body);
      const allowSettle = paynamicsQuerySettlementEnabled() && queryResponseVerified();
      current = applyPaynamicsStatus(db, current, payload, { allowSettle }) || current;
    }
  }
  const registration = getRegistration(db, current.registration_id);
  return view(db, registration, current);
}

export async function handlePaynamicsNotification(db, body) {
  const payload = parseNotificationPayload(body);
  if (!payload.request_id) return { status: 400, body: "invalid payload" };
  const row = findRequest(db, payload.request_id);
  if (!row) return { status: 200, body: "OK" };
  const verified = notificationVerified(payload);
  try {
    let current = applyPaynamicsStatus(db, row, payload, { allowSettle: verified }) || row;
    if (!verified) {
      current = savePaynamics(db, current, {
        status: current.status,
        gatewayResponseCode: payload.response_code || current.gateway_response_code,
        gatewayMessage: payload.response_message || "notification received; settlement awaiting verified contract",
        gatewayResponseId: payload.response_id || current.gateway_response_id,
      });
    }
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

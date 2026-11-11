import crypto from "crypto";
import {
  assessProductionLiveDeploymentIdentity,
  assessStagingLiveDeploymentIdentity,
  ibmcDeploymentEnv,
  railwayDeploymentClass,
  railwaySignalsPresent,
} from "./deployment-identity.js";

export {
  assessProductionLiveDeploymentIdentity,
  assessStagingLiveDeploymentIdentity,
  ibmcDeploymentEnv,
  railwayDeploymentClass,
  railwaySignalsPresent,
};
import { reportError } from "./report-error.js";
import { getRegistration } from "./registrations.js";
import { HOLD_EXPIRED_MESSAGE, expireRegistrationHold, refreshHeldRegistration, sessionStartedBeforeHold, settleOpeningPayment } from "./payment-hold.js";
import { isChannelEnabled, isPaynamicsMethodEnabled, paynamicsMethodByCode } from "./payment-channels.js";
import { paymentCharge, settlementBaseCents } from "./convenience-fee.js";

const locks = new Set();
const DEFAULT_CHECKOUT_TTL_MINUTES = 30;
const PAYMENT_ACTION = "url_link";
const WIKI_TEST_API_BASE = "https://payin.payserv.net";

const TRANSACTION_SUCCESS = new Set(["GR001"]);
const TRANSACTION_PENDING = new Set(["GR033"]);
const TRANSACTION_FAILED = new Set(["GR003", "GR036", "GR152", "GR153", "GR158"]);

export function paynamicsSha512(value) {
  return crypto.createHash("sha512").update(String(value || ""), "utf8").digest("hex");
}

function joinSignature(parts) {
  return paynamicsSha512(parts.map((item) => String(item ?? "")).join(""));
}

/** §10.3 Workflow transaction request signature. */
export function paynamicsTransactionSignature(transaction, merchantId, merchantKey) {
  const tx = transaction && typeof transaction === "object" ? transaction : {};
  return joinSignature([
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
  ]);
}

/** §10.3 customer information signature. */
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

/** §10.10 Workflow query request signature. */
export function paynamicsQuerySignature(requestId, orgTrxid2, merchantId, merchantKey) {
  return joinSignature([merchantId, requestId, orgTrxid2, merchantKey]);
}

/** §10.3 initial/final Workflow response signature. */
export function paynamicsWorkflowResponseSignature(response, merchantKey) {
  const row = response && typeof response === "object" ? response : {};
  return joinSignature([
    row.merchant_id,
    row.request_id,
    row.response_id,
    row.gateway_id,
    row.response_code,
    row.response_message,
    row.response_advise,
    row.timestamp,
    row.processor_response_id,
    row.processor_response_authcode,
    row.pay_reference,
    merchantKey,
  ]);
}

export function paynamicsSignaturesMatch(expected, provided) {
  const got = String(provided || "").trim().toLowerCase();
  const want = String(expected || "").trim().toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(got) || !/^[0-9a-f]{128}$/.test(want)) return false;
  return crypto.timingSafeEqual(Buffer.from(want, "utf8"), Buffer.from(got, "utf8"));
}

/** Transaction payment outcome from response_code (never treats QM001 as paid). */
export function paynamicsPaymentOutcome(responseCode) {
  const code = String(responseCode || "").trim().toUpperCase();
  if (!code) return "pending";
  if (code === "QM001") return "query_ok";
  if (TRANSACTION_SUCCESS.has(code)) return "paid";
  if (TRANSACTION_PENDING.has(code)) return "pending";
  if (TRANSACTION_FAILED.has(code)) return "failed";
  if (code.startsWith("QM")) return "query_ok";
  if (code.startsWith("GR")) return "failed";
  return "pending";
}

/** Record IBMC payments when Paynamics sends a signed GR001 (webhook or query). Off on production unless explicitly opted in. */
export function paynamicsSettlementEnabled() {
  if (process.env.PAYNAMICS_SETTLEMENT_ENABLED === "false") return false;
  if (!paynamicsApiCallsAllowed()) return false;
  if (ibmcProductionDeployment() && process.env.PAYNAMICS_SETTLEMENT_ENABLED !== "true") return false;
  return true;
}

export function paynamicsAmountCents(amountText) {
  const normalized = String(amountText || "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function paynamicsPaymentHostAllowlist() {
  const raw = String(process.env.PAYNAMICS_PAYMENT_HOST_ALLOWLIST || "payserv.net").trim();
  return raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function allowedPaymentRedirectUrl(value) {
  const urlText = String(value || "").trim();
  if (!urlText) return "";
  let url;
  try {
    url = new URL(urlText);
  } catch {
    return "";
  }
  if (url.protocol !== "https:") return "";
  const host = url.hostname.toLowerCase();
  const allowlist = paynamicsPaymentHostAllowlist();
  const allowed = allowlist.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (!allowed) return "";
  return url.toString();
}

export function parseWorkflowResponse(body) {
  if (!body || typeof body !== "object") return {};
  const root = body;
  return {
    merchant_id: root.merchant_id || root.merchantid || "",
    request_id: root.request_id || "",
    response_id: root.response_id || "",
    gateway_id: root.gateway_id || "",
    response_code: root.response_code || root.response_status || "",
    response_message: root.response_message || "",
    response_advise: root.response_advise || "",
    timestamp: root.timestamp || "",
    processor_response_id: root.processor_response_id || "",
    processor_response_authcode: root.processor_response_authcode || "",
    pay_reference: root.pay_reference || "",
    payment_action_info: root.payment_action_info || "",
    amount: root.amount || "",
    currency: root.currency || "",
    signature: root.signature || "",
    raw: root,
  };
}

export function workflowResponseSignatureValid(response, merchantKey, { requestId = "" } = {}) {
  if (!response?.signature) return false;
  const expected = paynamicsWorkflowResponseSignature(response, merchantKey);
  if (!paynamicsSignaturesMatch(expected, response.signature)) return false;
  if (requestId && String(response.request_id || "") !== String(requestId)) return false;
  return true;
}

/** §10.2 — hosted payment link is only `payment_action_info`. */
export function extractHostedPaymentUrl(payload) {
  const row = parseWorkflowResponse(payload);
  return allowedPaymentRedirectUrl(row.payment_action_info);
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
  let source = body;
  const nested = body.transaction;
  if (nested && typeof nested === "object" && (nested.request_id || nested.response_code || nested.signature)) {
    source = { ...body, ...nested };
  }
  const parsed = parseWorkflowResponse(source);
  return {
    ...parsed,
    merchantid: parsed.merchant_id,
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

export function paynamicsWikiTestApiBase() {
  return WIKI_TEST_API_BASE;
}

/** Parse PAYNAMICS_API_BASE_URL to a canonical https origin (no userinfo, query, fragment, or path). */
export function canonicalPaynamicsApiOrigin(raw = process.env.PAYNAMICS_API_BASE_URL) {
  const text = String(raw || "").trim();
  if (!text) return { ok: false, reason: "missing_api_base" };
  let url;
  try {
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: "invalid_api_base" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "api_base_not_https" };
  if (url.username || url.password) return { ok: false, reason: "api_base_userinfo" };
  if (url.search || url.hash) return { ok: false, reason: "api_base_query_or_fragment" };
  if (url.pathname && url.pathname !== "/") return { ok: false, reason: "api_base_path_not_allowed" };
  return { ok: true, origin: url.origin, reason: "" };
}

export function paynamicsApiBaseUrl() {
  const parsed = canonicalPaynamicsApiOrigin();
  return parsed.ok ? parsed.origin : "";
}

export function paynamicsApiAccountConfirmed() {
  return process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED === "true";
}

function paynamicsWorkflowAccountConfirmed() {
  const env = paynamicsApiEnv();
  if (env === "live") {
    return paynamicsLiveAccountConfirmed() || paynamicsApiAccountConfirmed();
  }
  return paynamicsApiAccountConfirmed();
}

export function paynamicsApiCallsEnabled() {
  return process.env.PAYNAMICS_API_CALLS_ENABLED === "true";
}

function apiBaseOrigin(base) {
  try {
    return new URL(base).origin;
  } catch {
    return "";
  }
}

function apiBaseMatchesWikiTest(base) {
  try {
    return new URL(base).origin === new URL(WIKI_TEST_API_BASE).origin;
  } catch {
    return false;
  }
}

export function ibmcStagingDeployment() {
  return ibmcDeploymentEnv() === "staging";
}

export function ibmcProductionDeployment() {
  if (ibmcDeploymentEnv() === "production") return true;
  return railwayDeploymentClass() === "production";
}

function canonicalAllowlistOrigin(entry) {
  const parsed = canonicalPaynamicsApiOrigin(entry);
  return parsed.ok ? parsed.origin : "";
}

function parsePaynamicsOriginAllowlist(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => canonicalAllowlistOrigin(item.trim()))
    .filter(Boolean);
}

export function paynamicsLiveApiOriginAllowlist() {
  return parsePaynamicsOriginAllowlist(process.env.PAYNAMICS_LIVE_API_ORIGIN_ALLOWLIST);
}

function apiBaseMatchesLiveAllowlist(origin) {
  if (!origin) return false;
  const entries = paynamicsLiveApiOriginAllowlist();
  if (!entries.length) return false;
  return entries.includes(origin);
}

export function paynamicsStagingLiveMerchantOptIn() {
  return process.env.PAYNAMICS_STAGING_LIVE_MERCHANT === "true";
}

export function paynamicsLiveAccountConfirmed() {
  return process.env.PAYNAMICS_API_LIVE_ACCOUNT_CONFIRMED === "true";
}

/** Staging-only live merchant mode (explicit opt-in + platform/custom deployment identity). */
export function paynamicsStagingLiveMerchantAllowed() {
  if (!paynamicsStagingLiveMerchantOptIn()) return false;
  if (!paynamicsLiveAccountConfirmed()) return false;
  return assessStagingLiveDeploymentIdentity().allowed;
}

export function paynamicsProductionLiveMerchantOptIn() {
  return process.env.PAYNAMICS_PRODUCTION_LIVE_MERCHANT === "true";
}

export function paynamicsProductionLiveMerchantAllowed() {
  if (!paynamicsProductionLiveMerchantOptIn()) return false;
  if (!paynamicsLiveAccountConfirmed()) return false;
  return assessProductionLiveDeploymentIdentity().allowed;
}

export function paynamicsApiEnv() {
  return String(process.env.PAYNAMICS_API_ENV || "").trim().toLowerCase();
}

function paynamicsApiCredentialsReady() {
  if (!paynamicsApiCallsEnabled()) return false;
  if (!paynamicsWorkflowAccountConfirmed()) return false;
  const base = paynamicsApiBaseUrl();
  if (!base) return false;
  try {
    if (new URL(base).protocol !== "https:") return false;
  } catch {
    return false;
  }
  if (!String(process.env.PAYNAMICS_BASIC_AUTH_USER || "").trim()) return false;
  if (!String(process.env.PAYNAMICS_BASIC_AUTH_PASSWORD || "").trim()) return false;
  if (!String(process.env.PAYNAMICS_MERCHANT_ID || "").trim()) return false;
  if (!String(process.env.PAYNAMICS_MERCHANT_KEY || "").trim()) return false;
  return true;
}

export function assessPaynamicsApiAdmission() {
  if (!paynamicsApiCallsEnabled()) return { allowed: false, reason: "api_calls_disabled" };
  if (!paynamicsWorkflowAccountConfirmed()) return { allowed: false, reason: "account_not_confirmed" };
  const parsed = canonicalPaynamicsApiOrigin();
  if (!parsed.ok) return { allowed: false, reason: parsed.reason };
  const origin = parsed.origin;
  if (!String(process.env.PAYNAMICS_BASIC_AUTH_USER || "").trim()) return { allowed: false, reason: "missing_basic_auth" };
  if (!String(process.env.PAYNAMICS_BASIC_AUTH_PASSWORD || "").trim()) return { allowed: false, reason: "missing_basic_auth" };
  if (!String(process.env.PAYNAMICS_MERCHANT_ID || "").trim()) return { allowed: false, reason: "missing_merchant_id" };
  if (!String(process.env.PAYNAMICS_MERCHANT_KEY || "").trim()) return { allowed: false, reason: "missing_merchant_key" };
  const env = paynamicsApiEnv();
  if (env === "sandbox") {
    if (!apiBaseMatchesWikiTest(origin)) return { allowed: false, reason: "sandbox_host_mismatch" };
    return { allowed: true, reason: "sandbox", mode: "sandbox" };
  }
  if (env === "live") {
    if (!paynamicsLiveAccountConfirmed()) return { allowed: false, reason: "live_account_not_confirmed" };
    if (!apiBaseMatchesLiveAllowlist(origin)) return { allowed: false, reason: "live_origin_not_allowlisted" };
    if (paynamicsProductionLiveMerchantAllowed()) {
      return { allowed: true, reason: "production_live", mode: "live" };
    }
    const identity = assessStagingLiveDeploymentIdentity();
    if (!identity.allowed) return { allowed: false, reason: identity.reason };
    if (!paynamicsStagingLiveMerchantOptIn()) {
      return { allowed: false, reason: "staging_live_not_allowed" };
    }
    return { allowed: true, reason: "staging_live", mode: "live" };
  }
  return { allowed: false, reason: "unsupported_api_env" };
}

export function paynamicsApiCallsAllowed() {
  return assessPaynamicsApiAdmission().allowed;
}

export function paynamicsCheckoutMode() {
  const admission = assessPaynamicsApiAdmission();
  if (!admission.allowed) return "off";
  return admission.mode === "live" ? "live" : "sandbox";
}

export function paynamicsLiveRealChargeWarning() {
  return paynamicsCheckoutMode() === "live";
}

export function paynamicsPublicCheckoutInfo() {
  const admission = assessPaynamicsApiAdmission();
  const mode = paynamicsCheckoutMode();
  return {
    checkoutMode: mode,
    liveRealChargeWarning: mode === "live",
    stagingLiveMerchantArmed: paynamicsStagingLiveMerchantAllowed(),
    productionLiveMerchantArmed: paynamicsProductionLiveMerchantAllowed(),
    apiAdmissionAllowed: admission.allowed,
    apiAdmissionReason: admission.allowed ? "" : admission.reason,
  };
}

/** True only when API base origin exactly matches wiki §1.6 test Workflow host. */
export function paynamicsApiBaseIsWikiTestHost() {
  return apiBaseMatchesWikiTest(paynamicsApiBaseUrl());
}

function basicAuthHeader() {
  const user = required("PAYNAMICS_BASIC_AUTH_USER");
  const pass = required("PAYNAMICS_BASIC_AUTH_PASSWORD");
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

async function paynamicsApiFetch(path, body) {
  if (!paynamicsApiCallsAllowed()) {
    throw new Error("Paynamics API calls are disabled until test Workflow credentials and host are confirmed.");
  }
  const origin = paynamicsApiBaseUrl();
  if (!origin) throw new Error("Paynamics API calls are disabled until test Workflow credentials and host are confirmed.");
  const suffix = String(path || "").startsWith("/") ? String(path) : `/${String(path || "")}`;
  const response = await fetch(`${origin}${suffix}`, {
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

export function paynamicsCheckoutChannel(value) {
  const method = paynamicsMethodByCode(value);
  if (!method) return null;
  return { code: method.code, pmethod: method.pmethod, pchannel: method.pchannel };
}

export function buildWorkflowCreateBody({
  merchantId,
  merchantKey,
  requestId,
  registration,
  amountCents,
  pmethod,
  pchannel,
  trxType,
}) {
  const phone = formatPhone(registration.mobile);
  const name = splitName(registration.full_name);
  const amount = amountLabel(amountCents);
  const notification = notificationUrl();
  const response = responseUrl(requestId);
  const cancel = cancelUrl();
  const descriptor = optional("PAYNAMICS_DESCRIPTOR", `IBMC 2027 ${registration.reference}`);
  const transaction = {
    request_id: requestId,
    notification_url: notification,
    response_url: response,
    cancel_url: cancel,
    pmethod,
    ...(pchannel != null ? { pchannel } : {}),
    ...(trxType ? { trx_type: trxType } : {}),
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
  const liveWarning = paynamicsLiveRealChargeWarning();
  return {
    requestId: row.request_id,
    status: row.status,
    paymentUrl: allowedPaymentRedirectUrl(row.payment_url),
    gatewayResponseCode: row.gateway_response_code || "",
    gatewayMessage: row.gateway_message || "",
    expiresAt: row.expires_at || "",
    settlementDisabled: !paynamicsSettlementEnabled(),
    checkoutMode: paynamicsCheckoutMode(),
    liveRealChargeWarning: liveWarning,
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
      settleOpeningPayment(db, {
        registrationId: current.registration_id,
        installmentId: current.installment_id,
        amountCents: settlementBaseCents(current),
        method: "paynamics",
        externalReference: current.request_id,
        sessionCreatedAt: current.created_at,
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

function merchantMatches(row, payload) {
  const mid = String(process.env.PAYNAMICS_MERCHANT_ID || "").trim();
  if (!mid) return true;
  const got = String(payload.merchant_id || payload.merchantid || "").trim();
  if (!got) return false;
  return got === mid;
}

function referenceMatches(row, payload) {
  const rid = String(payload?.request_id || "").trim();
  if (!rid) return false;
  return rid === String(row.request_id);
}

function amountMatches(row, payload, { required = false } = {}) {
  if (!payload?.amount) return !required;
  const cents = paynamicsAmountCents(payload.amount);
  if (cents === null) return false;
  return cents === row.amount_cents;
}

function currencyMatches(payload, { required = false } = {}) {
  if (!payload?.currency) return !required;
  return String(payload.currency).toUpperCase() === "PHP";
}

/** Gate for webhook/query payloads — signature and associations must pass before any status change. */
export function assessPaynamicsInboundTrust(row, payload, merchantKey, { requireAmountCurrency = false } = {}) {
  if (!row) return { trusted: false, reason: "missing_row" };
  if (!merchantKey) return { trusted: false, reason: "merchant_key_unconfigured" };
  if (!payload?.signature || !workflowResponseSignatureValid(payload, merchantKey, { requestId: row.request_id })) {
    return { trusted: false, reason: "invalid_signature" };
  }
  if (!merchantMatches(row, payload)) return { trusted: false, reason: "merchant_mismatch" };
  if (!referenceMatches(row, payload)) return { trusted: false, reason: "request_mismatch" };
  const amountPresent = payload?.amount !== undefined && payload?.amount !== null && String(payload.amount).trim() !== "";
  const currencyPresent = payload?.currency !== undefined && payload?.currency !== null && String(payload.currency).trim() !== "";
  if (amountPresent && !amountMatches(row, payload, { required: true })) {
    return { trusted: false, reason: "amount_mismatch" };
  }
  if (currencyPresent && !currencyMatches(payload, { required: true })) {
    return { trusted: false, reason: "currency_mismatch" };
  }
  if (requireAmountCurrency) {
    if (!amountMatches(row, payload, { required: true })) return { trusted: false, reason: "amount_required" };
    if (!currencyMatches(payload, { required: true })) return { trusted: false, reason: "currency_required" };
  }
  return { trusted: true, reason: "" };
}

function quarantinePaynamicsInbound(db, row, payload, reason) {
  const snapshot = {
    reason: String(reason || "untrusted"),
    received_at: new Date().toISOString(),
    response_code: payload?.response_code || null,
    response_message: payload?.response_message || null,
    response_id: payload?.response_id || null,
    amount: payload?.amount ?? null,
    currency: payload?.currency ?? null,
    had_signature: Boolean(payload?.signature),
  };
  db.prepare(`
    UPDATE paynamics_payments
    SET untrusted_inbound_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(snapshot), row.id);
  console.warn(
    `paynamics quarantine request=${row.request_id} reason=${String(reason || "untrusted")} code=${String(payload?.response_code || "")}`,
  );
  return db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(row.id);
}

function paynamicsQueryNestedTransaction(body) {
  if (!body || typeof body !== "object") return null;
  const nested = body.transaction || body.data || body.result;
  if (nested && typeof nested === "object") return nested;
  if (Array.isArray(body.transactions) && body.transactions[0] && typeof body.transactions[0] === "object") {
    return body.transactions[0];
  }
  return null;
}

/** Live query often returns signed QM001 with an inner status row that has no signature. */
function assessPaynamicsQm001Inner(row, outer, nested, merchantKey) {
  const inner = {
    ...parseWorkflowResponse(nested),
    merchant_id: outer.merchant_id || nested.merchant_id || nested.merchantid || "",
  };
  if (inner.signature) {
    const trust = assessPaynamicsInboundTrust(row, inner, merchantKey, { requireAmountCurrency: false });
    return { trusted: trust.trusted, reason: trust.reason, payload: inner };
  }
  if (!referenceMatches(row, inner)) return { trusted: false, reason: "inner_request_mismatch", payload: inner };
  if (!merchantMatches(row, inner)) return { trusted: false, reason: "inner_merchant_mismatch", payload: inner };
  if (inner.amount && !amountMatches(row, inner, { required: true })) {
    return { trusted: false, reason: "inner_amount_mismatch", payload: inner };
  }
  if (inner.currency && !currencyMatches(inner, { required: true })) {
    return { trusted: false, reason: "inner_currency_mismatch", payload: inner };
  }
  return { trusted: true, reason: "qm001_outer_signed_inner_assoc", payload: inner };
}

function enrichPaidPayloadFromRow(row, payload) {
  const next = { ...payload };
  if (paynamicsPaymentOutcome(next.response_code) !== "paid") return next;
  if (!next.amount) next.amount = (row.amount_cents / 100).toFixed(2);
  if (!next.currency) next.currency = "PHP";
  return next;
}

function paynamicsUnitTestSettleAllowed() {
  return process.env.IBMC_PAYNAMICS_UNIT_TEST_ALLOW_SETTLE === "true";
}

function paynamicsMaySettle(allowSettle) {
  if (!allowSettle) return false;
  return paynamicsSettlementEnabled() || paynamicsUnitTestSettleAllowed();
}

export function applyPaynamicsStatus(db, row, payload, { allowSettle = false, requireAmountCurrency = false } = {}) {
  if (!row || row.status === "paid") return row;
  if (!merchantMatches(row, payload)) {
    return savePaynamics(db, row, { status: "failed", gatewayResponseCode: "merchant", gatewayMessage: "merchant_id mismatch" });
  }
  if (!referenceMatches(row, payload)) {
    return savePaynamics(db, row, { status: "failed", gatewayResponseCode: "ref", gatewayMessage: "request_id mismatch" });
  }
  if (!amountMatches(row, payload, { required: requireAmountCurrency })) {
    return savePaynamics(db, row, {
      status: "failed",
      gatewayResponseCode: payload.response_code || "amount",
      gatewayMessage: "amount mismatch",
      gatewayResponseId: payload.response_id || null,
    });
  }
  if (!currencyMatches(payload, { required: requireAmountCurrency })) {
    return savePaynamics(db, row, { status: "failed", gatewayResponseCode: "currency", gatewayMessage: "currency mismatch" });
  }
  const patch = {
    gatewayResponseCode: payload.response_code || row.gateway_response_code,
    gatewayMessage: payload.response_message || row.gateway_message,
    gatewayResponseId: payload.response_id || row.gateway_response_id,
  };
  const outcome = paynamicsPaymentOutcome(payload.response_code);
  if (outcome === "query_ok") {
    return savePaynamics(db, row, { ...patch, status: row.status === "expired" ? "expired" : "pending", gatewayMessage: payload.response_message || "query ok" });
  }
  if (outcome === "paid" && paynamicsMaySettle(allowSettle)) {
    const amountOk = amountMatches(row, payload, { required: true });
    const currencyOk = currencyMatches(payload, { required: true });
    if (!amountOk || !currencyOk) {
      return savePaynamics(db, row, {
        ...patch,
        status: "pending",
        gatewayMessage: !amountOk ? "Paynamics reported paid; waiting for matching amount." : "Paynamics reported paid; waiting for PHP currency.",
      });
    }
    settlePaynamics(db, row);
    return db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(row.id);
  }
  if (outcome === "failed") return savePaynamics(db, row, { ...patch, status: "failed" });
  if (outcome === "pending") return savePaynamics(db, row, { ...patch, status: "pending" });
  return savePaynamics(db, row, patch);
}

function resolveInnerQueryPayload(body) {
  const outer = parseWorkflowResponse(body);
  if (outer.response_code !== "QM001") return outer;
  const nested = paynamicsQueryNestedTransaction(body);
  if (nested) {
    return { ...parseWorkflowResponse(nested), merchant_id: outer.merchant_id || nested.merchant_id || nested.merchantid };
  }
  return outer;
}

/** Query responses wrap status in QM001 + signed inner transaction, or return a signed row matching org_trxid2. */
export function assessPaynamicsQueryBody(row, body, merchantKey) {
  const outer = parseWorkflowResponse(body);
  if (!workflowResponseSignatureValid(outer, merchantKey)) {
    return { trusted: false, reason: "invalid_query_signature", payload: outer };
  }
  if (String(outer.response_code || "").trim().toUpperCase() !== "QM001") {
    const trust = assessPaynamicsInboundTrust(row, outer, merchantKey, { requireAmountCurrency: false });
    return { trusted: trust.trusted, reason: trust.reason, payload: outer };
  }
  const nested = paynamicsQueryNestedTransaction(body);
  if (!nested) {
    return { trusted: false, reason: "missing_inner_transaction", payload: outer };
  }
  const trust = assessPaynamicsQm001Inner(row, outer, nested, merchantKey);
  return { trusted: trust.trusted, reason: trust.reason, payload: trust.payload };
}

async function queryWorkflowStatus(row) {
  if (!paynamicsApiCallsAllowed()) return null;
  const merchantId = String(process.env.PAYNAMICS_MERCHANT_ID || "").trim();
  const merchantKey = String(process.env.PAYNAMICS_MERCHANT_KEY || "").trim();
  const queryRequestId = `Q${crypto.randomBytes(10).toString("hex")}`.slice(0, 32);
  const signature = paynamicsQuerySignature(queryRequestId, row.request_id, merchantId, merchantKey);
  try {
    return await paynamicsApiFetch("/paygate/transactions/query", {
      merchant_id: merchantId,
      request_id: queryRequestId,
      org_trxid2: row.request_id,
      signature,
    });
  } catch {
    return null;
  }
}

export async function startPaynamicsPayment(db, registration, pchannel) {
  const selection = paynamicsCheckoutChannel(pchannel);
  if (!selection) return { error: "Choose a Paynamics option.", status: 400, registration };
  if (!isChannelEnabled(db, "paynamics")) return { error: "That payment option is turned off.", status: 400, registration };
  if (!isPaynamicsMethodEnabled(db, selection.code)) return { error: "That Paynamics option is turned off.", status: 400, registration };
  if (registration.currency !== "PHP") return { error: "Paynamics collects peso payments.", status: 400, registration };
  const held = refreshHeldRegistration(db, registration);
  registration = held.registration;
  if (!registration) return { error: "Registration not found", status: 404 };
  if (held.decision === "closed") return { error: "Registration is not payable", status: 400, registration };
  if (!paynamicsApiCallsAllowed()) {
    return {
      error: "Paynamics checkout is not enabled until test Workflow credentials and host are confirmed.",
      status: 503,
      registration,
    };
  }
  const due = dueInstallment(registration);
  const baseCents = due ? due.amount_cents - due.amount_paid_cents : 0;
  const quote = paymentCharge(db, registration, baseCents, { channel: "paynamics", method: selection.code });
  if (!due || quote.baseCents <= 0) return { registration, paynamics: null };
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
      const sameMethod = String(open.payment_channel || "") === selection.code;
      const sameCharge = open.amount_cents === quote.totalCents && (open.fee_cents || 0) === quote.feeCents;
      const stillOpen = sameMethod && sameCharge && (!Number.isFinite(expires) || Date.now() < expires);
      const startedInTime = held.decision !== "expired" || sessionStartedBeforeHold(registration, open.created_at);
      if (stillOpen && startedInTime) {
        return view(db, registration, open);
      }
      if (held.decision === "expired") {
        return { error: HOLD_EXPIRED_MESSAGE, status: 400, registration };
      }
      db.prepare(`
        UPDATE paynamics_payments SET status = 'expired', updated_at = datetime('now')
        WHERE id = ? AND status = 'pending'
      `).run(open.id);
    }
    if (held.decision === "expired") {
      return { error: HOLD_EXPIRED_MESSAGE, status: 400, registration };
    }
    const merchantId = required("PAYNAMICS_MERCHANT_ID");
    const merchantKey = required("PAYNAMICS_MERCHANT_KEY");
    const requestId = crypto.randomBytes(12).toString("hex");
    const createBody = buildWorkflowCreateBody({
      merchantId,
      merchantKey,
      requestId,
      registration,
      amountCents: quote.totalCents,
      pmethod: selection.pmethod,
      pchannel: selection.pchannel,
      trxType: paynamicsMethodByCode(selection.code)?.trxType || "",
    });
    let created;
    try {
      created = await paynamicsApiFetch("/paygate/transactions/", createBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Paynamics could not start the payment.";
      return { error: message, status: 502, registration };
    }
    const response = parseWorkflowResponse(created.body);
    const signed = workflowResponseSignatureValid(response, merchantKey, { requestId });
    const paymentUrl = signed ? extractHostedPaymentUrl(created.body) : "";
    const failed = !created.ok || !signed || !paymentUrl;
    const insert = db.prepare(`
      INSERT INTO paynamics_payments (
        registration_id, installment_id, request_id, gateway_response_id, amount_cents, fee_cents, currency, status,
        gateway_response_code, gateway_message, payment_channel, payment_url, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PHP', ?, ?, ?, ?, ?, ?)
    `);
    const result = insert.run(
      registration.id,
      due.id,
      requestId,
      response.response_id || null,
      quote.totalCents,
      quote.feeCents,
      failed ? "failed" : "pending",
      response.response_code || (failed ? "create_failed" : null),
      response.response_message || (failed ? "unsigned/invalid hosted link" : null),
      selection.code,
      paymentUrl || null,
      expiresAt(),
    );
    const saved = db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(result.lastInsertRowid);
    if (failed) {
      return {
        error: response.response_message || "Paynamics did not return a verified hosted payment link.",
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
  expireRegistrationHold(db, row.registration_id);
  let current = row;
  const expires = Date.parse(current.expires_at || "");
  if (current.status === "pending" && Number.isFinite(expires) && Date.now() >= expires) {
    current = savePaynamics(db, current, { status: "expired", gatewayMessage: "checkout expired" });
  }
  if (current.status === "pending" && paynamicsApiCallsAllowed()) {
    const merchantKey = String(process.env.PAYNAMICS_MERCHANT_KEY || "").trim();
    const remote = await queryWorkflowStatus(current);
    if (remote?.body) {
      const assessed = assessPaynamicsQueryBody(current, remote.body, merchantKey);
      if (assessed.trusted) {
        const payload = enrichPaidPayloadFromRow(current, assessed.payload);
        current = applyPaynamicsStatus(db, current, payload, { allowSettle: true, requireAmountCurrency: false }) || current;
      } else {
        const payload = resolveInnerQueryPayload(remote.body);
        quarantinePaynamicsInbound(db, current, payload, assessed.reason);
      }
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
  try {
    const merchantKey = String(process.env.PAYNAMICS_MERCHANT_KEY || "").trim();
    const trust = assessPaynamicsInboundTrust(row, payload, merchantKey, { requireAmountCurrency: false });
    if (!trust.trusted) {
      quarantinePaynamicsInbound(db, row, payload, trust.reason);
      return { status: 200, body: "OK" };
    }
    applyPaynamicsStatus(db, row, enrichPaidPayloadFromRow(row, payload), { allowSettle: true, requireAmountCurrency: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("No installment is due") || message.includes("not payable")) {
      return { status: 200, body: "OK" };
    }
    console.error(message || error);
    reportError(error);
    return { status: 500, body: "error" };
  }
  return { status: 200, body: "OK" };
}

// Back-compat alias for older tests/imports
export const paynamicsOutcome = paynamicsPaymentOutcome;

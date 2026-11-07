import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./db.js";
import { createRegistration } from "./registrations.js";
import {
  allowedPaymentRedirectUrl,
  applyPaynamicsStatus,
  assessPaynamicsApiAdmission,
  assessPaynamicsInboundTrust,
  assessPaynamicsQueryBody,
  assessStagingLiveDeploymentIdentity,
  buildWorkflowCreateBody,
  canonicalPaynamicsApiOrigin,
  extractHostedPaymentUrl,
  handlePaynamicsNotification,
  ibmcProductionDeployment,
  ibmcStagingDeployment,
  paynamicsApiCallsAllowed,
  paynamicsCheckoutChannel,
  paynamicsCheckoutMode,
  paynamicsPublicCheckoutInfo,
  paynamicsCustomerSignature,
  paynamicsPaymentOutcome,
  paynamicsQuerySignature,
  paynamicsSettlementEnabled,
  paynamicsTransactionSignature,
  paynamicsWorkflowResponseSignature,
  parseNotificationPayload,
  refreshPaynamicsPayment,
  startPaynamicsPayment,
  workflowResponseSignatureValid,
} from "./paynamics.js";
import { listPaymentChannels } from "./payment-channels.js";

const TEST_KEY = "test_merchant_key_only_for_ci";
const TEST_MID = "TESTMID";
const originalFetch = global.fetch;

process.env.IBMC_PAYNAMICS_UNIT_TEST_ALLOW_SETTLE = "true";

delete process.env.PAYNAMICS_API_CALLS_ENABLED;
delete process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED;
process.env.PAYNAMICS_MERCHANT_ID = TEST_MID;
process.env.PAYNAMICS_MERCHANT_KEY = TEST_KEY;
process.env.PUBLIC_WEB_URL = "https://staging.example.test";
process.env.SITE_URL = "https://staging.example.test";

assert.equal(paynamicsApiCallsAllowed(), false);
assert.equal(paynamicsSettlementEnabled(), false);
process.env.PAYNAMICS_API_CALLS_ENABLED = "true";
process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED = "true";
process.env.PAYNAMICS_API_BASE_URL = "https://payin.payserv.net";
process.env.PAYNAMICS_API_ENV = "sandbox";
process.env.PAYNAMICS_BASIC_AUTH_USER = "workflow_user";
process.env.PAYNAMICS_BASIC_AUTH_PASSWORD = "workflow_pass";
process.env.IBMC_DEPLOYMENT_ENV = "staging";
assert.equal(paynamicsSettlementEnabled(), true);
delete process.env.PAYNAMICS_API_CALLS_ENABLED;
delete process.env.IBMC_DEPLOYMENT_ENV;
const publicCheckout = paynamicsPublicCheckoutInfo();
assert.equal(publicCheckout.apiAdmissionAllowed, false);
assert.equal(typeof publicCheckout.apiAdmissionReason, "string");
assert.equal(JSON.stringify(publicCheckout).includes(TEST_KEY), false);

const tx = {
  request_id: "req123",
  notification_url: "https://staging.example.test/api/webhooks/paynamics",
  response_url: "https://staging.example.test/register?paynamicsRequest=req123",
  cancel_url: "https://staging.example.test/register",
  pmethod: "wallet",
  payment_action: "url_link",
  schedule: "",
  collection_method: "single_pay",
  deferred_period: "",
  deferred_time: "",
  dp_balance_info: "",
  amount: "50.00",
  currency: "PHP",
  descriptor_note: "IBMC",
  payment_notification_status: "1",
  payment_notification_channel: "1",
};
assert.equal(paynamicsTransactionSignature(tx, TEST_MID, TEST_KEY).length, 128);
assert.equal(
  paynamicsCustomerSignature({ fname: "A", lname: "B", mname: "", email: "a@example.com", phone: "+63917", mobile: "+63917", dob: "" }, TEST_KEY).length,
  128,
);
assert.equal(paynamicsQuerySignature("Q1", "req123", TEST_MID, TEST_KEY).length, 128);
assert.equal(paynamicsPaymentOutcome("GR001"), "paid");
assert.equal(paynamicsPaymentOutcome("GR033"), "pending");
assert.equal(paynamicsPaymentOutcome("QM001"), "query_ok");

assert.equal(allowedPaymentRedirectUrl("https://payin.payserv.net/hosted/abc"), "https://payin.payserv.net/hosted/abc");
assert.equal(allowedPaymentRedirectUrl("https://evil.example/phish"), "");
assert.equal(extractHostedPaymentUrl({ payment_action_info: "https://payin.payserv.net/x" }), "https://payin.payserv.net/x");
assert.equal(extractHostedPaymentUrl({ redirect_url: "https://payin.payserv.net/x" }), "");

function signedCreateResponse(requestId, overrides = {}) {
  const body = {
    merchant_id: TEST_MID,
    request_id: requestId,
    response_id: "RSP_CREATE",
    gateway_id: "",
    response_code: "GR033",
    response_message: "Pending",
    response_advise: "",
    timestamp: "2026-11-07T10:00:00.000+08:00",
    processor_response_id: "",
    processor_response_authcode: "",
    pay_reference: "",
    payment_action_info: "https://payin.payserv.net/hosted/checkout",
    ...overrides,
  };
  body.signature = paynamicsWorkflowResponseSignature(body, TEST_KEY);
  return body;
}

const db = openDatabase(":memory:");
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();
db.prepare("UPDATE payment_channels SET enabled = 1 WHERE code = 'paynamics'").run();
assert.ok(listPaymentChannels(db).some((item) => item.code === "paynamics" && item.enabled));

const registration = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Paynamics Tester",
  email: "paynamics@example.com",
  mobile: "09171234567",
  registeredOn: "2026-11-12",
});

assert.equal(paynamicsCheckoutChannel("gc"), null);
assert.equal(paynamicsCheckoutChannel("wallet"), null);
assert.deepEqual(paynamicsCheckoutChannel("paymaya_ph"), { pmethod: "wallet", pchannel: "paymaya_ph" });
assert.deepEqual(paynamicsCheckoutChannel("bpi_online"), { pmethod: "onlinebanktransfer", pchannel: "bpi_online" });
assert.equal((await startPaynamicsPayment(db, registration, "paymaya_ph")).status, 503);

process.env.PAYNAMICS_BASIC_AUTH_USER = "workflow_user";
process.env.PAYNAMICS_BASIC_AUTH_PASSWORD = "workflow_pass";
process.env.PAYNAMICS_API_BASE_URL = "https://payin.payserv.net";
process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED = "true";
process.env.PAYNAMICS_API_CALLS_ENABLED = "true";
process.env.PAYNAMICS_API_ENV = "sandbox";

assert.equal(paynamicsApiCallsAllowed(), true);

process.env.PAYNAMICS_ALLOW_PRODUCTION = "true";
process.env.PAYNAMICS_API_ENV = "production";
assert.equal(paynamicsApiCallsAllowed(), false);

process.env.PAYNAMICS_API_ENV = "sandbox";
process.env.PAYNAMICS_API_BASE_URL = "https://paynamics.example.com";
assert.equal(paynamicsApiCallsAllowed(), false);

process.env.PAYNAMICS_API_BASE_URL = "http://payin.payserv.net";
assert.equal(paynamicsApiCallsAllowed(), false);

process.env.PAYNAMICS_API_BASE_URL = "https://payin.payserv.net";
process.env.PAYNAMICS_ALLOW_PRODUCTION = "true";
assert.equal(paynamicsApiCallsAllowed(), true);

process.env.PAYNAMICS_ALLOW_PRODUCTION = "";
delete process.env.PAYNAMICS_ALLOW_PRODUCTION;
assert.equal(paynamicsApiCallsAllowed(), true);

function clearRailwayEnv() {
  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_SERVICE_ID;
}

function setLiveStagingEnv(baseOrigin) {
  clearRailwayEnv();
  delete process.env.IBMC_DEPLOYMENT_ENV;
  delete process.env.PAYNAMICS_STAGING_LIVE_MERCHANT;
  delete process.env.PAYNAMICS_API_LIVE_ACCOUNT_CONFIRMED;
  delete process.env.PAYNAMICS_LIVE_API_ORIGIN_ALLOWLIST;
  process.env.IBMC_DEPLOYMENT_ENV = "staging";
  process.env.RAILWAY_ENVIRONMENT = "staging";
  process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
  process.env.PAYNAMICS_API_ENV = "live";
  process.env.PAYNAMICS_STAGING_LIVE_MERCHANT = "true";
  process.env.PAYNAMICS_API_LIVE_ACCOUNT_CONFIRMED = "true";
  process.env.PAYNAMICS_LIVE_API_ORIGIN_ALLOWLIST = baseOrigin;
  process.env.PAYNAMICS_API_BASE_URL = baseOrigin;
  process.env.PAYNAMICS_API_CALLS_ENABLED = "true";
  process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED = "true";
}

assert.equal(ibmcStagingDeployment(), false);
setLiveStagingEnv("https://live-workflow.example.test");
assert.equal(assessPaynamicsApiAdmission().allowed, true);
assert.equal(paynamicsCheckoutMode(), "live");

process.env.IBMC_DEPLOYMENT_ENV = "staging";
process.env.RAILWAY_ENVIRONMENT = "production";
process.env.RAILWAY_ENVIRONMENT_NAME = "production";
assert.equal(assessPaynamicsApiAdmission().allowed, false);
assert.equal(assessPaynamicsApiAdmission().reason, "railway_production_environment");
assert.equal(JSON.stringify(assessPaynamicsApiAdmission()).includes("secret"), false);

process.env.IBMC_DEPLOYMENT_ENV = "production";
assert.equal(ibmcProductionDeployment(), true);
assert.equal(assessPaynamicsApiAdmission().allowed, false);

clearRailwayEnv();
process.env.IBMC_DEPLOYMENT_ENV = "staging";
setLiveStagingEnv("https://live-workflow.example.test");

process.env.RAILWAY_ENVIRONMENT = "staging";
process.env.RAILWAY_ENVIRONMENT_NAME = "production";
assert.equal(assessStagingLiveDeploymentIdentity().allowed, false);
assert.equal(assessStagingLiveDeploymentIdentity().reason, "railway_identity_conflicting");

process.env.RAILWAY_ENVIRONMENT = "qa-unknown";
process.env.RAILWAY_ENVIRONMENT_NAME = "qa-unknown";
assert.equal(assessStagingLiveDeploymentIdentity().allowed, false);
assert.equal(assessStagingLiveDeploymentIdentity().reason, "railway_identity_unknown");

process.env.RAILWAY_PROJECT_ID = "proj";
delete process.env.RAILWAY_ENVIRONMENT;
delete process.env.RAILWAY_ENVIRONMENT_NAME;
assert.equal(assessStagingLiveDeploymentIdentity().allowed, false);
assert.equal(assessStagingLiveDeploymentIdentity().reason, "railway_identity_missing");

process.env.IBMC_DEPLOYMENT_ENV = "staging";
process.env.RAILWAY_ENVIRONMENT = "staging";
process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
process.env.PAYNAMICS_API_BASE_URL = "https://arbitrary.evil.test";
assert.equal(assessPaynamicsApiAdmission().allowed, false);
assert.equal(assessPaynamicsApiAdmission().reason, "live_origin_not_allowlisted");

delete process.env.PAYNAMICS_STAGING_LIVE_MERCHANT;
process.env.PAYNAMICS_API_BASE_URL = "https://live-workflow.example.test";
assert.equal(assessPaynamicsApiAdmission().allowed, false);

assert.equal(canonicalPaynamicsApiOrigin("https://user:pass@payin.payserv.net").ok, false);
assert.equal(canonicalPaynamicsApiOrigin("https://payin.payserv.net/evil").ok, false);
assert.equal(canonicalPaynamicsApiOrigin("https://payin.payserv.net?x=1").ok, false);
assert.equal(canonicalPaynamicsApiOrigin("https://payin.payserv.net#frag").ok, false);
process.env.PAYNAMICS_API_BASE_URL = "https://leak:secret@payin.payserv.net";
process.env.PAYNAMICS_API_ENV = "sandbox";
assert.equal(assessPaynamicsApiAdmission().allowed, false);
assert.equal(assessPaynamicsApiAdmission().reason, "api_base_userinfo");
assert.equal(JSON.stringify(assessPaynamicsApiAdmission()).includes("secret"), false);

process.env.PAYNAMICS_API_ENV = "sandbox";
process.env.PAYNAMICS_API_BASE_URL = "https://payin.payserv.net";
clearRailwayEnv();
delete process.env.IBMC_DEPLOYMENT_ENV;
delete process.env.PAYNAMICS_STAGING_LIVE_MERCHANT;
delete process.env.PAYNAMICS_API_LIVE_ACCOUNT_CONFIRMED;
delete process.env.PAYNAMICS_LIVE_API_ORIGIN_ALLOWLIST;
assert.equal(paynamicsApiCallsAllowed(), true);
assert.equal(paynamicsCheckoutMode(), "sandbox");

let fetchTarget = "";

global.fetch = async (url, options = {}) => {
  const target = String(url);
  fetchTarget = target;
  assert.equal(target.includes("@"), false);
  if (target.includes("/paygate/transactions/") && !target.includes("/query")) {
    const payload = JSON.parse(options.body || "{}");
    assert.equal(options.headers.Authorization.startsWith("Basic "), true);
    assert.equal(payload.transaction.pmethod, "wallet");
    assert.equal(payload.transaction.pchannel, "paymaya_ph");
    const requestId = payload.transaction.request_id;
    return { ok: true, status: 200, json: async () => signedCreateResponse(requestId) };
  }
  if (target.includes("/paygate/transactions/query")) {
    const req = JSON.parse(options.body || "{}");
    assert.equal(req.merchant_id, TEST_MID);
    return {
      ok: true,
      status: 200,
      json: async () => signedCreateResponse(req.org_trxid2, {
        response_code: "QM001",
        response_message: "Query Successful",
      }),
    };
  }
  throw new Error(`unexpected fetch ${target}`);
};

const rejectedMethod = await startPaynamicsPayment(db, registration, "creditcard");
assert.equal(rejectedMethod.status, 400);
assert.equal(rejectedMethod.error, "Choose a Paynamics option.");
const started = await startPaynamicsPayment(db, registration, "paymaya_ph");
assert.equal(started.paynamics?.status, "pending");
assert.equal(fetchTarget.startsWith("https://payin.payserv.net/"), true);
assert.equal(started.paynamics?.paymentUrl, "https://payin.payserv.net/hosted/checkout");

const row = db.prepare("SELECT * FROM paynamics_payments WHERE request_id = ?").get(started.paynamics.requestId);
const amountLabel = (row.amount_cents / 100).toFixed(2);

const refreshed = await refreshPaynamicsPayment(db, row.request_id);
assert.equal(refreshed.paynamics?.status, "pending");

const pendingNotice = await handlePaynamicsNotification(db, {
  merchant_id: TEST_MID,
  request_id: row.request_id,
  response_id: "NTF1",
  response_code: "GR033",
  response_message: "pending",
  amount: amountLabel,
  currency: "PHP",
  signature: paynamicsWorkflowResponseSignature({
    merchant_id: TEST_MID,
    request_id: row.request_id,
    response_id: "NTF1",
    gateway_id: "",
    response_code: "GR033",
    response_message: "pending",
    response_advise: "",
    timestamp: "2026-11-07T10:01:00.000+08:00",
    processor_response_id: "",
    processor_response_authcode: "",
    pay_reference: "",
  }, TEST_KEY),
});
assert.equal(pendingNotice.status, 200);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(row.request_id).count, 0);

const beforeMismatch = db.prepare("SELECT status, gateway_response_code FROM paynamics_payments WHERE id = ?").get(row.id);
const mismatch = await handlePaynamicsNotification(db, {
  merchant_id: TEST_MID,
  request_id: row.request_id,
  response_code: "GR001",
  response_message: "paid",
  amount: "0.01",
  currency: "PHP",
});
assert.equal(mismatch.status, 200);
const afterMismatch = db.prepare("SELECT status, gateway_response_code, untrusted_inbound_json FROM paynamics_payments WHERE id = ?").get(row.id);
assert.equal(afterMismatch.status, beforeMismatch.status);
assert.equal(afterMismatch.gateway_response_code, beforeMismatch.gateway_response_code);
assert.ok(afterMismatch.untrusted_inbound_json);

const unsignedFailed = await handlePaynamicsNotification(db, {
  merchant_id: TEST_MID,
  request_id: row.request_id,
  response_code: "GR003",
  response_message: "failed",
  amount: amountLabel,
  currency: "PHP",
});
assert.equal(unsignedFailed.status, 200);
assert.equal(db.prepare("SELECT status FROM paynamics_payments WHERE id = ?").get(row.id).status, "pending");

const fixedRow = db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(row.id);

const unverifiedPaid = await handlePaynamicsNotification(db, {
  merchant_id: TEST_MID,
  request_id: fixedRow.request_id,
  response_code: "GR001",
  response_message: "paid",
  amount: amountLabel,
  currency: "PHP",
});
assert.equal(unverifiedPaid.status, 200);
assert.equal(db.prepare("SELECT status FROM paynamics_payments WHERE id = ?").get(fixedRow.id).status, "pending");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(fixedRow.request_id).count, 0);

process.env.PAYNAMICS_API_CALLS_ENABLED = "true";
process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED = "true";
process.env.PAYNAMICS_API_BASE_URL = "https://payin.payserv.net";
process.env.PAYNAMICS_API_ENV = "sandbox";
process.env.PAYNAMICS_BASIC_AUTH_USER = "workflow_user";
process.env.PAYNAMICS_BASIC_AUTH_PASSWORD = "workflow_pass";
process.env.IBMC_DEPLOYMENT_ENV = "staging";

const nested = parseNotificationPayload({
  transaction: {
    merchant_id: TEST_MID,
    request_id: fixedRow.request_id,
    response_code: "GR033",
  },
});
assert.equal(nested.request_id, fixedRow.request_id);

const verifiedPaidSig = {
  merchant_id: TEST_MID,
  request_id: fixedRow.request_id,
  response_id: "NTF2",
  gateway_id: "",
  response_code: "GR001",
  response_message: "paid",
  response_advise: "",
  timestamp: "2026-11-07T10:02:00.000+08:00",
  processor_response_id: "",
  processor_response_authcode: "",
  pay_reference: "",
};
const verifiedPaidBody = {
  ...verifiedPaidSig,
  amount: amountLabel,
  currency: "PHP",
  signature: paynamicsWorkflowResponseSignature(verifiedPaidSig, TEST_KEY),
};
const verifiedPaidTrust = assessPaynamicsInboundTrust(fixedRow, verifiedPaidBody, TEST_KEY, { requireAmountCurrency: false });
assert.equal(verifiedPaidTrust.trusted, true, verifiedPaidTrust.reason);
const verifiedPaid = await handlePaynamicsNotification(db, verifiedPaidBody);
assert.equal(verifiedPaid.status, 200);
assert.equal(db.prepare("SELECT status FROM paynamics_payments WHERE id = ?").get(fixedRow.id).status, "paid");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(fixedRow.request_id).count, 1);

const paidInner = {
  merchant_id: TEST_MID,
  request_id: fixedRow.request_id,
  response_id: "INNER1",
  gateway_id: "",
  response_code: "GR001",
  response_message: "paid",
  response_advise: "",
  timestamp: "2026-11-07T10:03:00.000+08:00",
  processor_response_id: "",
  processor_response_authcode: "",
  pay_reference: "",
  amount: amountLabel,
  currency: "PHP",
};
paidInner.signature = paynamicsWorkflowResponseSignature(paidInner, TEST_KEY);
const queryOuter = {
  merchant_id: TEST_MID,
  request_id: "QINNER",
  response_id: "QOUT2",
  gateway_id: "",
  response_code: "QM001",
  response_message: "Query Successful",
  response_advise: "",
  timestamp: "2026-11-07T10:03:00.000+08:00",
  processor_response_id: "",
  processor_response_authcode: "",
  pay_reference: "",
};
queryOuter.signature = paynamicsWorkflowResponseSignature(queryOuter, TEST_KEY);
const queryTrust = assessPaynamicsQueryBody(fixedRow, { ...queryOuter, transaction: paidInner }, TEST_KEY);
assert.equal(queryTrust.trusted, true);
assert.equal(queryTrust.payload.response_code, "GR001");

let queryMode = "default";
const defaultFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes("/paygate/transactions/query") && queryMode === "unsigned_inner_gr003") {
    const req = JSON.parse(options.body || "{}");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        merchant_id: TEST_MID,
        request_id: "QFAKE",
        response_code: "QM001",
        response_message: "Query Successful",
        response_id: "QOUT",
        gateway_id: "",
        response_advise: "",
        timestamp: "2026-11-07T10:00:00.000+08:00",
        processor_response_id: "",
        processor_response_authcode: "",
        pay_reference: "",
        signature: paynamicsWorkflowResponseSignature({
          merchant_id: TEST_MID,
          request_id: "QFAKE",
          response_id: "QOUT",
          gateway_id: "",
          response_code: "QM001",
          response_message: "Query Successful",
          response_advise: "",
          timestamp: "2026-11-07T10:00:00.000+08:00",
          processor_response_id: "",
          processor_response_authcode: "",
          pay_reference: "",
        }, TEST_KEY),
        transaction: {
          merchant_id: TEST_MID,
          request_id: req.org_trxid2,
          response_code: "GR003",
          response_message: "failed",
          amount: amountLabel,
          currency: "PHP",
        },
      }),
    };
  }
  return defaultFetch(url, options);
};
queryMode = "unsigned_inner_gr003";
const probeRegistration = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Probe Settle",
  email: "probe-settle@example.com",
  mobile: "09171234568",
  registeredOn: "2026-11-12",
});
const probeInstallment = db.prepare(`
  SELECT id, amount_cents FROM registration_installments
  WHERE registration_id = ? AND status = 'due' ORDER BY sequence LIMIT 1
`).get(probeRegistration.id);
const probeAmountLabel = (probeInstallment.amount_cents / 100).toFixed(2);
const settleProbe = db.prepare(`
  INSERT INTO paynamics_payments (
    registration_id, installment_id, request_id, amount_cents, currency, status, expires_at, payment_url
  ) VALUES (?, ?, ?, ?, 'PHP', 'pending', datetime('now', '+1 hour'), 'https://payin.payserv.net/hosted/probe')
`).run(probeRegistration.id, probeInstallment.id, `probe${crypto.randomBytes(6).toString("hex")}`, probeInstallment.amount_cents);
const probeRow = db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(settleProbe.lastInsertRowid);
const beforeRefresh = db.prepare("SELECT status FROM paynamics_payments WHERE id = ?").get(probeRow.id).status;
const badRefresh = await refreshPaynamicsPayment(db, probeRow.request_id);
assert.equal(badRefresh.paynamics?.status, beforeRefresh);
assert.equal(db.prepare("SELECT status FROM paynamics_payments WHERE id = ?").get(probeRow.id).status, "pending");
queryMode = "default";
global.fetch = defaultFetch;

delete process.env.PAYNAMICS_API_CALLS_ENABLED;
const apiOffRefresh = await refreshPaynamicsPayment(db, probeRow.request_id);
assert.equal(apiOffRefresh.paynamics?.status, "pending");
process.env.PAYNAMICS_API_CALLS_ENABLED = "true";

const settleGate = db.prepare(`
  INSERT INTO paynamics_payments (
    registration_id, installment_id, request_id, amount_cents, currency, status, expires_at, payment_url
  ) VALUES (?, ?, ?, ?, 'PHP', 'pending', datetime('now', '+1 hour'), 'https://payin.payserv.net/hosted/gate')
`).run(probeRegistration.id, probeInstallment.id, `gate${crypto.randomBytes(6).toString("hex")}`, probeInstallment.amount_cents);
const settleGateRow = db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(settleGate.lastInsertRowid);

process.env.PAYNAMICS_SETTLEMENT_ENABLED = "false";
delete process.env.IBMC_PAYNAMICS_UNIT_TEST_ALLOW_SETTLE;
applyPaynamicsStatus(db, settleGateRow, {
  merchant_id: TEST_MID,
  request_id: settleGateRow.request_id,
  response_code: "GR001",
  amount: probeAmountLabel,
  currency: "PHP",
}, { allowSettle: true });
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(settleGateRow.request_id).count, 0);
delete process.env.PAYNAMICS_SETTLEMENT_ENABLED;
process.env.IBMC_PAYNAMICS_UNIT_TEST_ALLOW_SETTLE = "true";

const settled = applyPaynamicsStatus(db, settleGateRow, {
  merchant_id: TEST_MID,
  request_id: settleGateRow.request_id,
  response_code: "GR001",
  amount: probeAmountLabel,
  currency: "PHP",
}, { allowSettle: true });
assert.equal(settled.status, "paid");
applyPaynamicsStatus(db, settled, {
  merchant_id: TEST_MID,
  request_id: settleGateRow.request_id,
  response_code: "GR001",
  amount: probeAmountLabel,
  currency: "PHP",
}, { allowSettle: true });
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(settleGateRow.request_id).count, 1);

assert.equal(workflowResponseSignatureValid(signedCreateResponse("x"), TEST_KEY, { requestId: "x" }), true);
assert.equal(parseNotificationPayload({ request_id: "abc", response_code: "GR033" }).request_id, "abc");

global.fetch = originalFetch;

function seedHttpPaynamicsRow(fileDb) {
  fileDb.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();
  fileDb.prepare("UPDATE payment_channels SET enabled = 1 WHERE code = 'paynamics'").run();
  const reg = createRegistration(fileDb, {
    productCode: "first_mover",
    paymentPlan: "full",
    fullName: "HTTP QA",
    email: "http-qa@example.com",
    mobile: "09170000001",
    registeredOn: "2026-11-12",
  });
  const installment = fileDb.prepare(`
    SELECT id, amount_cents FROM registration_installments
    WHERE registration_id = ? AND status = 'due' ORDER BY sequence LIMIT 1
  `).get(reg.id);
  const requestId = `qa${crypto.randomBytes(8).toString("hex")}`;
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  fileDb.prepare(`
    INSERT INTO paynamics_payments (
      registration_id, installment_id, request_id, amount_cents, currency, status, expires_at, payment_url
    ) VALUES (?, ?, ?, ?, 'PHP', 'pending', ?, 'https://payin.payserv.net/hosted/qa')
  `).run(reg.id, installment.id, requestId, installment.amount_cents, expires);
  return { requestId, amountLabel: (installment.amount_cents / 100).toFixed(2) };
}

const file = path.join(os.tmpdir(), `ibmc-verify-paynamics-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
process.env.IBMC_DB_PATH = file;
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";
process.env.PAYNAMICS_MERCHANT_ID = TEST_MID;
process.env.PAYNAMICS_MERCHANT_KEY = TEST_KEY;
process.env.PUBLIC_WEB_URL = "https://staging.example.test";
process.env.SITE_URL = "https://staging.example.test";
const fileDb = openDatabase(file);
const httpSeed = seedHttpPaynamicsRow(fileDb);

const { createApi } = await import("./api.js");

const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const missingId = await fetch(`${base}/api/webhooks/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_code: "GR001" }),
  });
  assert.equal(missingId.status, 400);

  async function postWebhook(body) {
    return fetch(`${base}/api/webhooks/paynamics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function rowState() {
    return fileDb.prepare("SELECT status, gateway_response_code, untrusted_inbound_json FROM paynamics_payments WHERE request_id = ?").get(httpSeed.requestId);
  }

  const baseline = rowState();
  assert.equal(baseline.status, "pending");

  process.env.IBMC_STAGING_SAFE_MODE = "true";
  delete process.env.PAYNAMICS_API_CALLS_ENABLED;
  fileDb.prepare("UPDATE payment_channels SET enabled = 0 WHERE code = 'paynamics'").run();

  let res = await postWebhook({
    merchant_id: TEST_MID,
    request_id: httpSeed.requestId,
    response_code: "GR001",
    response_message: "paid",
    amount: "0.01",
    currency: "PHP",
  });
  assert.equal(res.status, 200);
  let state = rowState();
  assert.equal(state.status, "pending");
  assert.equal(state.gateway_response_code, baseline.gateway_response_code);
  assert.ok(state.untrusted_inbound_json);

  res = await postWebhook({
    merchant_id: TEST_MID,
    request_id: httpSeed.requestId,
    response_code: "GR003",
    response_message: "failed",
    amount: httpSeed.amountLabel,
    currency: "PHP",
  });
  assert.equal(res.status, 200);
  state = rowState();
  assert.equal(state.status, "pending");

  const badSigBody = signedCreateResponse(httpSeed.requestId, {
    response_code: "GR003",
    response_message: "failed",
    amount: httpSeed.amountLabel,
    currency: "PHP",
  });
  badSigBody.signature = "f".repeat(128);
  res = await postWebhook(badSigBody);
  assert.equal(res.status, 200);
  assert.equal(rowState().status, "pending");

  process.env.PAYNAMICS_API_CALLS_ENABLED = "true";
  process.env.PAYNAMICS_BASIC_AUTH_USER = "workflow_user";
  process.env.PAYNAMICS_BASIC_AUTH_PASSWORD = "workflow_pass";
  process.env.PAYNAMICS_API_BASE_URL = "https://payin.payserv.net";
  process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED = "true";
  process.env.PAYNAMICS_API_ENV = "sandbox";

  let refreshCalls = 0;
  const httpFetch = global.fetch;
  global.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("/paygate/transactions/query")) {
      refreshCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          merchant_id: TEST_MID,
          request_id: httpSeed.requestId,
          response_code: "GR003",
          response_message: "failed",
          amount: httpSeed.amountLabel,
          currency: "PHP",
        }),
      };
    }
    return httpFetch(url, init);
  };
  const poll = await fetch(`${base}/api/payments/paynamics/${httpSeed.requestId}`);
  assert.equal(poll.status, 200);
  assert.equal(refreshCalls, 1);
  assert.equal(rowState().status, "pending");

  delete process.env.PAYNAMICS_API_CALLS_ENABLED;
  refreshCalls = 0;
  const pollOff = await fetch(`${base}/api/payments/paynamics/${httpSeed.requestId}`);
  assert.equal(pollOff.status, 200);
  assert.equal(refreshCalls, 0);
  assert.equal(rowState().status, "pending");
} finally {
  global.fetch = originalFetch;
  delete process.env.IBMC_STAGING_SAFE_MODE;
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

console.log("Paynamics Workflow checks passed.");

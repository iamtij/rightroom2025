import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./db.js";
import { createRegistration } from "./registrations.js";
import {
  allowedPaymentRedirectUrl,
  applyPaynamicsStatus,
  buildWorkflowCreateBody,
  extractHostedPaymentUrl,
  handlePaynamicsNotification,
  paynamicsApiCallsAllowed,
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

assert.equal((await startPaynamicsPayment(db, registration)).status, 503);

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

global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes("/paygate/transactions/") && !target.includes("/query")) {
    const payload = JSON.parse(options.body || "{}");
    assert.equal(options.headers.Authorization.startsWith("Basic "), true);
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

const started = await startPaynamicsPayment(db, registration);
assert.equal(started.paynamics?.status, "pending");
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

const mismatch = await handlePaynamicsNotification(db, {
  merchant_id: TEST_MID,
  request_id: row.request_id,
  response_code: "GR001",
  response_message: "paid",
  amount: "0.01",
  currency: "PHP",
});
assert.equal(db.prepare("SELECT status FROM paynamics_payments WHERE id = ?").get(row.id).status, "failed");

db.prepare("UPDATE paynamics_payments SET status = 'pending' WHERE id = ?").run(row.id);
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
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(fixedRow.request_id).count, 0);

delete process.env.IBMC_PAYNAMICS_UNIT_TEST_ALLOW_SETTLE;
applyPaynamicsStatus(db, fixedRow, {
  merchant_id: TEST_MID,
  request_id: fixedRow.request_id,
  response_code: "GR001",
  amount: amountLabel,
  currency: "PHP",
}, { allowSettle: true });
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(fixedRow.request_id).count, 0);
process.env.IBMC_PAYNAMICS_UNIT_TEST_ALLOW_SETTLE = "true";

const settled = applyPaynamicsStatus(db, fixedRow, {
  merchant_id: TEST_MID,
  request_id: fixedRow.request_id,
  response_code: "GR001",
  amount: amountLabel,
  currency: "PHP",
}, { allowSettle: true });
assert.equal(settled.status, "paid");
applyPaynamicsStatus(db, settled, {
  merchant_id: TEST_MID,
  request_id: fixedRow.request_id,
  response_code: "GR001",
  amount: amountLabel,
  currency: "PHP",
}, { allowSettle: true });
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(fixedRow.request_id).count, 1);

assert.equal(workflowResponseSignatureValid(signedCreateResponse("x"), TEST_KEY, { requestId: "x" }), true);
assert.equal(parseNotificationPayload({ request_id: "abc", response_code: "GR033" }).request_id, "abc");

global.fetch = originalFetch;

const file = path.join(os.tmpdir(), `ibmc-verify-paynamics-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
process.env.IBMC_DB_PATH = file;
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";
const { createApi } = await import("./api.js");
openDatabase(file).prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();

const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const webhook = await fetch(`${base}/api/webhooks/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_code: "GR001" }),
  });
  assert.equal(webhook.status, 400);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

console.log("Paynamics Workflow checks passed.");

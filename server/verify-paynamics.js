import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./db.js";
import { createRegistration } from "./registrations.js";
import {
  applyPaynamicsStatus,
  buildWorkflowCreateBody,
  extractHostedPaymentUrl,
  handlePaynamicsNotification,
  paynamicsApiCallsAllowed,
  paynamicsCustomerSignature,
  paynamicsOutcome,
  paynamicsQuerySignature,
  paynamicsSettlementEnabled,
  paynamicsTransactionSignature,
  parseNotificationPayload,
  startPaynamicsPayment,
} from "./paynamics.js";
import { listPaymentChannels } from "./payment-channels.js";

const TEST_KEY = "test_merchant_key_only_for_ci";
const TEST_MID = "TESTMID";
const originalFetch = global.fetch;

delete process.env.PAYNAMICS_API_CALLS_ENABLED;
delete process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED;
process.env.PAYNAMICS_MERCHANT_ID = TEST_MID;
process.env.PAYNAMICS_MERCHANT_KEY = TEST_KEY;
process.env.PUBLIC_WEB_URL = "https://staging.example.test";
process.env.SITE_URL = "https://staging.example.test";

assert.equal(paynamicsApiCallsAllowed(), false);

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
const sig = paynamicsTransactionSignature(tx, TEST_MID, TEST_KEY);
assert.equal(sig.length, 128);
assert.notEqual(sig, paynamicsTransactionSignature({ ...tx, amount: "51.00" }, TEST_MID, TEST_KEY));
assert.equal(
  paynamicsCustomerSignature({ fname: "A", lname: "B", mname: "", email: "a@example.com", phone: "+63917", mobile: "+63917", dob: "" }, TEST_KEY).length,
  128,
);
assert.equal(paynamicsQuerySignature("Q1", "req123", TEST_MID, TEST_KEY).length, 128);
assert.equal(paynamicsOutcome("GR001"), "paid");
assert.equal(paynamicsOutcome("GR033"), "pending");
assert.equal(extractHostedPaymentUrl({ redirect_url: "https://checkout.example.test/pay" }), "https://checkout.example.test/pay");
assert.equal(extractHostedPaymentUrl({ transaction: { payment_url: "http://insecure.test" } }), "");

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

const blocked = await startPaynamicsPayment(db, registration);
assert.equal(blocked.status, 503);

process.env.PAYNAMICS_BASIC_AUTH_USER = "workflow_user";
process.env.PAYNAMICS_BASIC_AUTH_PASSWORD = "workflow_pass";
process.env.PAYNAMICS_API_BASE_URL = "https://sandbox.paynamics.example.test";
process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED = "true";
process.env.PAYNAMICS_API_CALLS_ENABLED = "true";
process.env.PAYNAMICS_API_ENV = "sandbox";

assert.equal(paynamicsApiCallsAllowed(), true);
assert.equal(paynamicsSettlementEnabled(), false);

const requestId = "wfreq1234567890123456789012";
const body = buildWorkflowCreateBody({
  merchantId: TEST_MID,
  merchantKey: TEST_KEY,
  requestId,
  registration,
  amountCents: 50_000,
});
assert.equal(body.transaction.signature, paynamicsTransactionSignature(body.transaction, TEST_MID, TEST_KEY));

global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes("/paygate/transactions/") && !target.includes("/query")) {
    const payload = JSON.parse(options.body || "{}");
    assert.equal(options.headers.Authorization.startsWith("Basic "), true);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "GR033",
        redirect_url: "https://checkout.example.test/wf-session",
        request_id: payload.transaction.request_id,
      }),
    };
  }
  if (target.includes("/paygate/transactions/query")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        response_code: "GR033",
        request_id: JSON.parse(options.body || "{}").org_trxid2,
        amount: "500.00",
        currency: "PHP",
      }),
    };
  }
  throw new Error(`unexpected fetch ${target}`);
};

const started = await startPaynamicsPayment(db, registration);
assert.equal(started.paynamics?.status, "pending");
assert.equal(started.paynamics?.paymentUrl, "https://checkout.example.test/wf-session");

const row = db.prepare("SELECT * FROM paynamics_payments WHERE request_id = ?").get(started.paynamics.requestId);
const amountLabel = (row.amount_cents / 100).toFixed(2);

const pendingNotice = await handlePaynamicsNotification(db, {
  request_id: row.request_id,
  response_code: "GR033",
  response_message: "pending",
  amount: amountLabel,
  currency: "PHP",
});
assert.equal(pendingNotice.status, 200);
assert.equal(db.prepare("SELECT status FROM paynamics_payments WHERE id = ?").get(row.id).status, "pending");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(row.request_id).count, 0);

const mismatch = await handlePaynamicsNotification(db, {
  request_id: row.request_id,
  response_code: "GR001",
  response_message: "paid",
  amount: "0.01",
  currency: "PHP",
});
assert.equal(mismatch.status, 200);
assert.equal(db.prepare("SELECT status FROM paynamics_payments WHERE id = ?").get(row.id).status, "failed");

const row2 = db.prepare("SELECT * FROM paynamics_payments WHERE request_id = ?").get(row.request_id);
db.prepare("UPDATE paynamics_payments SET status = 'pending' WHERE id = ?").run(row2.id);
const fixedRow = db.prepare("SELECT * FROM paynamics_payments WHERE id = ?").get(row2.id);

const unverifiedPaid = await handlePaynamicsNotification(db, {
  request_id: fixedRow.request_id,
  response_code: "GR001",
  response_message: "paid",
  amount: amountLabel,
  currency: "PHP",
});
assert.equal(unverifiedPaid.status, 200);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(fixedRow.request_id).count, 0);

process.env.PAYNAMICS_SETTLEMENT_ENABLED = "true";
process.env.PAYNAMICS_NOTIFICATION_VERIFY_CONTRACT = "workflow_mock_test_only";
process.env.PAYNAMICS_ALLOW_TEST_SETTLEMENT = "true";
assert.equal(paynamicsSettlementEnabled(), true);

const settled = applyPaynamicsStatus(db, fixedRow, {
  request_id: fixedRow.request_id,
  response_code: "GR001",
  response_message: "paid",
  amount: amountLabel,
  currency: "PHP",
  __testVerified: true,
}, { allowSettle: true });
assert.equal(settled.status, "paid");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(fixedRow.request_id).count, 1);
applyPaynamicsStatus(db, settled, {
  request_id: fixedRow.request_id,
  response_code: "GR001",
  amount: amountLabel,
  currency: "PHP",
  __testVerified: true,
}, { allowSettle: true });
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(fixedRow.request_id).count, 1);

assert.equal(parseNotificationPayload({ transaction: { request_id: "abc", response_code: "GR033" } }).request_id, "abc");

global.fetch = originalFetch;

const file = path.join(os.tmpdir(), `ibmc-verify-paynamics-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
process.env.IBMC_DB_PATH = file;
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";
const { createApi } = await import("./api.js");
const seeded = openDatabase(file);
seeded.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();
seeded.close();

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
  global.fetch = originalFetch;
}

console.log("Paynamics Workflow checks passed.");

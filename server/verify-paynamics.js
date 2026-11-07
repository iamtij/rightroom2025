import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./db.js";
import { createRegistration } from "./registrations.js";
import {
  decodePaymentPayload,
  encodeCheckoutRequest,
  handlePaynamicsNotification,
  paynamicsOutcome,
  paynamicsRequestSignature,
  paynamicsResponseSignature,
  paymentAccepted,
  startPaynamicsPayment,
} from "./paynamics.js";
import { listPaymentChannels } from "./payment-channels.js";

const TEST_KEY = "test_merchant_key_only_for_ci";
const TEST_MID = "TESTMID";

process.env.PAYNAMICS_MERCHANT_ID = TEST_MID;
process.env.PAYNAMICS_MERCHANT_KEY = TEST_KEY;
process.env.PAYNAMICS_MERCHANT_IP = "203.0.113.10";
process.env.PAYNAMICS_ENV = "sandbox";
process.env.PAYNAMICS_CHECKOUT_URL = "https://testpti.payserv.net/webpayment/default.aspx";
process.env.PUBLIC_WEB_URL = "https://staging.example.test";
process.env.SITE_URL = "https://staging.example.test";

assert.equal(paynamicsOutcome("GR001"), "paid");
assert.equal(paynamicsOutcome("GR033"), "pending");
assert.equal(paynamicsOutcome("GR039"), "failed");

const requestFields = {
  mid: TEST_MID,
  request_id: "req123",
  ip_address: "203.0.113.10",
  notification_url: "https://staging.example.test/api/webhooks/paynamics",
  response_url: "https://staging.example.test/register?paynamicsRequest=req123",
  fname: "A",
  lname: "B",
  mname: "",
  address1: "Makati",
  address2: "",
  city: "Makati",
  state: "NCR",
  country: "PH",
  zip: "1200",
  email: "a@example.com",
  phone: "+639171234567",
  client_ip: "203.0.113.20",
  amount: "50.00",
  currency: "PHP",
  secure3d: "enabled",
};
const signature = paynamicsRequestSignature(requestFields, TEST_KEY);
const encoded = encodeCheckoutRequest(requestFields, TEST_KEY);
assert.ok(encoded.length > 40);
assert.equal(signature.length, 128);
assert.notEqual(signature, paynamicsRequestSignature({ ...requestFields, amount: "51.00" }, TEST_KEY));

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

const started = await startPaynamicsPayment(db, registration, "203.0.113.20");
assert.ok(started.paynamics?.requestId);
assert.equal(started.paynamics.status, "pending");

function signedNotification(fields) {
  const sig = paynamicsResponseSignature(fields, TEST_KEY);
  const xml = `<Request><merchantid>${fields.merchantid}</merchantid><request_id>${fields.request_id}</request_id><response_id>${fields.response_id}</response_id><response_code>${fields.response_code}</response_code><response_message>${fields.response_message}</response_message><response_advise>${fields.response_advise || ""}</response_advise><timestamp>${fields.timestamp}</timestamp><rebill_id>${fields.rebill_id || ""}</rebill_id><signature>${sig}</signature></Request>`;
  return Buffer.from(xml, "utf8").toString("base64");
}

const tamperedXml = `<Request><merchantid>${TEST_MID}</merchantid><request_id>${started.paynamics.requestId}</request_id><response_id>RSP001</response_id><response_code>GR001</response_code><response_message>ok</response_message><response_advise></response_advise><timestamp>2026-11-07T10:00:00Z</timestamp><rebill_id></rebill_id><signature>${"a".repeat(128)}</signature></Request>`;
const bad = await handlePaynamicsNotification(db, {
  paymentresponse: Buffer.from(tamperedXml, "utf8").toString("base64"),
}, TEST_KEY);
assert.equal(bad.status, 200);
const afterTamper = db.prepare("SELECT status FROM paynamics_payments WHERE request_id = ?").get(started.paynamics.requestId);
assert.equal(afterTamper.status, "failed");

const pending = await handlePaynamicsNotification(db, {
  paymentresponse: signedNotification({
    merchantid: TEST_MID,
    request_id: started.paynamics.requestId,
    response_id: "RSP002",
    response_code: "GR033",
    response_message: "pending",
    timestamp: "2026-11-07T10:01:00Z",
  }),
}, TEST_KEY);
assert.equal(pending.status, 200);
const pendingRow = db.prepare("SELECT status FROM paynamics_payments WHERE request_id = ?").get(started.paynamics.requestId);
assert.equal(pendingRow.status, "pending");

const acceptedFields = {
  merchantid: TEST_MID,
  request_id: started.paynamics.requestId,
  response_id: "RSP003",
  response_code: "GR001",
  response_message: "Transaction Successful",
  timestamp: "2026-11-07T10:02:00Z",
};
const acceptedPayload = {
  ...acceptedFields,
  signature: paynamicsResponseSignature(acceptedFields, TEST_KEY),
};
assert.equal(paymentAccepted(acceptedPayload, db.prepare("SELECT * FROM paynamics_payments WHERE request_id = ?").get(started.paynamics.requestId), TEST_KEY), true);

const paid = await handlePaynamicsNotification(db, {
  paymentresponse: signedNotification(acceptedFields),
}, TEST_KEY);
assert.equal(paid.status, 200);
const paidRow = db.prepare("SELECT status FROM paynamics_payments WHERE request_id = ?").get(started.paynamics.requestId);
assert.equal(paidRow.status, "paid");
const paymentCount = db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(started.paynamics.requestId).count;
assert.equal(paymentCount, 1);

const replay = await handlePaynamicsNotification(db, {
  paymentresponse: signedNotification(acceptedFields),
}, TEST_KEY);
assert.equal(replay.status, 200);
assert.equal(
  db.prepare("SELECT COUNT(*) AS count FROM payments WHERE external_reference = ?").get(started.paynamics.requestId).count,
  1,
);

const mismatch = await handlePaynamicsNotification(db, {
  paymentresponse: signedNotification({
    merchantid: TEST_MID,
    request_id: started.paynamics.requestId,
    response_id: "RSP004",
    response_code: "GR001",
    response_message: "wrong sig",
    timestamp: "2026-11-07T10:03:00Z",
  }).slice(0, -8),
}, TEST_KEY);
assert.equal(mismatch.status, 200);

assert.equal(decodePaymentPayload({ paymentresponse: signedNotification(acceptedFields) }).includes("<request_id>"), true);

const file = path.join(os.tmpdir(), `ibmc-verify-paynamics-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
process.env.IBMC_DB_PATH = file;
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";
const { createApi } = await import("./api.js");
const seeded = openDatabase(file);
seeded.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();
seeded.prepare("UPDATE payment_channels SET enabled = 1 WHERE code = 'paynamics'").run();
seeded.close();

const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const channels = await fetch(`${base}/api/payment-channels`);
  const channelBody = await channels.json();
  assert.ok(channelBody.channels.some((item) => item.code === "paynamics"));

  const unsigned = await fetch(`${base}/api/webhooks/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "paymentresponse=not-valid",
  });
  assert.equal(unsigned.status, 400);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

console.log("Paynamics checks passed.");

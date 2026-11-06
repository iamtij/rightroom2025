import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "./db.js";
import { currentTotp } from "./auth.js";
import { createRegistration, getEntryPass, recordPayment, resumeTokenMatches } from "./registrations.js";
import { upaySettlement } from "./upay.js";

delete process.env.ALLOW_TEST_TICKET;

const db = openDatabase(":memory:");
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();

assert.equal(db.prepare("SELECT id FROM ticket_products WHERE code = 'test'").get(), undefined);
db.prepare(`
  INSERT INTO ticket_products (
    code, name, audience, currency, full_price_cents, installment_total_cents,
    sales_start, sales_end, allows_installment
  ) VALUES ('test', 'Test', 'local', 'PHP', 1000, NULL, '2020-01-01', '2027-05-31', 0)
`).run();
assert.throws(
  () => createRegistration(db, {
    productCode: "test",
    paymentPlan: "full",
    fullName: "Test Person",
    email: "test@example.com",
    mobile: "09170000000",
    registeredOn: "2026-11-06",
  }),
  /Unknown ticket/,
);

assert.equal(upaySettlement({ code: "TS", amount: 1000 }, 100_000), "paid");
assert.equal(upaySettlement({ code: "TS", amount: "1,000.00" }, 100_000), "paid");
assert.equal(upaySettlement({ code: "TS", amount: 1 }, 100_000), "pending");
assert.equal(upaySettlement({ code: "TS" }, 100_000), "pending");
assert.equal(upaySettlement({ code: "TF", amount: 1000 }, 100_000), "failed");
assert.equal(upaySettlement({ code: "SP", amount: 1000 }, 100_000), "pending");
assert.equal(upaySettlement({ data: [{ status: "SUCCESS", amount: "1000.00" }] }, 100_000), "paid");
assert.equal(upaySettlement({ data: [{ status: "SUCCESS", amount: "10.00" }], amount: 1000 }, 100_000), "pending");

const registration = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Amina Cruz",
  email: "amina@example.com",
  mobile: "09171234567",
  registeredOn: "2026-11-12",
});
assert.ok(registration.resume_token);
assert.equal(resumeTokenMatches(registration, registration.resume_token), true);
assert.equal(resumeTokenMatches(registration, "not-the-token"), false);
assert.equal(getEntryPass(db, registration.qr_token), null);

const paid = recordPayment(db, { registrationId: registration.id, amountCents: registration.amount_due_cents, method: "manual" });
const pass = getEntryPass(db, paid.qr_token);
assert.equal(pass.fullName, "Amina Cruz");
assert.equal(pass.reference, registration.reference);
assert.equal(getEntryPass(db, "made-up-token"), null);

process.env.ALLOW_TEST_REGISTRATION = "true";
db.prepare(`
  INSERT INTO ticket_products (
    code, name, audience, currency, full_price_cents, installment_total_cents,
    sales_start, sales_end, allows_installment
  ) VALUES ('test_50', 'Test Payment', 'local', 'PHP', 5000, NULL, '2020-01-01', '2027-05-31', 0)
`).run();
const testRegistration = createRegistration(db, {
  productCode: "test_50",
  paymentPlan: "full",
  fullName: "Test Person",
  email: "test50@example.com",
  mobile: "09170000050",
  registeredOn: "2026-11-12",
});
const testPaid = recordPayment(db, { registrationId: testRegistration.id, amountCents: 5_000, method: "manual" });
assert.ok(testPaid.qr_token);
assert.equal(getEntryPass(db, testPaid.qr_token), null);
delete process.env.ALLOW_TEST_REGISTRATION;

const file = path.join(os.tmpdir(), `ibmc-verify-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
process.env.IBMC_DB_PATH = file;
process.env.ALLOW_TEST_TICKET = "";
delete process.env.ALLOW_TEST_REGISTRATION;
process.env.ADMIN_EMAIL = "audit@example.com";
process.env.ADMIN_PASSWORD = "correct-horse-battery";
process.env.ADMIN_SESSION_SECRET = "security-audit-test-secret-32ch";
const { createApi } = await import("./api.js");
const seeded = openDatabase(file);
seeded.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();
seeded.close();

const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const realFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith("/api/registrations") && options.method === "POST") {
    const challenge = await realFetch(`${base}/api/challenge`);
    const token = (await challenge.json()).token;
    const body = JSON.parse(options.body || "{}");
    options = { ...options, body: JSON.stringify({ ...body, challenge: body.challenge || token, companyWebsite: body.companyWebsite || "" }) };
  }
  return realFetch(url, options);
};
try {
  const blocked = await fetch(`${base}/api/registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: "test",
      paymentPlan: "full",
      fullName: "Test Person",
      email: "test@example.com",
      mobile: "09170000000",
    }),
  });
  assert.equal(blocked.status, 400);

  const created = await fetch(`${base}/api/registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: "first_mover",
      paymentPlan: "full",
      fullName: "Amina Cruz",
      email: "amina@example.com",
      mobile: "09171234567",
      attendeeType: "member",
    }),
  });
  const body = await created.json();
  assert.equal(created.status, 201);
  assert.match(created.headers.get("set-cookie") || "", /ibmc_resume=/);
  assert.equal(created.headers.get("x-frame-options"), "DENY");
  assert.equal(body.attendee.email, "amina@example.com");
  assert.ok(body.resumeToken);

  const hidden = await fetch(`${base}/api/registrations/${body.reference}`);
  const hiddenBody = await hidden.json();
  assert.equal(hidden.status, 200);
  assert.equal(hiddenBody.attendee.fullName, "");
  assert.equal(hiddenBody.attendee.email, "");
  assert.equal(hiddenBody.attendee.mobile, "");
  assert.equal(hiddenBody.resumeToken, undefined);
  assert.equal(hiddenBody.reference, body.reference);

  const shown = await fetch(`${base}/api/registrations/${body.reference}`, {
    headers: { "X-Resume-Token": body.resumeToken },
  });
  const shownBody = await shown.json();
  assert.equal(shownBody.attendee.fullName, "Amina Cruz");
  assert.equal(shownBody.attendee.email, "amina@example.com");
  assert.equal(shownBody.resumeToken, body.resumeToken);

  const missing = await fetch(`${base}/api/passes/not-a-real-pass`);
  assert.equal(missing.status, 404);

  const options = await fetch(`${base}/api/registration-options`);
  const optionBody = await options.json();
  assert.equal(options.status, 200);
  assert.equal(optionBody.tests, false);
  assert.equal(optionBody.testTicket, false);
  const testSale = await fetch(`${base}/api/registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: "test_50",
      paymentPlan: "full",
      fullName: "Test Person",
      email: "test50-http@example.com",
      mobile: "09170000051",
      attendeeType: "member",
    }),
  });
  assert.equal(testSale.status, 400);

  const side = openDatabase(file);
  side.prepare(`
    INSERT INTO members (
      full_name, email, mobile, chapter, category, business_name, reg_status, registered_at
    ) VALUES ('Member One', 'member.one@example.com', '09181234567', 'Makati', 'Consulting', 'One Co', 'updated', '2026-11-01')
  `).run();
  const registrationId = side.prepare("SELECT id FROM registrations WHERE reference = ?").get(body.reference).id;
  const installmentId = side.prepare("SELECT id FROM registration_installments WHERE registration_id = ? ORDER BY sequence LIMIT 1").get(registrationId).id;
  side.prepare(`
    INSERT INTO upay_payments (
      registration_id, installment_id, sender_ref_id, amount_cents, currency, payment_method,
      status, payment_url
    ) VALUES (?, ?, 'IBMCSECURITYTEST', 1200000, 'PHP', 'instapay', 'paid', 'https://example.test/pay')
  `).run(registrationId, installmentId);
  side.close();

  const knownLookup = await fetch(`${base}/api/members/lookup?q=${encodeURIComponent("member.one@example.com")}`);
  const unknownLookup = await fetch(`${base}/api/members/lookup?q=${encodeURIComponent("missing.person@example.com")}`);
  assert.equal(knownLookup.status, 200);
  assert.equal(unknownLookup.status, 200);
  assert.deepEqual(await knownLookup.json(), { ok: true });
  assert.deepEqual(await unknownLookup.json(), { ok: true });
  const { issueMemberOtp } = await import("./otp.js");
  const otpDb = openDatabase(file);
  const issued = issueMemberOtp(otpDb, "member.one@example.com");
  otpDb.close();
  const verified = await fetch(`${base}/api/members/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "member.one@example.com", code: issued.code }),
  });
  const looked = await verified.json();
  assert.equal(verified.status, 200);
  assert.equal(looked.member.email, "member.one@example.com");
  assert.ok(looked.member.memberToken);

  const proved = await fetch(`${base}/api/registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: "first_mover",
      paymentPlan: "full",
      fullName: "Member One",
      email: "attacker@example.com",
      mobile: "09170000999",
      attendeeType: "member",
      memberToken: looked.member.memberToken,
      business: "One Co",
      industry: "Consulting",
      chapter: "Makati",
    }),
  });
  const provedBody = await proved.json();
  assert.equal(proved.status, 201);
  assert.equal(provedBody.attendee.email, "member.one@example.com");
  assert.equal(provedBody.attendee.mobile, "09181234567");

  const hiddenPay = await fetch(`${base}/api/payments/upay/IBMCSECURITYTEST`);
  const hiddenPayBody = await hiddenPay.json();
  assert.equal(hiddenPay.status, 200);
  assert.equal(hiddenPayBody.registration.attendee.email, "");
  assert.equal(hiddenPayBody.registration.attendee.mobile, "");
  assert.equal(hiddenPayBody.registration.reference, body.reference);
  assert.equal(hiddenPayBody.upay.senderRefId, "IBMCSECURITYTEST");

  const shownPay = await fetch(`${base}/api/payments/upay/IBMCSECURITYTEST`, {
    headers: { "X-Resume-Token": body.resumeToken },
  });
  const shownPayBody = await shownPay.json();
  assert.equal(shownPayBody.registration.attendee.email, "amina@example.com");
  assert.equal(shownPayBody.registration.attendee.fullName, "Amina Cruz");

  const login = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "audit@example.com", password: "correct-horse-battery" }),
  });
  const setup = await login.json();
  assert.equal(login.status, 200);
  assert.ok(setup.setupToken);
  const confirmed = await fetch(`${base}/api/admin/mfa/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setupToken: setup.setupToken, code: currentTotp(setup.secret) }),
  });
  assert.equal(confirmed.status, 200);
  const cookie = (confirmed.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie.startsWith("ibmc_admin="));
  const marked = await fetch(`${base}/api/admin/registrations/${body.reference}/payments`, {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(marked.status, 200);
  const listed = await fetch(`${base}/api/admin/registrations`, { headers: { cookie } });
  assert.equal(listed.status, 200);

  const duplicate = await fetch(`${base}/api/registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: "first_mover",
      paymentPlan: "full",
      fullName: "Amina Cruz",
      email: "amina@example.com",
      mobile: "09170001111",
      attendeeType: "member",
    }),
  });
  assert.equal(duplicate.status, 400);

  const couponDb = openDatabase(file);
  couponDb.prepare(`
    INSERT INTO coupons (code, discount_type, discount_value, active)
    VALUES ('FREESEAT', 'percent', 100, 1)
  `).run();
  couponDb.close();
  const freeSeat = await fetch(`${base}/api/registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: "first_mover",
      paymentPlan: "full",
      fullName: "Free Seat",
      email: "free.seat@example.com",
      mobile: "09170002222",
      attendeeType: "member",
      couponCode: "FREESEAT",
    }),
  });
  assert.equal(freeSeat.status, 400);

  const callback = await fetch(`${base}/api/payments/upay/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderRefId: "IBMCSECURITYTEST" }),
  });
  assert.equal(callback.status, 401);

  const passDb = openDatabase(file);
  const qrToken = passDb.prepare("SELECT qr_token FROM registrations WHERE reference = ?").get(body.reference).qr_token;
  passDb.close();
  assert.ok(qrToken);
  const firstScan = await fetch(`${base}/api/admin/passes/check-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ token: qrToken }),
  });
  assert.equal(firstScan.status, 200);
  const secondScan = await fetch(`${base}/api/admin/passes/check-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ token: qrToken }),
  });
  assert.equal(secondScan.status, 409);
  const overrideScan = await fetch(`${base}/api/admin/passes/check-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ token: qrToken, override: true }),
  });
  assert.equal(overrideScan.status, 200);

  await fetch(`${base}/api/admin/logout`, { method: "POST", headers: { cookie } });
  const afterLogout = await fetch(`${base}/api/admin/me`, { headers: { cookie } });
  assert.equal(afterLogout.status, 401);

  const check = openDatabase(file);
  const audit = check.prepare("SELECT action, target, amount_cents, admin_id FROM admin_audit ORDER BY id").all();
  assert.ok(audit.some((row) => row.action === "registration.payment" && row.target === body.reference && row.amount_cents === 1_200_000 && row.admin_id));
  assert.ok(audit.some((row) => row.action === "registration.list" && row.target === "registrations"));
  const payment = check.prepare("SELECT admin_user_id, method FROM payments WHERE registration_id = ?").get(registrationId);
  assert.equal(payment.method, "admin");
  assert.equal(payment.admin_user_id, audit.find((row) => row.action === "registration.payment").admin_id);
  check.close();
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
  global.fetch = realFetch;
}

console.log("Payment checks passed.");

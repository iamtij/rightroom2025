import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "./db.js";
import { currentTotp } from "./auth.js";
import { createRegistration, getEntryPass, recordPayment, resumeTokenMatches } from "./registrations.js";
import { upayPublicCheckoutInfo, upaySettlement } from "./upay.js";
import { buyerPaymentChannels, listPaymentChannels, savePaymentChannels } from "./payment-channels.js";

delete process.env.ALLOW_TEST_TICKET;

const db = openDatabase(":memory:");
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();

const qrChannel = () => listPaymentChannels(db).find((item) => item.code === "hitpay_qr");
const qrNote = "You'll get a QR Ph code on the next screen. Stay on that page if you already paid.";
assert.equal(qrChannel().customLabel, "");
assert.equal(qrChannel().customNote, "");
assert.equal(qrChannel().note, qrNote);
assert.equal(qrChannel().enabled, false);
assert.equal(
  buyerPaymentChannels(db).find((item) => item.code === "upay").note,
  "UnionBank collects this for GLOBAL REFERRAL MARKETING INC.",
);
savePaymentChannels(db, { hitpay_qr: { label: "  QR Ph  " } });
assert.equal(qrChannel().customLabel, "QR Ph");
assert.equal(qrChannel().enabled, false);
savePaymentChannels(db, { hitpay_qr: true });
assert.equal(qrChannel().enabled, true);
assert.equal(qrChannel().customLabel, "QR Ph");
assert.equal(buyerPaymentChannels(db).find((item) => item.code === "hitpay_qr").label, "QR Ph");
savePaymentChannels(db, { hitpay_qr: { label: " " } });
assert.equal(qrChannel().customLabel, "");
assert.equal(qrChannel().enabled, true);
assert.equal(buyerPaymentChannels(db).find((item) => item.code === "hitpay_qr").label, "HitPay QR");
assert.throws(() => savePaymentChannels(db, { hitpay_qr: { label: "x".repeat(81) } }), /80 characters/);
savePaymentChannels(db, { hitpay_qr: false });
assert.equal(qrChannel().enabled, false);
savePaymentChannels(db, { hitpay_qr: { note: "  Scan this QR.  ", enabled: true } });
assert.equal(qrChannel().customNote, "Scan this QR.");
assert.equal(qrChannel().enabled, true);
assert.equal(buyerPaymentChannels(db).find((item) => item.code === "hitpay_qr").note, "Scan this QR.");
savePaymentChannels(db, { hitpay_qr: { label: "QR Ph" } });
assert.equal(qrChannel().customLabel, "QR Ph");
assert.equal(qrChannel().customNote, "Scan this QR.");
savePaymentChannels(db, { hitpay_qr: false });
assert.equal(qrChannel().enabled, false);
assert.equal(qrChannel().customNote, "Scan this QR.");
savePaymentChannels(db, { hitpay_qr: { note: `  ${qrNote}  ` } });
assert.equal(qrChannel().customNote, "");
savePaymentChannels(db, { hitpay_qr: { note: " " } });
assert.equal(qrChannel().customNote, "");
assert.throws(() => savePaymentChannels(db, { hitpay_qr: { note: "x".repeat(401) } }), /400 characters/);
savePaymentChannels(db, { hitpay_qr: { label: "" } });
assert.equal(qrChannel().customLabel, "");

const legacyFile = path.join(os.tmpdir(), `ibmc-channel-label-${process.pid}.sqlite`);
fs.rmSync(legacyFile, { force: true });
const legacy = new Database(legacyFile);
legacy.exec(`
  CREATE TABLE payment_channels (
    code TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
  );
  INSERT INTO payment_channels (code, enabled) VALUES ('upay', 0), ('hitpay_qr', 1);
`);
legacy.close();
const migrated = openDatabase(legacyFile);
assert.equal(listPaymentChannels(migrated).find((item) => item.code === "hitpay_qr").enabled, true);
assert.equal(listPaymentChannels(migrated).find((item) => item.code === "upay").enabled, false);
savePaymentChannels(migrated, { hitpay_qr: { label: "Legacy QR", note: "Legacy note" } });
assert.equal(buyerPaymentChannels(migrated).find((item) => item.code === "hitpay_qr").label, "Legacy QR");
assert.equal(buyerPaymentChannels(migrated).find((item) => item.code === "hitpay_qr").note, "Legacy note");
migrated.close();
fs.rmSync(legacyFile, { force: true });
fs.rmSync(`${legacyFile}-wal`, { force: true });
fs.rmSync(`${legacyFile}-shm`, { force: true });

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

const savedUpay = {
  UPAY_BILLER_UUID: process.env.UPAY_BILLER_UUID,
  UPAY_BASE_URL: process.env.UPAY_BASE_URL,
  UPAY_CLIENT_ID: process.env.UPAY_CLIENT_ID,
};
delete process.env.UPAY_BILLER_UUID;
assert.equal(upayPublicCheckoutInfo().checkoutMode, "off");
process.env.UPAY_BILLER_UUID = "uuid-test";
const billerOnly = upayPublicCheckoutInfo();
assert.equal(billerOnly.checkoutMode, "live");
assert.equal(billerOnly.ingestionReady, true);
assert.equal(billerOnly.settlementMode, "manual");
process.env.UPAY_BASE_URL = "https://api.unionbankph.com/ubp/external";
process.env.UPAY_CLIENT_ID = "c";
process.env.UPAY_CLIENT_SECRET = "s";
process.env.UPAY_PARTNER_ID = "p";
process.env.UPAY_USERNAME = "u";
process.env.UPAY_PASSWORD = "pw";
const withPartner = upayPublicCheckoutInfo();
assert.equal(withPartner.checkoutMode, "live");
assert.equal(withPartner.settlementMode, "poll");
for (const [key, value] of Object.entries(savedUpay)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

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
process.env.IBMC_STAGING_EARLY_PAYMENTS = "true";
process.env.IBMC_DEPLOYMENT_ENV = "staging";
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
const testPass = getEntryPass(db, testPaid.qr_token);
assert.ok(testPass);
assert.equal(testPass.fullName, "Test Person");
delete process.env.ALLOW_TEST_REGISTRATION;
delete process.env.IBMC_STAGING_EARLY_PAYMENTS;
assert.equal(getEntryPass(db, testPaid.qr_token), null);

const file = path.join(os.tmpdir(), `ibmc-verify-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
process.env.IBMC_DB_PATH = file;
process.env.ALLOW_TEST_TICKET = "";
delete process.env.ALLOW_TEST_REGISTRATION;
process.env.ADMIN_EMAIL = "audit@example.com";
process.env.ADMIN_PASSWORD = "correct-horse-battery";
process.env.ADMIN_SESSION_SECRET = "security-audit-test-secret-32ch";
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";
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

  const previewHit = await fetch(`${base}/api/members/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "member.one@example.com" }),
  });
  const previewBody = await previewHit.json();
  assert.equal(previewHit.status, 200);
  assert.equal(previewBody.found, true);
  assert.equal(previewBody.firstName, "Member");
  assert.equal(previewBody.chapter, "Makati");
  assert.match(previewBody.maskedEmail, /^me\*+@example\.com$/);
  assert.equal(previewBody.email, undefined);
  assert.equal(previewBody.mobile, undefined);
  assert.equal(previewBody.memberToken, undefined);
  const previewMiss = await fetch(`${base}/api/members/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "missing.person@example.com" }),
  });
  assert.deepEqual(await previewMiss.json(), { ok: true, found: false });
  const previewBad = await fetch(`${base}/api/members/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "not-a-contact" }),
  });
  assert.equal(previewBad.status, 400);

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
  assert.equal(looked.member.registered, false);
  assert.equal(looked.registration, undefined);
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

  const incompleteDb = openDatabase(file);
  incompleteDb.prepare(`
    INSERT INTO members (
      full_name, email, mobile, phone_key, chapter, category, business_name, reg_status, registered_at
    ) VALUES (
      'Incomplete Member', 'incomplete.member@example.com', '09179990000', '9179990000',
      '', '', '', 'updated', '2026-11-01'
    )
  `).run();
  const incompleteCode = issueMemberOtp(incompleteDb, "incomplete.member@example.com");
  incompleteDb.close();
  const incompletePreview = await fetch(`${base}/api/members/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "09179990000" }),
  });
  const incompletePreviewBody = await incompletePreview.json();
  assert.equal(incompletePreviewBody.found, true);
  assert.equal(incompletePreviewBody.firstName, "Incomplete");
  assert.equal(incompletePreviewBody.chapter, "");
  assert.equal(incompletePreviewBody.email, undefined);
  const incompleteVerified = await fetch(`${base}/api/members/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "incomplete.member@example.com", code: incompleteCode.code }),
  });
  const incompleteBody = await incompleteVerified.json();
  assert.equal(incompleteVerified.status, 200);
  assert.equal(incompleteBody.member.profileReady, false);
  const incompletePay = await fetch(`${base}/api/registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: "first_mover",
      paymentPlan: "full",
      fullName: "Incomplete Member",
      email: "incomplete.member@example.com",
      mobile: "09179990000",
      attendeeType: "member",
      memberToken: incompleteBody.member.memberToken,
      business: "Filled In",
      industry: "Consulting",
      chapter: "Makati",
    }),
  });
  const incompletePayBody = await incompletePay.json();
  assert.equal(incompletePay.status, 400);
  assert.equal(incompletePayBody.error, "Add your name, business, industry, chapter, email, and mobile number.");

  const returnDb = openDatabase(file);
  const returnCode = issueMemberOtp(returnDb, "member.one@example.com");
  returnDb.close();
  const returned = await fetch(`${base}/api/members/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "member.one@example.com", code: returnCode.code }),
  });
  const returnedBody = await returned.json();
  assert.equal(returned.status, 200);
  assert.equal(returnedBody.member.registered, true);
  assert.equal(returnedBody.registration.reference, provedBody.reference);
  assert.equal(returnedBody.registration.attendee.fullName, "Member One");
  assert.equal(returnedBody.registration.attendee.email, "member.one@example.com");
  assert.equal(returnedBody.registration.resumeToken, provedBody.resumeToken);
  assert.ok(String(returned.headers.get("set-cookie") || "").includes("ibmc_resume="));

  const mobileDb = openDatabase(file);
  mobileDb.prepare(`
    INSERT INTO members (
      full_name, email, mobile, phone_key, chapter, category, business_name, reg_status, registered_at
    ) VALUES (
      'Mobile Member', 'mobile.roster@example.com', '09175550000', '9175550000',
      'Makati', 'Consulting', 'Mobile Co', 'updated', '2026-11-01'
    )
  `).run();
  const mobileRegistration = createRegistration(mobileDb, {
    productCode: "first_mover",
    paymentPlan: "full",
    fullName: "Mobile Member",
    email: "ticket.email@example.com",
    mobile: "09175550000",
    business: "Mobile Co",
    industry: "Consulting",
    chapter: "Makati",
    attendeeType: "member",
    registeredOn: "2026-11-12",
  });
  const mobileCode = issueMemberOtp(mobileDb, "09175550000");
  mobileDb.close();
  const mobileVerified = await fetch(`${base}/api/members/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "09175550000", code: mobileCode.code }),
  });
  const mobileBody = await mobileVerified.json();
  assert.equal(mobileVerified.status, 200);
  assert.equal(mobileBody.member.registered, true);
  assert.equal(mobileBody.member.email, "mobile.roster@example.com");
  assert.equal(mobileBody.registration.reference, mobileRegistration.reference);
  assert.equal(mobileBody.registration.attendee.email, "ticket.email@example.com");
  assert.ok(mobileBody.registration.resumeToken);

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
  const me = await fetch(`${base}/api/admin/me`, { headers: { cookie } });
  const meBody = await me.json();
  assert.equal(me.status, 200);
  assert.equal(meBody.email, "audit@example.com");
  assert.equal(meBody.role, "super");
  const createdAdmin = await fetch(`${base}/api/admin/admins`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "door@example.com", password: "door-pass-8" }),
  });
  const createdAdminBody = await createdAdmin.json();
  assert.equal(createdAdmin.status, 201);
  assert.equal(createdAdminBody.email, "door@example.com");
  assert.equal(createdAdminBody.role, "admin");
  assert.equal(createdAdminBody.authenticator, false);
  const shortPassword = await fetch(`${base}/api/admin/admins`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "short@example.com", password: "short" }),
  });
  assert.equal(shortPassword.status, 400);
  const duplicateAdmin = await fetch(`${base}/api/admin/admins`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "door@example.com", password: "door-pass-8" }),
  });
  assert.equal(duplicateAdmin.status, 400);
  const adminList = await fetch(`${base}/api/admin/admins`, { headers: { cookie } });
  const adminListBody = await adminList.json();
  assert.equal(adminList.status, 200);
  assert.ok(adminListBody.some((row) => row.email === "audit@example.com" && row.role === "super"));
  assert.ok(adminListBody.some((row) => row.email === "door@example.com" && row.role === "admin"));
  const renamed = await fetch(`${base}/api/admin/payment-channels`, {
    method: "PATCH",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ hitpay_qr: { label: "  Scan to pay  ", enabled: true } }),
  });
  const renamedBody = await renamed.json();
  assert.equal(renamed.status, 200);
  const renamedQr = renamedBody.channels.find((item) => item.code === "hitpay_qr");
  assert.equal(renamedQr.label, "HitPay QR");
  assert.equal(renamedQr.customLabel, "Scan to pay");
  assert.equal(renamedQr.enabled, true);
  const buyerChannels = await fetch(`${base}/api/payment-channels`);
  const buyerChannelBody = await buyerChannels.json();
  assert.equal(buyerChannelBody.channels.find((item) => item.code === "hitpay_qr").label, "Scan to pay");
  const noted = await fetch(`${base}/api/admin/payment-channels`, {
    method: "PATCH",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ hitpay_qr: { note: "  Official partner page.  " } }),
  });
  const notedBody = await noted.json();
  assert.equal(noted.status, 200);
  assert.equal(notedBody.channels.find((item) => item.code === "hitpay_qr").customNote, "Official partner page.");
  assert.equal(notedBody.channels.find((item) => item.code === "hitpay_qr").customLabel, "Scan to pay");
  const buyerNoted = await fetch(`${base}/api/payment-channels`);
  const buyerNotedBody = await buyerNoted.json();
  assert.equal(buyerNotedBody.channels.find((item) => item.code === "hitpay_qr").note, "Official partner page.");
  const kept = await fetch(`${base}/api/admin/payment-channels`, {
    method: "PATCH",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ hitpay_qr: false }),
  });
  const keptBody = await kept.json();
  assert.equal(kept.status, 200);
  assert.equal(keptBody.channels.find((item) => item.code === "hitpay_qr").customLabel, "Scan to pay");
  assert.equal(keptBody.channels.find((item) => item.code === "hitpay_qr").customNote, "Official partner page.");
  assert.equal(keptBody.channels.find((item) => item.code === "hitpay_qr").enabled, false);
  const tooLong = await fetch(`${base}/api/admin/payment-channels`, {
    method: "PATCH",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ hitpay_qr: { label: "x".repeat(81) } }),
  });
  assert.equal(tooLong.status, 400);
  const cleared = await fetch(`${base}/api/admin/payment-channels`, {
    method: "PATCH",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ hitpay_qr: { label: "" } }),
  });
  const clearedBody = await cleared.json();
  assert.equal(cleared.status, 200);
  assert.equal(clearedBody.channels.find((item) => item.code === "hitpay_qr").customLabel, "");
  const noteTooLong = await fetch(`${base}/api/admin/payment-channels`, {
    method: "PATCH",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ hitpay_qr: { note: "n".repeat(401) } }),
  });
  assert.equal(noteTooLong.status, 400);
  const noteCleared = await fetch(`${base}/api/admin/payment-channels`, {
    method: "PATCH",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ hitpay_qr: { note: "" } }),
  });
  const noteClearedBody = await noteCleared.json();
  assert.equal(noteCleared.status, 200);
  assert.equal(noteClearedBody.channels.find((item) => item.code === "hitpay_qr").customNote, "");
  const buyerDefault = await fetch(`${base}/api/payment-channels`);
  const buyerDefaultBody = await buyerDefault.json();
  assert.equal(
    buyerDefaultBody.channels.find((item) => item.code === "upay").note,
    "UnionBank collects this for GLOBAL REFERRAL MARKETING INC.",
  );
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

  const { hashPassword } = await import("./auth.js");
  const secondDb = openDatabase(file);
  secondDb.prepare("INSERT INTO admin_users (email, password_hash) VALUES ('second@example.com', ?)").run(hashPassword("another-correct-horse"));
  secondDb.close();
  const secondLogin = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "second@example.com", password: "another-correct-horse" }),
  });
  const secondSetup = await secondLogin.json();
  const secondConfirm = await fetch(`${base}/api/admin/mfa/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setupToken: secondSetup.setupToken, code: currentTotp(secondSetup.secret) }),
  });
  const secondCookie = (secondConfirm.headers.get("set-cookie") || "").split(";")[0];
  const secondMe = await fetch(`${base}/api/admin/me`, { headers: { cookie: secondCookie } });
  const secondMeBody = await secondMe.json();
  assert.equal(secondMe.status, 200);
  assert.equal(secondMeBody.role, "admin");
  const hiddenAdmins = await fetch(`${base}/api/admin/admins`, { headers: { cookie: secondCookie } });
  assert.equal(hiddenAdmins.status, 403);
  const staffDashboard = await fetch(`${base}/api/admin/dashboard`, { headers: { cookie: secondCookie } });
  assert.equal(staffDashboard.status, 200);
  const requested = await fetch(`${base}/api/admin/registrations/${provedBody.reference}/comp`, {
    method: "POST",
    headers: { cookie },
  });
  const requestedBody = await requested.json();
  assert.equal(requested.status, 200);
  assert.equal(requestedBody.pending, true);
  const sameAdmin = await fetch(`${base}/api/admin/registrations/${provedBody.reference}/comp`, {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(sameAdmin.status, 409);
  const approved = await fetch(`${base}/api/admin/registrations/${provedBody.reference}/comp`, {
    method: "POST",
    headers: { cookie: secondCookie },
  });
  assert.equal(approved.status, 200);
  const approvedBody = await approved.json();
  assert.equal(approvedBody.balanceCents, 0);

  await fetch(`${base}/api/admin/logout`, { method: "POST", headers: { cookie } });
  const afterLogout = await fetch(`${base}/api/admin/me`, { headers: { cookie } });
  assert.equal(afterLogout.status, 401);

  const check = openDatabase(file);
  const audit = check.prepare("SELECT action, target, amount_cents, admin_id FROM admin_audit ORDER BY id").all();
  assert.ok(audit.some((row) => row.action === "registration.payment" && row.target === body.reference && row.amount_cents === 1_200_000 && row.admin_id));
  assert.ok(audit.some((row) => row.action === "registration.list" && row.target === "registrations"));
  assert.ok(audit.some((row) => row.action === "admin.create" && row.target === "door@example.com"));
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

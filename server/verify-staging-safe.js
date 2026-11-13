import assert from "node:assert/strict";
import fs from "node:fs";
import { createEncryptedBackup } from "./backup.js";
import { openDatabase } from "./db.js";
import { recordSecurityEvent } from "./alerts.js";
import { paynamicsApiCallsAllowed } from "./paynamics.js";
import { sendEmail, sendSms } from "./providers.js";
import { sendMemberOtp, sendRegistrationOtp } from "./otp.js";
import { createRegistration } from "./registrations.js";
import {
  automaticBackupsSuppressed,
  ibmcStagingSafeModeEnabled,
  outboundEmailSuppressed,
  outboundSmsSuppressed,
} from "./staging-safe.js";

const originalFetch = global.fetch;
let fetchCalls = 0;

function clearIdentityEnv() {
  delete process.env.IBMC_DEPLOYMENT_ENV;
  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
  delete process.env.RAILWAY_PROJECT_ID;
}

delete process.env.IBMC_STAGING_SAFE_MODE;
assert.equal(ibmcStagingSafeModeEnabled(), false);
assert.equal(outboundEmailSuppressed({ to: "a@example.com" }), false);
assert.equal(automaticBackupsSuppressed(), false);

process.env.IBMC_STAGING_SAFE_MODE = "true";
clearIdentityEnv();

fetchCalls = 0;
global.fetch = async () => {
  fetchCalls += 1;
  throw new Error("fetch must not run in staging safe mode");
};

delete process.env.RESEND_API_KEY;
delete process.env.SEMAPHORE_API_KEY;
let email = await sendEmail({ to: "a@example.com", subject: "x", text: "y" });
assert.equal(email.status, "skipped");
assert.equal(email.error, "staging_safe_mode");
assert.equal(fetchCalls, 0);

let sms = await sendSms({ to: "09171234567", message: "hello" });
assert.equal(sms.status, "skipped");
assert.equal(sms.error, "staging_safe_mode");
assert.equal(fetchCalls, 0);

process.env.RESEND_API_KEY = "re_test_safe_mode";
email = await sendEmail({ to: "a@example.com", subject: "x", text: "y" });
assert.equal(email.status, "skipped");
assert.equal(email.error, "staging_safe_mode");

process.env.IBMC_DEPLOYMENT_ENV = "staging";
assert.equal(outboundEmailSuppressed({ to: "other@example.com", deliveryKind: "member_otp" }), false);
assert.equal(outboundEmailSuppressed({ to: "other@example.com", deliveryKind: "registration_otp" }), false);
delete process.env.RESEND_API_KEY;
email = await sendEmail({
  to: "other@example.com",
  subject: "x",
  text: "y",
  deliveryKind: "member_otp",
});
assert.equal(email.status, "skipped");
assert.equal(email.error, "provider_not_configured");

process.env.RAILWAY_ENVIRONMENT = "production";
process.env.RAILWAY_ENVIRONMENT_NAME = "production";
assert.equal(outboundEmailSuppressed({ to: "tj.tester@example.com", deliveryKind: "member_otp" }), false);
assert.equal(outboundEmailSuppressed({ to: "tj.tester@example.com", deliveryKind: "registration_otp" }), false);
process.env.RESEND_API_KEY = "re_test_safe_mode";
email = await sendEmail({
  to: "tj.tester@example.com",
  subject: "x",
  text: "y",
});
assert.equal(email.status, "skipped");
assert.equal(email.error, "staging_safe_mode");

process.env.RAILWAY_ENVIRONMENT = "staging";
process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
assert.equal(outboundSmsSuppressed(), true);

process.env.SEMAPHORE_API_KEY = "sem_test_safe_mode";
sms = await sendSms({ to: "09171234567", message: "hello" });
assert.equal(sms.status, "skipped");
assert.equal(sms.error, "staging_safe_mode");

const db = openDatabase(":memory:");
await recordSecurityEvent(db, "admin.login.fail", "safe-mode-test");
fetchCalls = 0;
for (let i = 0; i < 6; i += 1) {
  await recordSecurityEvent(db, "admin.login.fail", "threshold");
}
assert.equal(fetchCalls, 0);

assert.equal((await sendRegistrationOtp(db, "nobody@example.com")).status, 404);

db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();
createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Staging OTP",
  email: "tj.tester@example.com",
  mobile: "09179998877",
  registeredOn: "2026-11-12",
});
delete process.env.RESEND_API_KEY;
const allowedRegOtp = await sendRegistrationOtp(db, "tj.tester@example.com");
assert.notEqual(allowedRegOtp.status, 503);
assert.equal(allowedRegOtp.status, 502);
assert.equal((await sendRegistrationOtp(db, "blocked@example.com")).status, 404);
createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Other",
  email: "blocked@example.com",
  mobile: "09171112233",
  registeredOn: "2026-11-12",
});
const openRegOtp = await sendRegistrationOtp(db, "blocked@example.com");
assert.notEqual(openRegOtp.status, 503);
assert.equal(openRegOtp.status, 502);

email = await sendEmail({
  to: "tj.tester@example.com",
  subject: "reminder",
  text: "x",
  deliveryKind: "general",
});
assert.equal(email.status, "skipped");
assert.equal(email.error, "staging_safe_mode");

process.env.RESEND_API_KEY = "re_test_safe_mode";
email = await sendEmail({
  to: "tj.tester@example.com",
  subject: "IBMC 2027 · Your QR ticket",
  text: "QR ticket",
  deliveryKind: "entry_pass",
});
assert.notEqual(email.error, "staging_safe_mode");
assert.notEqual(email.status, "skipped");

assert.equal(outboundEmailSuppressed({ deliveryKind: "payment_confirmation" }), false);
email = await sendEmail({
  to: "tj.tester@example.com",
  subject: "IBMC 2027 · Payment received",
  text: "Payment received",
  deliveryKind: "payment_confirmation",
});
assert.notEqual(email.error, "staging_safe_mode");
assert.notEqual(email.status, "skipped");

delete process.env.RESEND_API_KEY;
email = await sendEmail({
  to: "blocked@example.com",
  subject: "otp",
  text: "x",
  deliveryKind: "registration_otp",
});
assert.equal(email.error, "provider_not_configured");

fetchCalls = 0;
process.env.BACKUP_ENCRYPTION_KEY = "a".repeat(64);
process.env.BACKUP_S3_ENDPOINT = "https://s3.example.test";
process.env.BACKUP_S3_BUCKET = "ibmc-backups";
process.env.BACKUP_S3_ACCESS_KEY_ID = "test-access";
process.env.BACKUP_S3_SECRET_ACCESS_KEY = "test-secret";
const backup = await createEncryptedBackup(db);
assert.equal(backup, null);
assert.equal(fetchCalls, 0);

process.env.PAYNAMICS_API_CALLS_ENABLED = "true";
process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED = "true";
process.env.PAYNAMICS_API_BASE_URL = "https://payin.payserv.net";
process.env.PAYNAMICS_API_ENV = "sandbox";
process.env.PAYNAMICS_BASIC_AUTH_USER = "u";
process.env.PAYNAMICS_BASIC_AUTH_PASSWORD = "p";
process.env.PAYNAMICS_MERCHANT_ID = "MID";
process.env.PAYNAMICS_MERCHANT_KEY = "key";
assert.equal(paynamicsApiCallsAllowed(), true);

global.fetch = originalFetch;

const httpDbPath = `/tmp/ibmc-verify-staging-otp-${process.pid}.sqlite`;
process.env.IBMC_STAGING_SAFE_MODE = "true";
process.env.IBMC_DEPLOYMENT_ENV = "staging";
process.env.RAILWAY_ENVIRONMENT = "staging";
process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
delete process.env.RESEND_API_KEY;
fs.rmSync(httpDbPath, { force: true });
process.env.IBMC_DB_PATH = httpDbPath;
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";
const httpDb = openDatabase(httpDbPath);
httpDb.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();
createRegistration(httpDb, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "HTTP OTP",
  email: "http-otp@example.com",
  mobile: "09176667788",
  registeredOn: "2026-11-12",
});
const { createApi } = await import("./api.js");
delete process.env.RESEND_API_KEY;
const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
try {
  let res = await fetch(`${base}/api/registrations/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "blocked@example.com" }),
  });
  assert.equal(res.status, 404);
  res = await fetch(`${base}/api/registrations/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "http-otp@example.com" }),
  });
  const regPayload = await res.json();
  assert.equal(res.status, 502);
  assert.equal(regPayload.error, "We couldn't send the code. Try again.");
  res = await fetch(`${base}/api/members/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "unknown-member" }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "Enter a valid email or mobile number.");
  res = await fetch(`${base}/api/members/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "missing.person@example.com" }),
  });
  assert.equal(res.status, 404);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(httpDbPath, { force: true });
  fs.rmSync(`${httpDbPath}-wal`, { force: true });
  fs.rmSync(`${httpDbPath}-shm`, { force: true });
}

delete process.env.IBMC_STAGING_SAFE_MODE;
delete process.env.IBMC_DB_PATH;
clearIdentityEnv();

console.log("Staging safe mode checks passed.");

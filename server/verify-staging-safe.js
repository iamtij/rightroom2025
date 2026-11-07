import assert from "node:assert/strict";
import { createEncryptedBackup } from "./backup.js";
import { openDatabase } from "./db.js";
import { recordSecurityEvent } from "./alerts.js";
import { paynamicsApiCallsAllowed } from "./paynamics.js";
import { sendEmail, sendSms } from "./providers.js";
import {
  automaticBackupsSuppressed,
  ibmcStagingSafeModeEnabled,
  outboundNotificationsSuppressed,
} from "./staging-safe.js";

const originalFetch = global.fetch;
let fetchCalls = 0;

delete process.env.IBMC_STAGING_SAFE_MODE;
assert.equal(ibmcStagingSafeModeEnabled(), false);
assert.equal(outboundNotificationsSuppressed(), false);
assert.equal(automaticBackupsSuppressed(), false);

process.env.IBMC_STAGING_SAFE_MODE = "true";
assert.equal(ibmcStagingSafeModeEnabled(), true);

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
assert.equal(fetchCalls, 0);

process.env.SEMAPHORE_API_KEY = "sem_test_safe_mode";
sms = await sendSms({ to: "09171234567", message: "hello" });
assert.equal(sms.status, "skipped");
assert.equal(sms.error, "staging_safe_mode");
assert.equal(fetchCalls, 0);

const db = openDatabase(":memory:");
await recordSecurityEvent(db, "admin.login.fail", "safe-mode-test");
fetchCalls = 0;
for (let i = 0; i < 6; i += 1) {
  await recordSecurityEvent(db, "admin.login.fail", "threshold");
}
assert.equal(fetchCalls, 0);

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
delete process.env.IBMC_STAGING_SAFE_MODE;

console.log("Staging safe mode checks passed.");

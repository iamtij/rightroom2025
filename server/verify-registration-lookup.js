import assert from "node:assert/strict";
import fs from "node:fs";
import { openDatabase } from "./db.js";
import { createRegistration } from "./registrations.js";
import {
  findRegistrationByContact,
  registrationMobileMatchesPhoneQuery,
  registrationPhoneKey,
  resolveRegistrationByContact,
} from "./registrations.js";
import { sendRegistrationOtp } from "./otp.js";

const VICTIM_MOBILE = "09171234567";
const VICTIM_KEY = registrationPhoneKey(VICTIM_MOBILE);
const ATTACKER_MOBILE = "09179999999";

assert.equal(registrationMobileMatchesPhoneQuery(VICTIM_MOBILE, VICTIM_KEY), true);
assert.equal(registrationMobileMatchesPhoneQuery(ATTACKER_MOBILE, VICTIM_KEY), false);

const db = openDatabase(":memory:");
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();

process.env.RAILWAY_ENVIRONMENT = "staging";
process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
process.env.IBMC_DEPLOYMENT_ENV = "staging";
process.env.IBMC_STAGING_SAFE_MODE = "true";
process.env.IBMC_STAGING_SAFE_MEMBERSHIP_OTP_ALLOWLIST = "victim.active@example.com,attacker.lonely@example.com";

createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Attacker Lonely",
  email: "attacker.lonely@example.com",
  mobile: ATTACKER_MOBILE,
  registeredOn: "2026-11-12",
});
db.prepare("UPDATE registrations SET phone_key = ? WHERE email = ?", [VICTIM_KEY, "attacker.lonely@example.com"]);

assert.equal(resolveRegistrationByContact(db, VICTIM_MOBILE).registration, null);
assert.equal((await sendRegistrationOtp(db, VICTIM_MOBILE)).status, 404);

createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Victim Cancelled",
  email: "victim.cancelled@example.com",
  mobile: VICTIM_MOBILE,
  registeredOn: "2020-01-01",
});
db.prepare("UPDATE registrations SET status = 'cancelled' WHERE email = ?").run("victim.cancelled@example.com");

assert.equal(resolveRegistrationByContact(db, VICTIM_MOBILE).registration, null);
assert.equal((await sendRegistrationOtp(db, VICTIM_MOBILE)).status, 404);

createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Victim Active",
  email: "victim.active@example.com",
  mobile: VICTIM_MOBILE,
  registeredOn: "2026-11-14",
});
assert.equal(findRegistrationByContact(db, VICTIM_MOBILE)?.email, "victim.active@example.com");
process.env.IBMC_STAGING_SAFE_MEMBERSHIP_OTP_ALLOWLIST = "victim.active@example.com";
const victimOtp = await sendRegistrationOtp(db, VICTIM_MOBILE);
assert.notEqual(victimOtp.status, 404);
assert.notEqual(victimOtp.status, 409);

const httpDbPath = `/tmp/ibmc-verify-lookup-http-${process.pid}.sqlite`;
fs.rmSync(httpDbPath, { force: true });
process.env.IBMC_DB_PATH = httpDbPath;
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";
process.env.IBMC_STAGING_SAFE_MEMBERSHIP_OTP_ALLOWLIST = "a@example.com,b@example.com";

const httpDb = openDatabase(httpDbPath);
httpDb.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();
createRegistration(httpDb, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "A",
  email: "a@example.com",
  mobile: VICTIM_MOBILE,
  registeredOn: "2026-11-12",
});
createRegistration(httpDb, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "B",
  email: "b@example.com",
  mobile: "09182222222",
  registeredOn: "2026-11-13",
});
httpDb.prepare("UPDATE registrations SET mobile = ?, phone_key = ? WHERE email = ?").run(
  VICTIM_MOBILE,
  VICTIM_KEY,
  "b@example.com",
);

assert.equal(resolveRegistrationByContact(httpDb, VICTIM_MOBILE).status, 409);

const { createApi } = await import("./api.js");
const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const res = await fetch(`${base}/api/registrations/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: VICTIM_MOBILE }),
  });
  assert.equal(res.status, 409);
  const verifyAmb = await fetch(`${base}/api/registrations/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: VICTIM_MOBILE, code: "000000" }),
  });
  assert.equal(verifyAmb.status, 409);
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(httpDbPath, { force: true });
  fs.rmSync(`${httpDbPath}-wal`, { force: true });
  fs.rmSync(`${httpDbPath}-shm`, { force: true });
}

delete process.env.IBMC_STAGING_SAFE_MODE;
delete process.env.IBMC_DB_PATH;
delete process.env.IBMC_DEPLOYMENT_ENV;
delete process.env.RAILWAY_ENVIRONMENT;
delete process.env.RAILWAY_ENVIRONMENT_NAME;
delete process.env.IBMC_STAGING_SAFE_MEMBERSHIP_OTP_ALLOWLIST;

console.log("Registration contact lookup checks passed.");

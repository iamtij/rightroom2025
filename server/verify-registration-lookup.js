import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { createRegistration } from "./registrations.js";
import {
  findRegistrationByContact,
  registrationPhoneKey,
  resolveRegistrationByContact,
} from "./registrations.js";
import { sendRegistrationOtp } from "./otp.js";
import { outboundEmailSuppressed } from "./staging-safe.js";

assert.equal(registrationPhoneKey("09171234567"), "9171234567");
assert.equal(registrationPhoneKey("+63 917 123 4567"), "9171234567");
assert.equal(registrationPhoneKey("639171234567"), "9171234567");
assert.equal(registrationPhoneKey("123"), "");

const db = openDatabase(":memory:");
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();

createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "TJ Primary",
  email: "tj.primary@example.com",
  mobile: "09171234567",
  registeredOn: "2026-11-12",
});

const byEmail = findRegistrationByContact(db, "tj.primary@example.com");
const byMobile = findRegistrationByContact(db, "09171234567");
assert.equal(byEmail?.id, byMobile?.id);
assert.equal(byEmail?.email, "tj.primary@example.com");

const staleId = byEmail.id;
db.prepare("UPDATE registrations SET phone_key = NULL WHERE id = ?").run(staleId);
assert.equal(findRegistrationByContact(db, "09171234567")?.id, staleId);
db.prepare("UPDATE registrations SET phone_key = ? WHERE id = ?").run(registrationPhoneKey("09171234567"), staleId);

process.env.IBMC_STAGING_SAFE_MODE = "true";
process.env.IBMC_DEPLOYMENT_ENV = "staging";
process.env.IBMC_STAGING_SAFE_MEMBERSHIP_OTP_ALLOWLIST = "tj.primary@example.com";
assert.equal(outboundEmailSuppressed({ to: byMobile.email, deliveryKind: "registration_otp" }), false);

const otpMobile = await sendRegistrationOtp(db, "+63 917 123 4567");
assert.notEqual(otpMobile.status, 503);
assert.notEqual(otpMobile.status, 409);
if (otpMobile.error) assert.equal(otpMobile.status, 502);
else assert.ok(otpMobile.maskedEmail || otpMobile.waited);

const legacy = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Legacy Dup",
  email: "other.staging@example.com",
  mobile: "09180001111",
  registeredOn: "2026-11-13",
});
db.prepare("UPDATE registrations SET phone_key = ? WHERE id = ?").run(registrationPhoneKey("09171234567"), legacy.id);

const ambiguous = resolveRegistrationByContact(db, "09171234567");
assert.equal(ambiguous.registration, null);
assert.equal(ambiguous.status, 409);
assert.match(ambiguous.error || "", /email or registration reference/i);

const otpAmbiguous = await sendRegistrationOtp(db, "09171234567");
assert.equal(otpAmbiguous.status, 409);

assert.equal(findRegistrationByContact(db, "other.staging@example.com")?.email, "other.staging@example.com");
const otpOtherEmail = await sendRegistrationOtp(db, "other.staging@example.com");
assert.equal(otpOtherEmail.status, 503);

delete process.env.IBMC_STAGING_SAFE_MODE;
delete process.env.IBMC_DEPLOYMENT_ENV;
delete process.env.IBMC_STAGING_SAFE_MEMBERSHIP_OTP_ALLOWLIST;

console.log("Registration contact lookup checks passed.");

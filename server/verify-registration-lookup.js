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

const activeId = byEmail.id;
db.prepare("UPDATE registrations SET phone_key = NULL WHERE id = ?").run(activeId);
assert.equal(findRegistrationByContact(db, "09171234567")?.id, activeId);

db.prepare(`
  INSERT INTO registrations (
    reference, product_id, payment_plan, full_name, email, mobile, phone_key,
    amount_due_cents, currency, status, registered_on, attendee_type, plan_status
  ) VALUES ('IBMC27-CANCEL1', 1, 'full', 'Cancelled Dup', 'old.cancelled@example.com', '09171234567', ?, 100, 'PHP', 'cancelled', '2020-01-01', 'guest', 'active')
`).run(registrationPhoneKey("09171234567"));
assert.equal(findRegistrationByContact(db, "09171234567")?.id, activeId);
assert.equal(findRegistrationByContact(db, "09171234567")?.email, "tj.primary@example.com");

db.prepare("UPDATE registrations SET phone_key = ? WHERE id = ?").run(registrationPhoneKey("09171234567"), activeId);

db.prepare("UPDATE registrations SET phone_key = ? WHERE id = ?").run("0000000000", activeId);
assert.equal(findRegistrationByContact(db, "09171234567")?.id, activeId);
db.prepare("UPDATE registrations SET phone_key = ? WHERE id = ?").run(registrationPhoneKey("09171234567"), activeId);

process.env.RAILWAY_ENVIRONMENT = "staging";
process.env.RAILWAY_ENVIRONMENT_NAME = "staging";
process.env.IBMC_DEPLOYMENT_ENV = "staging";
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

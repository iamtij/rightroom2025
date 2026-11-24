import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import {
  listMembers,
  memberRegisterOptions,
  registerMemberByAdmin,
  saveMember,
} from "./members.js";

const db = openDatabase(":memory:");
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01', sales_end = '2027-12-31', payments_open = 1 WHERE code = 'first_mover'").run();

db.prepare(`
  INSERT INTO admin_users (id, email, password_hash, role, totp_enabled)
  VALUES (1, 'admin@example.com', 'x', 'admin', 1)
`).run();

saveMember(db, {
  fullName: "Bank Member",
  email: "bank.member@example.com",
  mobile: "09171110001",
  chapter: "BNI Eagles",
  category: "Care",
  businessName: "Care Co",
  regStatus: "updated",
  country: "Philippines",
  goldClub: false,
});

const member = db.prepare("SELECT * FROM members WHERE email = ?").get("bank.member@example.com");
assert.ok(member?.id);

const listed = listMembers(db);
assert.equal(listed.find((row) => row.id === member.id)?.registrationReference, null);

const options = memberRegisterOptions(db, member.id);
assert.equal(options.error, undefined);
assert.equal(options.registration, null);
assert.equal(options.defaultProductCode, "first_mover");
assert.ok(options.products.some((product) => product.code === "first_mover" && product.allowsInstallment));

const missingRef = registerMemberByAdmin(db, member.id, {
  productCode: "first_mover",
  paymentPlan: "installment",
  sendEmail: false,
}, 1);
assert.equal(missingRef.status, 400);
assert.match(missingRef.error, /Bank reference/i);

const created = registerMemberByAdmin(db, member.id, {
  productCode: "first_mover",
  paymentPlan: "installment",
  bankReference: "UB-12345",
  paidOn: "2026-11-20",
  amountReceivedCents: 100_000,
  notes: "Over the counter deposit",
  sendEmail: false,
}, 1);
assert.equal(created.error, undefined);
assert.ok(created.registration?.reference);
assert.equal(created.registration.payment_plan, "installment");
assert.equal(created.registration.attendee_type, "member");
assert.equal(created.registration.balance_cents, 1_200_000);
assert.equal(created.registration.installments.filter((item) => item.status === "paid").length, 1);

const payment = db.prepare(`
  SELECT method, external_reference, notes, amount_cents, admin_user_id
  FROM payments
  WHERE registration_id = ?
`).get(created.registration.id);
assert.equal(payment.method, "bank");
assert.equal(payment.external_reference, "UB-12345");
assert.equal(payment.amount_cents, 100_000);
assert.equal(payment.admin_user_id, 1);
assert.match(payment.notes || "", /Paid on 2026-11-20/);
assert.match(payment.notes || "", /Over the counter deposit/);

const after = listMembers(db).find((row) => row.id === member.id);
assert.equal(after?.registrationReference, created.registration.reference);

const duplicate = registerMemberByAdmin(db, member.id, {
  productCode: "first_mover",
  paymentPlan: "full",
  bankReference: "UB-999",
  sendEmail: false,
}, 1);
assert.equal(duplicate.status, 409);
assert.equal(duplicate.reference, created.registration.reference);

saveMember(db, {
  fullName: "Full Pay Member",
  email: "full.pay@example.com",
  mobile: "09171110002",
  chapter: "BNI Eagles",
  category: "Care",
  businessName: "Care Co",
  regStatus: "updated",
  country: "Philippines",
  goldClub: false,
});
const fullMember = db.prepare("SELECT id FROM members WHERE email = ?").get("full.pay@example.com");
const full = registerMemberByAdmin(db, fullMember.id, {
  productCode: "first_mover",
  paymentPlan: "full",
  bankReference: "BDO-55",
  paidOn: "2026-11-21",
  sendEmail: false,
}, 1);
assert.equal(full.error, undefined);
assert.equal(full.registration.balance_cents, 0);
assert.equal(full.registration.plan_status, "fully_paid");
assert.ok(full.registration.qr_token);

saveMember(db, {
  fullName: "Gold Free Member",
  email: "gold.free@example.com",
  mobile: "09171110003",
  chapter: "BNI Eagles",
  category: "Care",
  businessName: "Care Co",
  regStatus: "updated",
  country: "Philippines",
  goldClub: true,
  sponsors2026: 6,
  sponsorsAugDec2026: 4,
  sponsorDataAsOf: "2026-11-12",
  goldReward: "GOLD_FREE",
});
const freeMember = db.prepare("SELECT id FROM members WHERE email = ?").get("gold.free@example.com");
const free = registerMemberByAdmin(db, freeMember.id, {
  productCode: "first_mover",
  paymentPlan: "full",
  sendEmail: false,
}, 1);
assert.equal(free.error, undefined);
assert.equal(free.registration.balance_cents, 0);
assert.equal(free.registration.gold_reward_current, "GOLD_FREE");
assert.equal(
  db.prepare("SELECT COUNT(*) AS n FROM payments WHERE registration_id = ?").get(free.registration.id).n,
  0,
);

console.log("verify-member-register: ok");

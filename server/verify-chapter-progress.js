import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { listChapterProgress, saveChapter } from "./chapters.js";
import { saveMember } from "./members.js";
import { createRegistration, recordPayment } from "./registrations.js";

const db = openDatabase(":memory:");
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01', sales_end = '2027-12-31', payments_open = 1 WHERE code = 'first_mover'").run();

saveChapter(db, { name: "BNI Eagles" });
saveChapter(db, { name: "BNI Titans" });
saveChapter(db, { name: "Empty Chapter" });

saveMember(db, {
  fullName: "Fully Paid",
  email: "paid@example.com",
  mobile: "09171110001",
  chapter: "BNI Eagles",
  regStatus: "updated",
});
saveMember(db, {
  fullName: "Installment Seat",
  email: "installment@example.com",
  mobile: "09171110002",
  chapter: "BNI Eagles",
  regStatus: "updated",
});
saveMember(db, {
  fullName: "Not Registered",
  email: "waiting@example.com",
  mobile: "09171110003",
  chapter: "BNI Eagles",
  regStatus: "updated",
});
saveMember(db, {
  fullName: "Other Chapter",
  email: "titans@example.com",
  mobile: "09171110004",
  chapter: "BNI Titans",
  regStatus: "updated",
});

const paid = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Fully Paid",
  email: "paid@example.com",
  mobile: "09171110001",
  chapter: "BNI Eagles",
  registeredOn: "2026-11-12",
});
recordPayment(db, {
  registrationId: paid.id,
  amountCents: paid.amount_due_cents || paid.installments?.[0]?.amount_cents || 1_500_000,
  method: "admin",
});

const installment = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "installment",
  fullName: "Installment Seat",
  email: "installment@example.com",
  mobile: "09171110002",
  chapter: "BNI Eagles",
  registeredOn: "2026-11-12",
});
recordPayment(db, {
  registrationId: installment.id,
  amountCents: installment.installments.find((row) => row.status === "due")?.amount_cents || installment.installments[0].amount_cents,
  method: "admin",
});

const progress = listChapterProgress(db);
const eagles = progress.find((row) => row.name === "BNI Eagles");
const titans = progress.find((row) => row.name === "BNI Titans");
const empty = progress.find((row) => row.name === "Empty Chapter");

assert.ok(eagles);
assert.equal(eagles.total, 3);
assert.equal(eagles.registered, 2);
assert.equal(eagles.percent, 67);
assert.deepEqual(eagles.members.map((row) => [row.fullName, row.planLabel, Boolean(row.registeredAt)]), [
  ["Fully Paid", "Fully paid", true],
  ["Installment Seat", "Installment", true],
  ["Not Registered", "Not registered", false],
]);

assert.ok(titans);
assert.equal(titans.total, 1);
assert.equal(titans.registered, 0);
assert.equal(titans.percent, 0);
assert.equal(titans.members.length, 1);
assert.equal(titans.members[0].planLabel, "Not registered");

assert.ok(empty);
assert.equal(empty.total, 0);
assert.equal(empty.registered, 0);
assert.equal(empty.percent, null);
assert.equal(empty.members.length, 0);

assert.equal(progress[0].name, "BNI Eagles");

console.log("chapter progress ok");

import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { createRegistration, recordPayment } from "./registrations.js";
import { runReminders } from "./reminders.js";
import { philippineMobile } from "./providers.js";
import { addDays, manilaParts } from "./time.js";

delete process.env.RESEND_API_KEY;
delete process.env.SEMAPHORE_API_KEY;

const db = openDatabase(":memory:");
const today = manilaParts().date;

const rules = db.prepare("SELECT * FROM reminder_rules WHERE trigger = 'before_due' ORDER BY channel, days_before DESC").all();
assert.deepEqual(rules.filter((rule) => rule.channel === "email").map((rule) => rule.days_before), [7, 3, 1, 0]);
assert.deepEqual(rules.filter((rule) => rule.channel === "sms").map((rule) => rule.days_before), [3, 1, 0]);

const mover = db.prepare("SELECT id FROM ticket_products WHERE code = 'first_mover'").get();
const moverItems = db.prepare("SELECT * FROM installment_plan_items WHERE product_id = ? ORDER BY sequence").all(mover.id);
assert.equal(moverItems.length, 7);
assert.equal(moverItems.reduce((sum, item) => sum + item.amount_cents, 0), 1_300_000);
assert.equal(moverItems[0].amount_cents, 100_000);

const early = db.prepare("SELECT id FROM ticket_products WHERE code = 'early_bird'").get();
const earlyItems = db.prepare("SELECT amount_cents FROM installment_plan_items WHERE product_id = ? ORDER BY sequence").all(early.id);
assert.equal(earlyItems.length, 5);
assert.equal(earlyItems.reduce((sum, item) => sum + item.amount_cents, 0), 1_600_000);
assert.equal(earlyItems[0].amount_cents, 400_000);

const partial = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "installment",
  fullName: "Amina Cruz",
  email: "amina@example.com",
  mobile: "09171234567",
  registeredOn: "2026-11-12",
});
assert.equal(partial.installments[0].due_on, "2026-11-12");
assert.equal(partial.installments[0].amount_cents, 100_000);
assert.equal(partial.qr_token, null);

recordPayment(db, { registrationId: partial.id, amountCents: 100_000, method: "manual" });
const stillOpen = db.prepare("SELECT qr_token FROM registrations WHERE id = ?").get(partial.id);
assert.equal(stillOpen.qr_token, null);

const nextDue = db.prepare("SELECT id FROM registration_installments WHERE registration_id = ? AND status = 'due' ORDER BY sequence").get(partial.id);
db.prepare("UPDATE registration_installments SET due_on = ? WHERE id = ?").run(addDays(today, 3), nextDue.id);
db.prepare("UPDATE reminder_rules SET send_time = '00:00' WHERE trigger = 'before_due'").run();

await runReminders(db, new Date());
const reminderRows = db.prepare("SELECT channel, body, html, includes_qr, status FROM reminder_dispatches WHERE registration_id = ?").all(partial.id);
assert.equal(reminderRows.length, 2);
assert.deepEqual(reminderRows.map((row) => row.channel).sort(), ["email", "sms"]);
for (const row of reminderRows) {
  assert.equal(row.includes_qr, 0);
  assert.equal(row.status, "skipped");
  assert.equal(`${row.body}\n${row.html || ""}`.includes("/pass/"), false);
  assert.equal(`${row.body}\n${row.html || ""}`.toLowerCase().includes("<svg"), false);
}

assert.equal(philippineMobile("+63 917 123 4567"), "09171234567");
assert.equal(philippineMobile("9171234567"), "09171234567");
assert.equal(philippineMobile("123"), null);

const again = await runReminders(db, new Date());
assert.equal(again, 0);
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reminder_dispatches WHERE registration_id = ?").get(partial.id).count, 2);

const reminded = db.prepare("SELECT installment_id FROM reminder_dispatches WHERE registration_id = ? AND template_key = 'installment_reminder'").get(partial.id);
recordPayment(db, { registrationId: partial.id, installmentId: reminded.installment_id, amountCents: 200_000 });
db.prepare("UPDATE registration_installments SET due_on = ? WHERE id = ?").run(today, reminded.installment_id);
await runReminders(db, new Date());
assert.equal(
  db.prepare("SELECT COUNT(*) AS count FROM reminder_dispatches WHERE installment_id = ? AND template_key = 'installment_reminder'").get(reminded.installment_id).count,
  2,
);

const stillDue = db.prepare(`
  SELECT id, amount_cents - amount_paid_cents AS remaining
  FROM registration_installments
  WHERE registration_id = ? AND status = 'due'
`).all(partial.id);
let finishing = null;
for (const item of stillDue) {
  finishing = recordPayment(db, { registrationId: partial.id, installmentId: item.id, amountCents: item.remaining });
}
assert.equal(finishing.balance_cents, 0);
assert.ok(finishing.qr_token);

const paidUpFront = createRegistration(db, {
  productCode: "regular",
  paymentPlan: "full",
  fullName: "Leo Santos",
  email: "leo@example.com",
  mobile: "09181234567",
  registeredOn: "2027-02-02",
});
assert.equal(paidUpFront.qr_token, null);
const settled = recordPayment(db, { registrationId: paidUpFront.id, amountCents: 1_800_000, method: "manual" });
assert.equal(settled.balance_cents, 0);
assert.ok(settled.qr_token);

await runReminders(db, new Date());
const passes = db.prepare(`
  SELECT registration_id, channel, includes_qr, status, html, body
  FROM reminder_dispatches
  WHERE template_key = 'entry_pass'
  ORDER BY registration_id, channel
`).all();
assert.equal(passes.length, 4);
for (const pass of passes) {
  assert.equal(pass.includes_qr, 1);
  assert.equal(pass.status, "skipped");
  const registration = db.prepare("SELECT qr_token FROM registrations WHERE id = ?").get(pass.registration_id);
  assert.equal(`${pass.body}\n${pass.html || ""}`.includes(`/pass/${registration.qr_token}`), true);
}

const unpaidFull = createRegistration(db, {
  productCode: "early_bird",
  paymentPlan: "full",
  fullName: "Nia Reyes",
  email: "nia@example.com",
  mobile: "09191234567",
  registeredOn: "2026-12-02",
});
assert.equal(unpaidFull.qr_token, null);
await runReminders(db, new Date());
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reminder_dispatches WHERE registration_id = ? AND template_key = 'entry_pass'").get(unpaidFull.id).count, 0);

const testProduct = db.prepare("SELECT * FROM ticket_products WHERE code = 'test_200'").get();
assert.equal(testProduct.full_price_cents, 20_000);
assert.equal(testProduct.installment_total_cents, 20_000);
assert.equal(testProduct.allows_installment, 1);
const testPlan = db.prepare("SELECT kind, days_after, amount_cents FROM installment_plan_items WHERE product_id = ? ORDER BY sequence").all(testProduct.id);
assert.deepEqual(testPlan, [
  { kind: "on_registration", days_after: null, amount_cents: 10_000 },
  { kind: "days_after", days_after: 2, amount_cents: 5_000 },
  { kind: "days_after", days_after: 3, amount_cents: 5_000 },
]);

const testFull = createRegistration(db, {
  productCode: "test_200",
  paymentPlan: "full",
  fullName: "Full Test",
  email: "full-test-200@example.com",
  mobile: "09170000001",
  registeredOn: today,
});
assert.equal(testFull.amount_due_cents, 20_000);
assert.equal(testFull.installments.length, 1);
assert.equal(testFull.installments[0].amount_cents, 20_000);
assert.equal(testFull.installments[0].kind, "full");

const testPlanReg = createRegistration(db, {
  productCode: "test_200",
  paymentPlan: "installment",
  fullName: "Installment Test",
  email: "installment-test-200@example.com",
  mobile: "09170000002",
  registeredOn: today,
});
assert.equal(testPlanReg.amount_due_cents, 20_000);
assert.deepEqual(testPlanReg.installments.map((item) => [item.kind, item.due_on, item.amount_cents]), [
  ["on_registration", today, 10_000],
  ["days_after", addDays(today, 2), 5_000],
  ["days_after", addDays(today, 3), 5_000],
]);

function manilaClock(isoDate) {
  return new Date(`${isoDate}T01:00:00.000Z`);
}

await runReminders(db, manilaClock(addDays(today, 1)));
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reminder_dispatches WHERE registration_id = ?").get(testPlanReg.id).count, 0);

const anchored = recordPayment(db, { registrationId: testPlanReg.id, amountCents: 10_000, method: "manual" });
assert.equal(anchored.installments[0].status, "paid");
assert.equal(anchored.installments[1].due_on, addDays(today, 2));
assert.equal(anchored.installments[2].due_on, addDays(today, 3));

await runReminders(db, manilaClock(addDays(today, 1)));
const firstReminder = db.prepare("SELECT channel, subject, body, html, includes_qr, status FROM reminder_dispatches WHERE registration_id = ?").all(testPlanReg.id);
assert.equal(firstReminder.length, 1);
assert.equal(firstReminder[0].channel, "email");
assert.equal(firstReminder[0].includes_qr, 0);
assert.equal(firstReminder[0].status, "skipped");
assert.match(firstReminder[0].subject, /₱50 due tomorrow · 2 of 3/);
assert.match(firstReminder[0].body, /Day 0 ₱100, Day 2 ₱50, Day 3 ₱50/);
assert.equal(`${firstReminder[0].body}\n${firstReminder[0].html}`.includes("/pass/"), false);

await runReminders(db, manilaClock(addDays(today, 2)));
const bothReminders = db.prepare("SELECT channel, subject FROM reminder_dispatches WHERE registration_id = ? ORDER BY id").all(testPlanReg.id);
assert.deepEqual(bothReminders, [
  { channel: "email", subject: firstReminder[0].subject },
  { channel: "email", subject: "IBMC 2027 · ₱50 due tomorrow · 3 of 3" },
]);

const shifted = createRegistration(db, {
  productCode: "test_200",
  paymentPlan: "installment",
  fullName: "Late Payer",
  email: "late-test-200@example.com",
  mobile: "09170000003",
  registeredOn: addDays(today, -4),
});
assert.equal(shifted.installments[1].due_on, addDays(today, -2));
const restarted = recordPayment(db, { registrationId: shifted.id, amountCents: 10_000, method: "manual" });
assert.equal(restarted.installments[1].due_on, addDays(today, 2));
assert.equal(restarted.installments[2].due_on, addDays(today, 3));
await runReminders(db, manilaClock(addDays(today, 1)));
const shiftedMail = db.prepare("SELECT subject FROM reminder_dispatches WHERE registration_id = ?").all(shifted.id);
assert.deepEqual(shiftedMail.map((row) => row.subject), ["IBMC 2027 · ₱50 due tomorrow · 2 of 3"]);

console.log("Reminder checks passed.");

import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { createRegistration, recordPayment } from "./registrations.js";
import { runReminders, syncBuiltinSchedule } from "./reminders.js";
import { philippineMobile } from "./providers.js";
import { addDays, manilaParts } from "./time.js";
import { ENTRY_PASS_BODY, ENTRY_PASS_SUBJECT, INSTALLMENT_REMINDER_BODY, INSTALLMENT_REMINDER_SUBJECT, previewTemplate, renderInstallmentReminder, smsCreditCount } from "./templates.js";

delete process.env.RESEND_API_KEY;
delete process.env.SEMAPHORE_API_KEY;
process.env.ALLOW_TEST_REGISTRATION = "true";
process.env.IBMC_STAGING_EARLY_PAYMENTS = "true";
process.env.IBMC_DEPLOYMENT_ENV = "staging";

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
await new Promise((resolve) => setTimeout(resolve, 150));
const confirmDispatch = db.prepare(`
  SELECT template_key, subject, includes_qr, status
  FROM reminder_dispatches WHERE registration_id = ? AND template_key = 'payment_confirmation'
  ORDER BY id DESC LIMIT 1
`).get(partial.id);
assert.ok(confirmDispatch);
assert.equal(confirmDispatch.includes_qr, 0);
assert.match(confirmDispatch.subject, /Payment received/);
assert.equal(confirmDispatch.status, "skipped");

const nextDue = db.prepare("SELECT id FROM registration_installments WHERE registration_id = ? AND status = 'due' ORDER BY sequence").get(partial.id);
db.prepare("UPDATE registration_installments SET due_on = ? WHERE id = ?").run(addDays(today, 3), nextDue.id);
db.prepare("UPDATE reminder_rules SET send_time = '00:00' WHERE trigger = 'before_due'").run();

await runReminders(db, new Date());
const reminderRows = db.prepare("SELECT channel, body, html, includes_qr, status FROM reminder_dispatches WHERE registration_id = ? AND template_key = 'installment_reminder'").all(partial.id);
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
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM reminder_dispatches WHERE registration_id = ? AND template_key = 'installment_reminder'").get(partial.id).count, 2);

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
const firstReminder = db.prepare("SELECT channel, subject, body, html, includes_qr, status FROM reminder_dispatches WHERE registration_id = ? AND template_key = 'installment_reminder'").all(testPlanReg.id);
assert.equal(firstReminder.length, 1);
assert.equal(firstReminder[0].channel, "email");
assert.equal(firstReminder[0].includes_qr, 0);
assert.equal(firstReminder[0].status, "skipped");
assert.match(firstReminder[0].subject, /₱50 due tomorrow · 2 of 3/);
assert.match(firstReminder[0].body, /Day 0 ₱100, Day 2 ₱50, Day 3 ₱50/);
assert.equal(`${firstReminder[0].body}\n${firstReminder[0].html}`.includes("/pass/"), false);

await runReminders(db, manilaClock(addDays(today, 2)));
const bothReminders = db.prepare("SELECT channel, subject FROM reminder_dispatches WHERE registration_id = ? AND template_key = 'installment_reminder' ORDER BY id").all(testPlanReg.id);
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
const shiftedMail = db.prepare("SELECT subject FROM reminder_dispatches WHERE registration_id = ? AND template_key = 'installment_reminder'").all(shifted.id);
assert.deepEqual(shiftedMail.map((row) => row.subject), ["IBMC 2027 · ₱50 due tomorrow · 2 of 3"]);

const builtinSchedules = db.prepare(`
  SELECT s.system_key, s.trigger, t.name AS template_name
  FROM message_schedules s
  JOIN message_templates t ON t.id = s.template_id
  WHERE s.system_key IS NOT NULL
  ORDER BY s.system_key
`).all();
assert.equal(builtinSchedules.length, 9);
assert.ok(builtinSchedules.some((row) => row.system_key === "fully_paid_email" && row.trigger === "fully_paid" && row.template_name === "QR ticket email"));
assert.ok(builtinSchedules.some((row) => row.system_key === "before_due_sms_0" && row.template_name === "Payment reminder SMS"));

const editedRegistration = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "installment",
  fullName: "Edit Reminder",
  email: "edit-reminder@example.com",
  mobile: "09170000009",
  registeredOn: "2026-11-12",
});
recordPayment(db, { registrationId: editedRegistration.id, amountCents: 100_000, method: "manual" });
const editedInstallment = db.prepare("SELECT id FROM registration_installments WHERE registration_id = ? AND status = 'due' ORDER BY sequence").get(editedRegistration.id);
db.prepare("UPDATE registration_installments SET due_on = ? WHERE id = ?").run(addDays(today, 1), editedInstallment.id);
db.prepare("UPDATE message_templates SET subject = 'Edited {{amount}} {{when}}' WHERE system_key = 'installment_reminder_email'").run();
await runReminders(db, new Date());
const editedMails = db.prepare("SELECT channel, subject FROM reminder_dispatches WHERE installment_id = ? ORDER BY channel").all(editedInstallment.id);
assert.deepEqual(editedMails, [
  { channel: "email", subject: "Edited ₱2,000 due tomorrow · 2 of 7" },
  { channel: "sms", subject: "IBMC 2027 · ₱2,000 due tomorrow · 2 of 7" },
]);

const week = db.prepare("SELECT * FROM message_schedules WHERE system_key = 'before_due_email_7'").get();
const moved = syncBuiltinSchedule(db, week, { name: "One week before", templateId: week.template_id, daysOffset: 6, sendTime: "08:15" });
assert.equal(moved.error, undefined);
assert.equal(db.prepare("SELECT days_before, send_time FROM reminder_rules WHERE id = (SELECT id FROM reminder_rules WHERE channel = 'email' AND trigger = 'before_due' AND days_before = 6)").get().send_time, "08:15");
const movedRow = db.prepare("SELECT * FROM message_schedules WHERE id = ?").get(week.id);
assert.equal(movedRow.system_key, "before_due_email_6");
assert.equal(movedRow.days_offset, 6);
const smsTemplate = db.prepare("SELECT id FROM message_templates WHERE system_key = 'installment_reminder_sms'").get();
assert.equal(syncBuiltinSchedule(db, movedRow, { name: "One week before", templateId: smsTemplate.id, daysOffset: 6, sendTime: "08:15" }).error, "Choose a template for the same channel");
assert.equal(syncBuiltinSchedule(db, movedRow, { name: "One week before", templateId: week.template_id, daysOffset: 3, sendTime: "08:15" }).error, "A reminder already sends that many days before the due date");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM schedule_sends").get().count, 0);

const reminderPreview = previewTemplate({ channel: "email", subject: INSTALLMENT_REMINDER_SUBJECT, body: INSTALLMENT_REMINDER_BODY, systemKey: "installment_reminder_email" });
assert.match(reminderPreview.subject, /₱2,000 due in 3 days · 2 of 7/);
assert.match(reminderPreview.html, /Pay this installment/);
assert.equal(reminderPreview.html.includes("/pass/"), false);
const passPreview = previewTemplate({ channel: "email", subject: ENTRY_PASS_SUBJECT, body: ENTRY_PASS_BODY, systemKey: "entry_pass_email" });
assert.match(passPreview.html, /data:image\/svg\+xml/);
assert.match(passPreview.body, /Maria/);
const customPreview = previewTemplate({ channel: "sms", subject: "", body: "Hi {{first_name}}, {{amount}} is {{when}}.", systemKey: "" });
assert.equal(customPreview.body, "Hi Maria, ₱2,000 is due in 3 days.");
const customEmail = previewTemplate({
  channel: "email",
  subject: "IBMC 2027 payment reminder",
  body: "Hi {{first_name}}, {{amount}} is due {{due_date}}. Pay: {{pay_url}}",
  systemKey: "",
});
assert.match(customEmail.html, /ibmc-2027-logo\.png/);
assert.match(customEmail.html, /IBMC 2027 payment reminder/);
assert.match(customEmail.html, /Hi Maria, ₱2,000 is due Mar 15, 2027\. Pay: https:\/\/ibmcph\.com\/pay\/IBMC-2048/);
assert.match(customEmail.html, /Pay this installment/);
assert.match(customEmail.html, /Amplify others\. Get amplified\./);
assert.equal(customEmail.html.includes("Open my QR ticket"), false);
const plainEmail = previewTemplate({ channel: "email", subject: "Hello", body: "Hi {{first_name}}", systemKey: "" });
assert.match(plainEmail.html, /ibmc-2027-logo\.png/);
assert.equal(plainEmail.html.includes("Pay this installment"), false);
const firstMoverReminder = renderInstallmentReminder({
  registration: { full_name: "Maria Santos", product_name: "First Mover", product_code: "first_mover", currency: "PHP", reference: "IBMC-2048", payment_plan: "installment", installment_count: 7 },
  installment: { amount_cents: 200_000, amount_paid_cents: 0, due_on: "2027-03-15", sequence: 2 },
  daysBefore: 3,
  payUrl: "https://ibmcph.com/pay/IBMC-2048",
  template: { subject: INSTALLMENT_REMINDER_SUBJECT, body: "{{plan_note}}\nHi {{first_name}}" },
});
assert.equal(firstMoverReminder.body, "Hi Maria");
const planNotePreview = previewTemplate({
  channel: "sms",
  subject: "",
  body: "{{plan_note}}\nHi {{first_name}}, {{amount}} for your {{product}} seat is {{when}}.",
  systemKey: "installment_reminder_sms",
});
assert.match(planNotePreview.body, /^Counted from the day you paid: Day 0 ₱100/);
assert.match(planNotePreview.body, /Hi Maria, ₱2,000 for your First Mover seat is due in 3 days\.$/);
assert.deepEqual(smsCreditCount("x".repeat(161)), { characters: 161, credits: 1 });
assert.equal(smsCreditCount("x".repeat(162)).credits, 2);
assert.equal(smsCreditCount("").credits, 0);
assert.equal(smsCreditCount(planNotePreview.body).characters, Array.from(planNotePreview.body).length);

console.log("Reminder checks passed.");

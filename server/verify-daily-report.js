import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { cancelRegistration, createRegistration, recordPayment } from "./registrations.js";
import { buildDailyReport, runDailyReport, runRegistrationPoster } from "./daily-report.js";
import { renderDailyReport } from "./daily-report-email.js";
import { buildRegistrationPoster, renderRegistrationPoster } from "./registration-poster.js";

const asOf = new Date("2026-11-11T01:00:00.000Z");
const db = openDatabase(":memory:");

const empty = buildDailyReport(db, asOf);
assert.equal(empty.seatsConfirmed, 0);
assert.equal(empty.overdueAlert, false);
assert.equal(empty.health.total, 0);
assert.equal(empty.tickets.length, 5);
assert.equal(empty.tickets.find((ticket) => ticket.code === "first_mover").phaseLabel, "Open · ends Nov 30");
assert.equal(empty.tickets.find((ticket) => ticket.code === "early_bird").phaseLabel, "Opens Dec 1");
assert.ok(empty.notes.some((note) => note.includes("First Mover is open through Nov 30")));
assert.ok(empty.notes.some((note) => note.includes("Early Bird (₱15,000 / ₱16,000) opens Dec 1")));
assert.ok(empty.notes.some((note) => note.includes("Next installment date is Dec 15. Reminders go out Dec 8.")));
const emptyMail = renderDailyReport(empty);
assert.equal(emptyMail.subject, "IBMC 2027 Sales Report · November 11, 2026");
assert.match(emptyMail.html, /Sales Report/);
assert.match(emptyMail.html, /No peso payments yet/);
assert.match(emptyMail.html, /No one reaches the Regular price within the next 3 days/);
assert.equal(emptyMail.html.includes("height:5px;background:#CF2030"), false);
assert.equal(emptyMail.html.includes("Example data"), false);
assert.equal(emptyMail.html.includes("display:flex"), false);
assert.equal(emptyMail.html.includes("grid-template"), false);
assert.match(emptyMail.html, /<html lang="en">/);

function installment(name, email, mobile, chapter) {
  return createRegistration(db, {
    productCode: "first_mover",
    paymentPlan: "installment",
    fullName: name,
    email,
    mobile,
    registeredOn: "2026-11-11",
    chapter,
  });
}

function payFirst(registration, method, externalReference) {
  return recordPayment(db, {
    registrationId: registration.id,
    amountCents: 100_000,
    method,
    externalReference,
  });
}

function setSecondDue(registration, dueOn) {
  db.prepare("UPDATE registration_installments SET due_on = ? WHERE registration_id = ? AND sequence = 2").run(dueOn, registration.id);
}

const onTrack = payFirst(installment("Ana Cruz", "ana@example.com", "09171000001"), "upay:instapay");
const second = onTrack.installments.find((item) => item.sequence === 2);
recordPayment(db, {
  registrationId: onTrack.id,
  installmentId: second.id,
  amountCents: 30_000,
  method: "paynamics",
  externalReference: "pn-window",
});
db.prepare(`
  INSERT INTO paynamics_payments (
    registration_id, installment_id, request_id, amount_cents, currency, status, payment_channel
  ) VALUES (?, ?, 'pn-window', 30000, 'PHP', 'paid', 'gcash')
`).run(onTrack.id, second.id);

setSecondDue(payFirst(installment("Bea Santos", "bea@example.com", "09171000002"), "upay:instapay"), "2026-11-16");
setSecondDue(payFirst(installment("Carlo Reyes", "carlo@example.com", "09171000003"), "upay:instapay"), "2026-11-09");
setSecondDue(payFirst(installment("Joy Dizon", "joy@example.com", "09171000004", "BNI Legacy"), "upay:instapay"), "2026-10-28");
setSecondDue(payFirst(installment("Paolo Lim", "paolo@example.com", "09171000005"), "upay:instapay"), "2026-10-26");

const fresh = installment("Nia Flores", "nia@example.com", "09171000006");
const comp = payFirst(installment("Liza Ong", "liza@example.com", "09171000007"), "comp");
const paidFull = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Marco Ruiz",
  email: "marco@example.com",
  mobile: "09171000008",
  registeredOn: "2026-11-11",
});
recordPayment(db, { registrationId: paidFull.id, amountCents: 1_200_000, method: "manual" });

const cancelled = installment("Ken Bautista", "ken@example.com", "09171000009");
cancelRegistration(db, cancelled.id);
db.prepare("INSERT INTO admin_audit (action, target, created_at) VALUES ('registration.cancel', ?, '2026-11-10 05:00:00')").run(cancelled.reference);

db.prepare("UPDATE registrations SET created_at = '2026-11-01 00:00:00'").run();
db.prepare("UPDATE payments SET recorded_at = '2026-11-01 00:00:00'").run();
db.prepare("UPDATE registrations SET created_at = '2026-11-10 08:00:00' WHERE id = ?").run(fresh.id);
db.prepare("UPDATE payments SET recorded_at = '2026-11-10 06:00:00' WHERE external_reference = 'pn-window'").run();
db.prepare("UPDATE payments SET recorded_at = '2026-11-10 07:00:00' WHERE registration_id = ?").run(comp.id);

const report = buildDailyReport(db, asOf);
assert.equal(report.seatsConfirmed, 8);
assert.equal(report.cancelledToDate, 1);
assert.equal(report.activity.registrations, 1);
assert.equal(report.activity.paymentCount, 1);
assert.equal(report.activity.collected.PHP, 30_000);
assert.equal(report.activity.cancellations, 1);
assert.equal(report.activity.reached15, 1);
assert.equal(report.collected.PHP, 1_730_000);
assert.equal(report.scheduled.PHP, 7_870_000);
assert.equal(report.overdue.PHP, 600_000);
assert.equal(report.overdueRegistrations, 3);
assert.equal(report.late15, 1);
assert.equal(report.overdueAlert, true);
assert.equal(report.health.total, 7);
assert.deepEqual(report.health.bands.map((band) => [band.key, band.count]), [
  ["track", 2],
  ["soon", 2],
  ["nudge", 1],
  ["call", 0],
  ["escalate", 1],
  ["day15", 1],
]);
assert.equal(report.health.atRisk.length, 1);
const firstMover = report.tickets.find((ticket) => ticket.code === "first_mover");
assert.equal(firstMover.paidFull, 1);
assert.equal(firstMover.paidFullCents, 1_200_000);
assert.equal(firstMover.installment, 7);
assert.equal(firstMover.installmentCents, 530_000);
assert.equal(report.fullyPaid, 1);
assert.equal(report.totals.PHP.paidFull, 1);
assert.equal(report.totals.PHP.paidFullCents, 1_200_000);
assert.equal(report.totals.PHP.installmentCents, 530_000);
assert.deepEqual(report.chapters, [{ name: "BNI Legacy", count: 1 }]);
assert.equal(report.health.atRisk[0].name, "Joy Dizon");
assert.equal(report.health.atRisk[0].chapter, "BNI Legacy");
assert.equal(report.health.atRisk[0].daysLate, 14);
assert.equal(report.health.atRisk[0].movesOn, "2026-11-13");
assert.equal(report.health.atRisk[0].cents, 200_000);
assert.deepEqual(report.methods.map((method) => [method.label, method.cents, method.percent]), [
  ["Manual", 1_200_000, 69],
  ["InstaPay", 500_000, 29],
  ["GCash", 30_000, 2],
]);

const mail = renderDailyReport(report);
assert.match(mail.html, /As of Wednesday, November 11, 2026 · 9:00 AM \(PHT\)/);
assert.match(mail.html, /Covers Nov 10, 9:00 AM to Nov 11, 9:00 AM/);
assert.match(mail.html, /₱17,300/);
assert.match(mail.html, /₱78,700/);
assert.match(mail.html, /₱6,000/);
assert.match(mail.html, /3 registrations behind · 1 moved to the Regular price/);
assert.match(mail.html, /Joy Dizon/);
assert.match(mail.html, /By chapter/);
assert.match(mail.html, /BNI Legacy/);
assert.equal(mail.html.includes("Cancellations are not included"), false);
assert.match(mail.html, />Total</);
assert.match(mail.html, /14 days/);
assert.match(mail.html, /Nov 13/);
assert.match(mail.html, /More than 15 days late · Regular price/);
assert.match(mail.html, /Moved to Regular price/);
assert.equal(mail.html.includes("height:5px;background:#CF2030"), false);
assert.equal(mail.html.includes("Complimentary"), false);
assert.equal(mail.html.includes("No peso payments yet"), false);
assert.match(mail.text, /Joy Dizon, BNI Legacy/);
assert.match(mail.html, /Full paid/);
assert.match(mail.html, /Installments/);
assert.match(mail.html, /₱12,000 · 1/);
assert.match(mail.html, /₱5,300 · 7/);
assert.match(mail.text, /full paid ₱12,000 · 1/);
assert.match(mail.text, /Total \(PHP\): 8 seats/);
const countMail = renderDailyReport({
  ...report,
  omitSales: true,
  firstMovers: 8,
  notes: ["Seat counts only."],
  healthHint: "Installment health.",
  roster: { total: 3, updated: "2", delayed: 1, firstMovers: 1 },
});
assert.match(countMail.html, /IBMC 2027 Report/);
assert.equal(countMail.html.includes("₱"), false);
assert.equal(countMail.html.includes("USD "), false);
assert.match(countMail.text, /full paid 1 · installments 7/);
const posterModel = buildRegistrationPoster(db, asOf);
assert.equal(posterModel.paid, 8);
assert.equal(posterModel.fullPaid, 1);
assert.equal(posterModel.installments, 7);
assert.equal(posterModel.sinceYesterday, 1);
assert.equal(posterModel.daysLeft, 19);
assert.equal(posterModel.bannerTitle, "First Mover · ₱12,000");
assert.match(posterModel.bannerNote, /Ends Nov 30 · Early Bird is ₱15,000/);
assert.deepEqual(posterModel.chapters, [{ name: "BNI Legacy", count: 1 }]);
const poster = await renderRegistrationPoster(posterModel);
assert.equal(poster.subject, "IBMC 2027 Registration update · Nov 11, 2026");
assert.equal(poster.filename, "IBMC-2027-registration-update.jpg");
assert.equal(poster.jpeg[0], 0xff);
assert.equal(poster.jpeg[1], 0xd8);
assert.match(poster.html, /cid:registration-poster/);
assert.match(poster.text, /Paid registrations: 8/);
assert.match(poster.text, /BNI Legacy: 1/);

const previousKey = process.env.RESEND_API_KEY;
delete process.env.RESEND_API_KEY;
try {
  const identityKeys = ["IBMC_DEPLOYMENT_ENV", "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID"];
  const savedIdentity = identityKeys.map((key) => [key, process.env[key]]);
  for (const key of identityKeys) delete process.env[key];
  const blocked = await runDailyReport(db, new Date("2026-11-11T01:10:00.000Z"));
  assert.equal(blocked.status, "skipped");
  assert.equal(blocked.reason, "not_production");
  for (const [key, value] of savedIdentity) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const none = await runDailyReport(db, new Date("2026-11-11T01:10:00.000Z"), { to: [] });
  assert.equal(none.status, "skipped");
  assert.equal(none.reason, "no_recipients");

  const waiting = await runDailyReport(db, new Date("2026-11-11T00:59:00.000Z"), { to: ["ops@example.com"] });
  assert.equal(waiting.status, "waiting");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM daily_report_sends").get().count, 0);

  const first = await runDailyReport(db, new Date("2026-11-11T01:10:00.000Z"), { to: ["ops@example.com"] });
  assert.equal(first.status, "sent");
  assert.equal(first.results[0].status, "skipped");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM daily_report_sends").get().count, 1);

  const second = await runDailyReport(db, new Date("2026-11-11T01:20:00.000Z"), { to: ["ops@example.com"] });
  assert.equal(second.results[0].status, "skipped");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM daily_report_sends").get().count, 1);

  const missed = await runDailyReport(db, new Date("2026-11-11T01:30:00.000Z"), { to: ["ops@example.com"] });
  assert.equal(missed.status, "waiting");

  const manual = await runDailyReport(db, new Date("2026-11-11T12:15:00.000Z"), { force: true, to: ["ops@example.com"] });
  assert.equal(manual.results[0].status, "skipped");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM daily_report_sends").get().count, 1);
} finally {
  if (previousKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousKey;
}

console.log("daily report ok");

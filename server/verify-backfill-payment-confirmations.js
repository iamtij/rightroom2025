import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { createRegistration, recordPayment } from "./registrations.js";
import { listFirstPaymentBackfillTargets } from "./backfill-payment-confirmations.js";
import { sendPaymentConfirmation } from "./reminders.js";

const db = openDatabase(":memory:");
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();

const installment = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "installment",
  fullName: "Amina Cruz",
  email: "amina@example.com",
  mobile: "09171234567",
  registeredOn: "2026-11-12",
});
recordPayment(db, { registrationId: installment.id, amountCents: 100_000, method: "manual" });
let targets = listFirstPaymentBackfillTargets(db);
assert.equal(targets.length, 1);
assert.equal(targets[0].reference, installment.reference);

const paymentId = targets[0].paymentId;
await sendPaymentConfirmation(db, installment.id, paymentId);
const dispatch = db.prepare("SELECT template_key, status FROM reminder_dispatches WHERE dispatch_key = ?").get(`payment:${paymentId}`);
assert.equal(dispatch?.template_key, "payment_confirmation");
targets = listFirstPaymentBackfillTargets(db);
assert.equal(targets.length, 1, "still eligible when prior send was skipped (no provider)");

const paidUp = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Leo Santos",
  email: "leo@example.com",
  mobile: "09181234567",
  registeredOn: "2026-11-12",
});
recordPayment(db, { registrationId: paidUp.id, amountCents: paidUp.amount_due_cents, method: "manual" });
targets = listFirstPaymentBackfillTargets(db);
assert.equal(targets.some((row) => row.reference === paidUp.reference), false);
assert.equal(targets.filter((row) => row.reference === installment.reference).length, 1);

const unpaid = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "installment",
  fullName: "No Pay",
  email: "nopay@example.com",
  mobile: "09191234567",
  registeredOn: "2026-11-12",
});
targets = listFirstPaymentBackfillTargets(db).filter((row) => row.reference === unpaid.reference);
assert.equal(targets.length, 0);

console.log("Backfill payment confirmation checks passed.");

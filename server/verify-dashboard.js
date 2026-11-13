import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { cancelRegistration, createRegistration, recordPayment } from "./registrations.js";
import { listMembers, saveMember } from "./members.js";
import { dashboardStats } from "./dashboard.js";
import { savePaymentChannels } from "./payment-channels.js";

const db = openDatabase(":memory:");
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01', sales_end = '2027-12-31'").run();

const empty = dashboardStats(db).paymentMethods;
assert.deepEqual(empty.map((row) => [row.channel, row.currency, row.cents, row.count, row.methods.map((method) => method.label)]), [
  ["upay", "PHP", 0, 0, ["InstaPay", "UnionBank Online", "Other banks"]],
  ["hitpay_qr", "PHP", 0, 0, []],
  ["hitpay_online", "PHP", 0, 0, []],
  ["hitpay_card", "PHP", 0, 0, []],
  ["paynamics", "PHP", 0, 0, []],
]);

function signup(productCode, email, mobile) {
  return createRegistration(db, {
    productCode,
    paymentPlan: "full",
    fullName: email,
    email,
    mobile,
    registeredOn: "2026-11-12",
  });
}

function pay(registration, amountCents, method, externalReference) {
  return recordPayment(db, {
    registrationId: registration.id,
    amountCents,
    method,
    externalReference,
  });
}

function linkPaynamics(registration, requestId, channel) {
  const installment = registration.installments.find((item) => item.status === "due") || registration.installments[0];
  db.prepare(`
    INSERT INTO paynamics_payments (
      registration_id, installment_id, request_id, amount_cents, currency, status, payment_channel
    ) VALUES (?, ?, ?, ?, ?, 'paid', ?)
  `).run(registration.id, installment.id, requestId, 1, registration.currency, channel);
}

const upay = signup("first_mover", "upay@example.com", "09170000001");
pay(upay, 100_000, "upay:instapay");
pay(upay, 50_000, "upay:UB Online");
pay(upay, 20_000, "upay:paygate");
pay(upay, 3_000, "upay:custom");

pay(signup("first_mover", "qr@example.com", "09170000002"), 15_000, "hitpay:qr");

const gcash = signup("first_mover", "gcash@example.com", "09170000003");
pay(gcash, 30_000, "paynamics", "pn-gcash");
linkPaynamics(gcash, "pn-gcash", "GCash");
const gcashAgain = signup("first_mover", "gcash2@example.com", "09170000004");
pay(gcashAgain, 10_000, "paynamics", "pn-gcash-2");
linkPaynamics(gcashAgain, "pn-gcash-2", "gcash");
const unreported = signup("first_mover", "pn@example.com", "09170000005");
pay(unreported, 5_000, "paynamics", "pn-plain");

pay(signup("first_mover", "admin-php@example.com", "09170000006"), 8_000, "admin");
pay(signup("intl_early_bird", "admin-usd@example.com", "09170000007"), 10_000, "admin");
pay(signup("first_mover", "comp@example.com", "09170000008"), 12_000, "comp");
pay(signup("first_mover", "manual@example.com", "09170000009"), 7_000, "manual");
pay(signup("first_mover", "cash@example.com", "09170000010"), 4_000, "bank transfer");

const cancelled = signup("first_mover", "cancelled@example.com", "09170000011");
pay(cancelled, 99_000, "upay:instapay");
cancelRegistration(db, cancelled.id);

const stats = dashboardStats(db);
assert.equal(stats.plans.fullyPaid, stats.tickets.reduce((sum, ticket) => sum + ticket.fullyPaid, 0));
assert.ok(stats.tickets.every((ticket) => ticket.fullyPaidCents + ticket.installmentCents <= ticket.collectedCents));
assert.equal(stats.tickets.reduce((sum, ticket) => sum + ticket.installmentSeats, 0), 0);
const methods = stats.paymentMethods;
const byChannel = (channel, currency) => methods.find((row) => row.channel === channel && row.currency === currency);
const method = (channel, currency, code) => byChannel(channel, currency).methods.find((row) => row.code === code);

const pesos = byChannel("upay", "PHP");
assert.equal(pesos.label, "U Pay · UnionBank");
assert.equal(pesos.cents, 173_000);
assert.equal(pesos.count, 4);
assert.deepEqual(pesos.methods.map((row) => [row.label, row.cents, row.count]), [
  ["InstaPay", 100_000, 1],
  ["UnionBank Online", 50_000, 1],
  ["Other banks", 20_000, 1],
  ["Custom", 3_000, 1],
]);

assert.equal(byChannel("hitpay_qr", "PHP").cents, 15_000);
assert.equal(byChannel("hitpay_qr", "PHP").count, 1);
assert.deepEqual(byChannel("hitpay_qr", "PHP").methods, []);
assert.equal(byChannel("hitpay_online", "PHP").cents, 0);

const paynamics = byChannel("paynamics", "PHP");
assert.equal(paynamics.cents, 45_000);
assert.equal(paynamics.count, 3);
assert.deepEqual(method("paynamics", "PHP", "paynamics:gcash"), { code: "paynamics:gcash", label: "GCash", cents: 40_000, count: 2 });
assert.equal(method("paynamics", "PHP", "paynamics").label, "Not reported");
assert.equal(method("paynamics", "PHP", "paynamics").cents, 5_000);
assert.deepEqual(paynamics.methods.map((row) => row.label), ["GCash", "Not reported"]);

assert.equal(byChannel("admin", "PHP").label, "Marked in admin · Pesos");
assert.equal(byChannel("admin", "PHP").cents, 8_000);
assert.equal(byChannel("admin", "USD").label, "Marked in admin · US dollars");
assert.deepEqual(methods.map((row) => [row.channel, row.currency]), [
  ["upay", "PHP"],
  ["hitpay_qr", "PHP"],
  ["hitpay_online", "PHP"],
  ["hitpay_card", "PHP"],
  ["paynamics", "PHP"],
  ["admin", "PHP"],
  ["comp", "PHP"],
  ["manual", "PHP"],
  ["other", "PHP"],
  ["admin", "USD"],
]);
assert.equal(byChannel("admin", "USD").cents, 10_000);
assert.equal(byChannel("comp", "PHP").cents, 12_000);
assert.equal(byChannel("manual", "PHP").cents, 7_000);
assert.equal(byChannel("other", "PHP").label, "Bank Transfer");
assert.equal(byChannel("other", "PHP").cents, 4_000);
assert.deepEqual(byChannel("other", "PHP").methods, []);

const phpCollected = methods.filter((row) => row.currency === "PHP").reduce((sum, row) => sum + row.cents, 0);
assert.equal(phpCollected, stats.money.find((row) => row.currency === "PHP").collectedCents);
assert.equal(stats.money.find((row) => row.currency === "USD").collectedCents, 10_000);
assert.equal(phpCollected, 264_000);

savePaymentChannels(db, { upay: { label: "UnionBank" }, hitpay_qr: { label: "QR Ph" } });
const renamed = dashboardStats(db).paymentMethods;
assert.equal(renamed.find((row) => row.channel === "upay").label, "UnionBank");
assert.equal(renamed.find((row) => row.channel === "hitpay_qr").label, "QR Ph");
assert.deepEqual(renamed.find((row) => row.channel === "upay").methods.map((row) => row.label), [
  "InstaPay",
  "UnionBank Online",
  "Other banks",
  "Custom",
]);

function rosterMember(email, mobile, ticketType = "") {
  saveMember(db, {
    fullName: email,
    email,
    mobile,
    chapter: "BNI Overflowing",
    category: "Care",
    businessName: "Marykay Philippines Inc",
    ticketType,
    regStatus: "updated",
    country: "Philippines",
    goldClub: false,
  });
}

function memberTicket(email) {
  return listMembers(db).find((row) => row.email === email)?.ticketType;
}

rosterMember("missionnanette56@yahoo.com", "09175078547");
const mission = signup("first_mover", "missionnanette56@yahoo.com", "09175078547");
assert.equal(memberTicket("missionnanette56@yahoo.com"), "First Mover");

rosterMember("phone-match@example.com", "09175551212");
signup("early_bird", "other-email@example.com", "09175551212");
assert.equal(memberTicket("phone-match@example.com"), "Early Bird");

rosterMember("csv-only@example.com", "09170000077", "Regular");
assert.equal(memberTicket("csv-only@example.com"), "Regular");

cancelRegistration(db, mission.id);
assert.equal(memberTicket("missionnanette56@yahoo.com"), "");
const missionAgain = signup("early_bird", "missionnanette56@yahoo.com", "09175078547");
assert.equal(memberTicket("missionnanette56@yahoo.com"), "Early Bird");
assert.equal(missionAgain.product_name, "Early Bird");

console.log("Dashboard payment totals passed.");

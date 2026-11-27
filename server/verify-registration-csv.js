import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentTotp } from "./auth.js";
import { openDatabase } from "./db.js";
import {
  REGISTRATION_CSV_HEADERS,
  buildRegistrationsCsv,
  csvEscape,
  registrationCsvCells,
  registrationsCsvFilename,
} from "./registration-csv.js";
import { createRegistration, getRegistration, recordPayment } from "./registrations.js";

assert.equal(csvEscape("plain"), "plain");
assert.equal(csvEscape('Say "hi"'), '"Say ""hi"""');
assert.equal(csvEscape("a,b"), '"a,b"');
assert.equal(csvEscape("line\nbreak"), '"line\nbreak"');
assert.equal(registrationsCsvFilename(new Date("2026-11-23T12:00:00.000Z")), "ibmc-registrations-2026-11-23.csv");

const file = path.join(os.tmpdir(), `ibmc-verify-registration-csv-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
process.env.IBMC_DB_PATH = file;
process.env.ADMIN_EMAIL = "csv-export@example.com";
process.env.ADMIN_PASSWORD = "csv-export-pass-9";
process.env.ADMIN_SESSION_SECRET = "csv-export-test-secret-32chars!!";
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";

const db = openDatabase(file);
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();

const unpaid = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: 'Ada "CSV" Cruz',
  email: "ada.csv@example.com",
  mobile: "09170001111",
  business: "Cruz, Co",
  industry: "Consulting",
  chapter: "Manila",
  invitedBy: "Ben Reyes",
  attendeeType: "member",
  registeredOn: "2026-11-20",
});

const paid = createRegistration(db, {
  productCode: "first_mover",
  paymentPlan: "full",
  fullName: "Ben Paid",
  email: "ben.paid@example.com",
  mobile: "09170002222",
  attendeeType: "guest",
  registeredOn: "2026-11-21",
});
const due = paid.installments.find((item) => item.status === "due");
assert.ok(due);
const settled = recordPayment(db, {
  registrationId: paid.id,
  installmentId: due.id,
  amountCents: due.amount_cents - due.amount_paid_cents,
  method: "admin",
});
assert.ok(settled.qr_token);

const csv = buildRegistrationsCsv(db);
const lines = csv.trimEnd().split(/\r?\n/);
assert.equal(lines[0], REGISTRATION_CSV_HEADERS.join(","));
assert.equal(lines.length, 3);
assert.ok(lines[1].includes(paid.reference));
assert.ok(lines[2].includes(unpaid.reference));
assert.ok(csv.includes('"Ada ""CSV"" Cruz"'));
assert.ok(csv.includes('"Cruz, Co"'));
assert.ok(csv.includes("Ben Reyes"));

assert.ok(REGISTRATION_CSV_HEADERS.includes("paid_at"));
const paidCells = registrationCsvCells(getRegistration(db, paid.id));
assert.equal(paidCells[REGISTRATION_CSV_HEADERS.indexOf("plan_status")], "fully_paid");
assert.equal(paidCells[REGISTRATION_CSV_HEADERS.indexOf("balance")], "0.00");
assert.equal(paidCells[REGISTRATION_CSV_HEADERS.indexOf("qr_ready")], "yes");
assert.equal(paidCells[REGISTRATION_CSV_HEADERS.indexOf("total")], (paid.amount_due_cents / 100).toFixed(2));
assert.ok(paidCells[REGISTRATION_CSV_HEADERS.indexOf("paid_at")]);
const unpaidCells = registrationCsvCells(getRegistration(db, unpaid.id));
assert.equal(unpaidCells[REGISTRATION_CSV_HEADERS.indexOf("paid_at")], "");
await new Promise((resolve) => setTimeout(resolve, 100));
db.close();

const { createApi } = await import("./api.js");
const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const login = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "csv-export@example.com", password: "csv-export-pass-9" }),
  });
  const setup = await login.json();
  assert.equal(login.status, 200, JSON.stringify(setup));
  assert.ok(setup.setupToken);
  const confirmed = await fetch(`${base}/api/admin/mfa/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setupToken: setup.setupToken, code: currentTotp(setup.secret) }),
  });
  assert.equal(confirmed.status, 200, await confirmed.text());
  const cookie = (confirmed.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie.startsWith("ibmc_admin="));

  const denied = await fetch(`${base}/api/admin/registrations/export.csv`);
  assert.equal(denied.status, 401);

  const exported = await fetch(`${base}/api/admin/registrations/export.csv`, { headers: { cookie } });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-type") || "", /text\/csv/);
  assert.match(exported.headers.get("content-disposition") || "", /ibmc-registrations-\d{4}-\d{2}-\d{2}\.csv/);
  const body = await exported.text();
  assert.ok(body.startsWith(`${REGISTRATION_CSV_HEADERS.join(",")}\r\n`));
  assert.ok(body.includes(unpaid.reference));
  assert.ok(body.includes(paid.reference));

  const auditDb = openDatabase(file);
  const audit = auditDb.prepare("SELECT action, target FROM admin_audit WHERE action = 'registration.export'").get();
  assert.equal(audit?.target, "registrations");
  auditDb.close();
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

console.log("Registration CSV export checks passed.");

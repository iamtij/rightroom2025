import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = path.join(os.tmpdir(), `ibmc-verify-challenge-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
process.env.IBMC_DB_PATH = file;
process.env.ALLOW_TEST_REGISTRATION = "true";
process.env.IBMC_STAGING_EARLY_PAYMENTS = "true";
process.env.IBMC_DEPLOYMENT_ENV = "staging";
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";
delete process.env.PAYNAMICS_API_CALLS_ENABLED;

const { createApi } = await import("./api.js");
const { openDatabase } = await import("./db.js");
openDatabase(file).prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();

const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function fetchChallenge() {
  const response = await fetch(`${base}/api/challenge`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  const token = String(payload.token || "").trim();
  assert.ok(token);
  return token;
}

function registrationBody(challenge) {
  return {
    productCode: "test_100",
    paymentPlan: "full",
    fullName: "Challenge Test",
    email: "challenge-test@example.com",
    mobile: "09171234999",
    business: "Test Co",
    industry: "IT & Software",
    attendeeType: "guest",
    challenge,
    companyWebsite: "",
  };
}

try {
  const token = await fetchChallenge();
  const first = await fetch(`${base}/api/registrations/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(registrationBody(token)),
  });
  const firstBody = await first.json();
  assert.notEqual(firstBody.error, "Refresh the page and try again.");

  const reused = await fetch(`${base}/api/registrations/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(registrationBody(token)),
  });
  const reusedBody = await reused.json();
  assert.equal(reused.status, 400);
  assert.equal(reusedBody.error, "Refresh the page and try again.");

  const fresh = await fetchChallenge();
  const second = await fetch(`${base}/api/registrations/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(registrationBody(fresh)),
  });
  const secondBody = await second.json();
  assert.notEqual(secondBody.error, "Refresh the page and try again.");

  const missing = await fetch(`${base}/api/registrations/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...registrationBody(""), challenge: "" }),
  });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "Refresh the page and try again.");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
  delete process.env.IBMC_DB_PATH;
  delete process.env.ALLOW_TEST_REGISTRATION;
  delete process.env.IBMC_STAGING_EARLY_PAYMENTS;
  delete process.env.IBMC_DEPLOYMENT_ENV;
}

console.log("Form challenge lifecycle checks passed.");

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRegistration } from "./registrations.js";

const file = path.join(os.tmpdir(), `ibmc-verify-checkout-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
process.env.IBMC_DB_PATH = file;
process.env.ALLOW_TEST_REGISTRATION = "true";
process.env.IBMC_STAGING_EARLY_PAYMENTS = "true";
process.env.IBMC_DEPLOYMENT_ENV = "staging";
process.env.TURNSTILE_SITE_KEY = "site";
process.env.TURNSTILE_SECRET_KEY = "secret";
delete process.env.PAYNAMICS_API_CALLS_ENABLED;

const consumedCaptcha = new Set();
const realFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  if (String(url).includes("/turnstile/v0/siteverify")) {
    const body = JSON.parse(options.body || "{}");
    const token = String(body.response || "");
    const ok = token && !consumedCaptcha.has(token);
    if (ok) consumedCaptcha.add(token);
    return new Response(JSON.stringify({ success: ok }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return realFetch(url, options);
};

const { createApi } = await import("./api.js");
const { openDatabase } = await import("./db.js");
const db = openDatabase(file);
db.prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();

const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function challenge() {
  return (await (await fetch(`${base}/api/challenge`)).json()).token;
}

const CAPTCHA = "cap-flow-once";

try {
  const validationFail = await fetch(`${base}/api/registrations/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: "test_100",
      paymentPlan: "installment",
      fullName: "Flow QA",
      email: "flow-a@example.com",
      mobile: "09171234771",
      business: "QA",
      industry: "IT & Software",
      attendeeType: "guest",
      challenge: await challenge(),
      turnstileToken: CAPTCHA,
      companyWebsite: "",
    }),
  });
  const validationBody = await validationFail.json();
  assert.equal(validationFail.status, 400);
  assert.equal(validationBody.error, "This ticket is paid in full");
  assert.notEqual(validationBody.code, "turnstile_rejected");

  const turnstileReplay = await fetch(`${base}/api/registrations/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: "test_100",
      paymentPlan: "installment",
      fullName: "Flow QA",
      email: "flow-b@example.com",
      mobile: "09171234772",
      business: "QA",
      industry: "IT & Software",
      attendeeType: "guest",
      challenge: await challenge(),
      turnstileToken: CAPTCHA,
      companyWebsite: "",
    }),
  });
  const replayBody = await turnstileReplay.json();
  assert.equal(replayBody.code, "turnstile_rejected");

  const challengeMissing = await fetch(`${base}/api/registrations/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productCode: "test_100",
      paymentPlan: "full",
      fullName: "Flow QA",
      email: "flow-c@example.com",
      mobile: "09171234773",
      business: "QA",
      industry: "IT & Software",
      attendeeType: "guest",
      challenge: "",
      turnstileToken: "cap-flow-new",
      companyWebsite: "",
    }),
  });
  assert.equal((await challengeMissing.json()).code, "form_challenge_invalid");

  const registration = createRegistration(db, {
    productCode: "test_100",
    paymentPlan: "full",
    fullName: "Resume",
    email: "flow-resume@example.com",
    mobile: "09171234774",
    registeredOn: "2026-11-07",
  });
  const resume = await fetch(`${base}/api/registrations/${registration.reference}/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const resumeBody = await resume.json();
  assert.notEqual(resumeBody.code, "turnstile_rejected");
  assert.notEqual(resumeBody.code, "form_challenge_invalid");
  assert.notEqual(resumeBody.error, "Confirm you are a person and try again.");
  assert.notEqual(resumeBody.error, "Refresh the page and try again.");
  assert.ok(resumeBody.error);
} finally {
  global.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

console.log("Checkout pay flow checks passed.");

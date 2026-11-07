import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Models Cloudflare Turnstile siteverify single-use tokens and the real rejectBot order:
 * CSRF consumed, then siteverify, then handler may still return 400.
 */
const file = path.join(os.tmpdir(), `ibmc-verify-turnstile-${process.pid}.sqlite`);
fs.rmSync(file, { force: true });
process.env.IBMC_DB_PATH = file;
process.env.ALLOW_TEST_REGISTRATION = "true";
process.env.IBMC_STAGING_EARLY_PAYMENTS = "true";
process.env.IBMC_DEPLOYMENT_ENV = "staging";
process.env.TURNSTILE_SITE_KEY = "test-site";
process.env.TURNSTILE_SECRET_KEY = "test-secret";
delete process.env.PAYNAMICS_API_CALLS_ENABLED;

const consumedCaptcha = new Set();
const CAPTCHA_ONCE = "captcha-once-6a69ad6";
const CAPTCHA_FRESH = "captcha-fresh-6a69ad6";
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
openDatabase(file).prepare("UPDATE ticket_products SET sales_start = '2020-01-01'").run();

const server = createApi().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function challenge() {
  const response = await fetch(`${base}/api/challenge`);
  const payload = await response.json();
  return String(payload.token || "").trim();
}

function payBody(challengeToken, captcha) {
  return {
    productCode: "test_100",
    paymentPlan: "installment",
    fullName: "Turnstile QA",
    email: `turnstile-qa-${captcha}@example.com`,
    mobile: "09171234888",
    business: "QA Co",
    industry: "IT & Software",
    attendeeType: "guest",
    challenge: challengeToken,
    turnstileToken: captcha,
    companyWebsite: "",
  };
}

try {
  const pay1 = await fetch(`${base}/api/registrations/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payBody(await challenge(), CAPTCHA_ONCE)),
  });
  const pay1Body = await pay1.json();
  assert.equal(pay1.status, 400);
  assert.notEqual(pay1Body.error, "Confirm you are a person and try again.");
  assert.notEqual(pay1Body.error, "Refresh the page and try again.");
  assert.ok(consumedCaptcha.has(CAPTCHA_ONCE));

  const pay2 = await fetch(`${base}/api/registrations/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payBody(await challenge(), CAPTCHA_ONCE)),
  });
  const pay2Body = await pay2.json();
  assert.equal(pay2.status, 400);
  assert.equal(pay2Body.error, "Confirm you are a person and try again.");

  const pay3 = await fetch(`${base}/api/registrations/paynamics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payBody(await challenge(), CAPTCHA_FRESH)),
  });
  const pay3Body = await pay3.json();
  assert.equal(pay3.status, 400);
  assert.notEqual(pay3Body.error, "Confirm you are a person and try again.");
} finally {
  global.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
  delete process.env.IBMC_DB_PATH;
  delete process.env.ALLOW_TEST_REGISTRATION;
  delete process.env.IBMC_STAGING_EARLY_PAYMENTS;
  delete process.env.IBMC_DEPLOYMENT_ENV;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
}

console.log("Turnstile single-use retry checks passed.");

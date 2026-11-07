import assert from "node:assert/strict";
import { manilaParts } from "./time.js";
import { openDatabase } from "./db.js";
import { createRegistration } from "./registrations.js";
import { tierFor } from "../src/register/plans.ts";
import {
  assessStagingEarlyPayments,
  stagingEarlyPaymentsOptIn,
  stagingTestRegistrationAllowed,
} from "./staging-early-payments.js";
import { assessStagingLiveDeploymentIdentity } from "./deployment-identity.js";

function clearStagingEarlyEnv() {
  delete process.env.IBMC_STAGING_EARLY_PAYMENTS;
  delete process.env.ALLOW_TEST_REGISTRATION;
  delete process.env.IBMC_DEPLOYMENT_ENV;
  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
}

function armStagingEarly() {
  process.env.ALLOW_TEST_REGISTRATION = "true";
  process.env.IBMC_STAGING_EARLY_PAYMENTS = "true";
  process.env.IBMC_DEPLOYMENT_ENV = "staging";
  delete process.env.RAILWAY_ENVIRONMENT;
  delete process.env.RAILWAY_ENVIRONMENT_NAME;
}

clearStagingEarlyEnv();
assert.equal(stagingEarlyPaymentsOptIn(), false);
assert.equal(stagingTestRegistrationAllowed(), false);
assert.equal(assessStagingEarlyPayments().allowed, false);
assert.equal(assessStagingEarlyPayments().reason, "early_payments_disabled");

armStagingEarly();
assert.equal(assessStagingEarlyPayments().allowed, true);
assert.equal(stagingTestRegistrationAllowed(), true);

process.env.RAILWAY_ENVIRONMENT = "production";
process.env.RAILWAY_ENVIRONMENT_NAME = "production";
assert.equal(assessStagingEarlyPayments().allowed, false);
assert.equal(assessStagingEarlyPayments().reason, "railway_production_environment");
assert.equal(stagingTestRegistrationAllowed(), false);

clearStagingEarlyEnv();
process.env.IBMC_STAGING_EARLY_PAYMENTS = "true";
process.env.ALLOW_TEST_REGISTRATION = "true";
process.env.RAILWAY_ENVIRONMENT = "staging";
process.env.RAILWAY_ENVIRONMENT_NAME = "production";
assert.equal(assessStagingEarlyPayments().allowed, false);
assert.equal(assessStagingEarlyPayments().reason, "railway_identity_conflicting");

clearStagingEarlyEnv();
process.env.IBMC_STAGING_EARLY_PAYMENTS = "true";
process.env.ALLOW_TEST_REGISTRATION = "true";
process.env.IBMC_DEPLOYMENT_ENV = "production";
assert.equal(assessStagingEarlyPayments().allowed, false);
assert.equal(assessStagingEarlyPayments().reason, "production_deployment_env");

clearStagingEarlyEnv();
process.env.IBMC_STAGING_EARLY_PAYMENTS = "true";
process.env.ALLOW_TEST_REGISTRATION = "true";
delete process.env.IBMC_DEPLOYMENT_ENV;
assert.equal(assessStagingLiveDeploymentIdentity().allowed, false);
assert.equal(assessStagingEarlyPayments().allowed, false);
assert.equal(assessStagingEarlyPayments().reason, "deployment_identity_missing");

const boundary = "2026-11-10";
const fm = tierFor(boundary, false);
assert.equal(fm?.code, "first_mover");
assert.equal(fm?.onSale, false);
assert.equal(fm?.opensLabel, "November 11");

armStagingEarly();
const db = openDatabase(":memory:");
const test100 = db.prepare("SELECT full_price_cents FROM ticket_products WHERE code = 'test_100'").get();
assert.equal(test100?.full_price_cents, 10_000);
const plan = db
  .prepare(`
    SELECT i.sequence, i.kind, i.days_after, i.amount_cents
    FROM installment_plan_items i
    JOIN ticket_products p ON p.id = i.product_id
    WHERE p.code = 'test_200'
    ORDER BY i.sequence
  `)
  .all();
assert.deepEqual(
  plan.map((row) => ({ sequence: row.sequence, kind: row.kind, days_after: row.days_after, amount_cents: row.amount_cents })),
  [
    { sequence: 1, kind: "on_registration", days_after: null, amount_cents: 10_000 },
    { sequence: 2, kind: "days_after", days_after: 2, amount_cents: 5_000 },
    { sequence: 3, kind: "days_after", days_after: 3, amount_cents: 5_000 },
  ],
);

const full = createRegistration(db, {
  productCode: "test_100",
  paymentPlan: "full",
  fullName: "Staging Full",
  email: "staging-full@example.com",
  mobile: "09171234001",
  registeredOn: manilaParts().date,
});
assert.equal(full.installment_count, 1);
assert.equal(full.installments[0].amount_cents, 10_000);
assert.equal(full.balance_cents, 10_000);

const inst = createRegistration(db, {
  productCode: "test_200",
  paymentPlan: "installment",
  fullName: "Staging Inst",
  email: "staging-inst@example.com",
  mobile: "09171234002",
  registeredOn: "2026-11-07",
});
assert.equal(inst.installments.length, 3);
assert.equal(inst.installments[0].amount_cents, 10_000);
assert.equal(inst.installments[1].amount_cents, 5_000);
assert.equal(inst.installments[2].amount_cents, 5_000);
assert.equal(inst.installments[0].due_on, "2026-11-07");
assert.equal(inst.installments[1].due_on, "2026-11-09");
assert.equal(inst.installments[2].due_on, "2026-11-10");

clearStagingEarlyEnv();
try {
  createRegistration(db, {
    productCode: "test_100",
    paymentPlan: "full",
    fullName: "Denied",
    email: "denied@example.com",
    mobile: "09171234003",
    registeredOn: manilaParts().date,
  });
  assert.fail("expected test_100 to be denied without staging gate");
} catch (error) {
  assert.equal(error instanceof Error ? error.message : "", "Unknown ticket");
}

console.log("Staging early payments checks passed.");

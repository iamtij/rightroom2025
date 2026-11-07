import { assessStagingLiveDeploymentIdentity } from "./deployment-identity.js";

export function stagingEarlyPaymentsOptIn() {
  return String(process.env.IBMC_STAGING_EARLY_PAYMENTS || "").trim().toLowerCase() === "true";
}

/** Staging-only early test checkout. Requires explicit opt-in and verified staging deployment identity. */
export function assessStagingEarlyPayments() {
  if (!stagingEarlyPaymentsOptIn()) return { allowed: false, reason: "early_payments_disabled" };
  const identity = assessStagingLiveDeploymentIdentity();
  if (!identity.allowed) return { allowed: false, reason: identity.reason };
  return { allowed: true, reason: identity.reason };
}

export function stagingEarlyPaymentsEnabled() {
  return assessStagingEarlyPayments().allowed;
}

export function testRegistrationOptIn() {
  return String(process.env.ALLOW_TEST_REGISTRATION || "").trim().toLowerCase() === "true";
}

/** Public staging test tickets (test_100, test_200, legacy test_50 member path). */
export function stagingTestRegistrationAllowed() {
  if (!testRegistrationOptIn()) return false;
  return stagingEarlyPaymentsEnabled();
}

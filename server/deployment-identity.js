function normalizeLabel(value) {
  return String(value || "").trim().toLowerCase();
}

const PRODUCTION_LABELS = new Set(["production", "prod"]);
const STAGING_LABELS = new Set(["staging", "stage", "preview", "development", "dev"]);

export function railwaySignalsPresent() {
  return Boolean(
    String(process.env.RAILWAY_ENVIRONMENT || "").trim()
    || String(process.env.RAILWAY_ENVIRONMENT_NAME || "").trim()
    || String(process.env.RAILWAY_PROJECT_ID || "").trim()
    || String(process.env.RAILWAY_SERVICE_ID || "").trim(),
  );
}

export function railwayDeploymentLabels() {
  return {
    environment: normalizeLabel(process.env.RAILWAY_ENVIRONMENT),
    environmentName: normalizeLabel(process.env.RAILWAY_ENVIRONMENT_NAME),
  };
}

export function railwayDeploymentClass() {
  const { environment, environmentName } = railwayDeploymentLabels();
  const unique = [...new Set([environment, environmentName].filter(Boolean))];
  if (!unique.length) return railwaySignalsPresent() ? "missing" : "absent";
  const prod = unique.some((label) => PRODUCTION_LABELS.has(label));
  const stage = unique.some((label) => STAGING_LABELS.has(label));
  if (prod && stage) return "conflicting";
  if (prod) return "production";
  if (stage) return "staging";
  return "unknown";
}

export function ibmcDeploymentEnv() {
  return normalizeLabel(process.env.IBMC_DEPLOYMENT_ENV);
}

/**
 * Whether staging-live Paynamics may be armed. Railway metadata wins over IBMC_DEPLOYMENT_ENV when both exist.
 */
export function assessStagingLiveDeploymentIdentity() {
  const custom = ibmcDeploymentEnv();
  const railway = railwayDeploymentClass();

  if (railwaySignalsPresent()) {
    if (railway === "missing" || railway === "unknown" || railway === "conflicting") {
      return { allowed: false, reason: `railway_identity_${railway}` };
    }
    if (railway === "production") {
      return { allowed: false, reason: "railway_production_environment" };
    }
    if (custom === "production") {
      return { allowed: false, reason: "deployment_identity_conflict" };
    }
    if (custom && custom !== "staging") {
      return { allowed: false, reason: "unsupported_custom_deployment_env" };
    }
    return { allowed: true, reason: "railway_staging" };
  }

  if (custom === "production") return { allowed: false, reason: "production_deployment_env" };
  if (custom !== "staging") return { allowed: false, reason: "deployment_identity_missing" };
  return { allowed: true, reason: "custom_staging" };
}

/**
 * Whether live Paynamics Workflow may run on IBMC production (ibmcph.com).
 */
export function assessProductionLiveDeploymentIdentity() {
  const custom = ibmcDeploymentEnv();
  const railway = railwayDeploymentClass();

  if (railwaySignalsPresent()) {
    if (railway === "missing" || railway === "unknown" || railway === "conflicting") {
      return { allowed: false, reason: `railway_identity_${railway}` };
    }
    if (railway === "production") {
      return { allowed: true, reason: "railway_production" };
    }
    if (custom === "production") {
      return { allowed: false, reason: "deployment_identity_conflict" };
    }
    if (railway === "staging") {
      return { allowed: false, reason: "railway_staging_environment" };
    }
    return { allowed: false, reason: "unsupported_railway_identity" };
  }

  if (custom === "production") return { allowed: true, reason: "custom_production" };
  return { allowed: false, reason: "production_identity_missing" };
}

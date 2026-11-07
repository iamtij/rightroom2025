/**
 * Opt-in staging safety: suppress outbound email/SMS and automatic encrypted backups.
 * Default off — production and normal staging behavior unchanged.
 * Does not block Paynamics Workflow API calls (separate fail-closed gates in paynamics.js).
 */
export function ibmcStagingSafeModeEnabled() {
  return process.env.IBMC_STAGING_SAFE_MODE === "true";
}

export function outboundNotificationsSuppressed() {
  return ibmcStagingSafeModeEnabled();
}

export function automaticBackupsSuppressed() {
  return ibmcStagingSafeModeEnabled();
}

/**
 * Opt-in staging safety: suppress outbound email/SMS and automatic encrypted backups.
 * Default off — production and normal staging behavior unchanged.
 * Does not block Paynamics Workflow API calls (separate fail-closed gates in paynamics.js).
 * Member and registration email login codes are still sent.
 */
export function ibmcStagingSafeModeEnabled() {
  return process.env.IBMC_STAGING_SAFE_MODE === "true";
}

export function automaticBackupsSuppressed() {
  return ibmcStagingSafeModeEnabled();
}

/** @deprecated use outboundEmailSuppressed / SMS path */
export function outboundNotificationsSuppressed() {
  return ibmcStagingSafeModeEnabled();
}

const STAGING_SAFE_OTP_DELIVERY = new Set(["member_otp", "registration_otp"]);

/**
 * When safe mode is on, block outbound email except member and registration login codes.
 */
export function outboundEmailSuppressed({ deliveryKind = "general" } = {}) {
  if (!ibmcStagingSafeModeEnabled()) return false;
  if (STAGING_SAFE_OTP_DELIVERY.has(deliveryKind)) return false;
  return true;
}

export function outboundSmsSuppressed() {
  return ibmcStagingSafeModeEnabled();
}

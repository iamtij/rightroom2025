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

const STAGING_SAFE_ALLOWED_EMAIL = new Set(["member_otp", "registration_otp", "entry_pass", "payment_confirmation"]);

/**
 * When safe mode is on, block outbound email except login codes and fully-paid QR tickets.
 */
export function outboundEmailSuppressed({ deliveryKind = "general" } = {}) {
  if (!ibmcStagingSafeModeEnabled()) return false;
  if (STAGING_SAFE_ALLOWED_EMAIL.has(deliveryKind)) return false;
  return true;
}

export function outboundSmsSuppressed() {
  return ibmcStagingSafeModeEnabled();
}

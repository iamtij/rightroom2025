import { assessStagingLiveDeploymentIdentity } from "./deployment-identity.js";

/**
 * Opt-in staging safety: suppress outbound email/SMS and automatic encrypted backups.
 * Default off — production and normal staging behavior unchanged.
 * Does not block Paynamics Workflow API calls (separate fail-closed gates in paynamics.js).
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

export function parseStagingSafeMembershipOtpAllowlist() {
  const raw = String(process.env.IBMC_STAGING_SAFE_MEMBERSHIP_OTP_ALLOWLIST || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item && item.includes("@") && !item.includes("*") && !item.includes("?"));
}

export function stagingSafeMembershipOtpRecipientAllowed(email) {
  if (!ibmcStagingSafeModeEnabled()) return false;
  if (!assessStagingLiveDeploymentIdentity().allowed) return false;
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return false;
  return parseStagingSafeMembershipOtpAllowlist().includes(normalized);
}

/**
 * When safe mode is on, block outbound email except allowlisted member-ownership OTP on verified staging identity.
 */
export function outboundEmailSuppressed({ to, deliveryKind = "general" } = {}) {
  if (!ibmcStagingSafeModeEnabled()) return false;
  if (deliveryKind === "member_otp" && stagingSafeMembershipOtpRecipientAllowed(to)) return false;
  return true;
}

export function outboundSmsSuppressed() {
  return ibmcStagingSafeModeEnabled();
}

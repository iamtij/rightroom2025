const CHANNEL_LABELS = {
  paymaya_ph: "Maya",
  grabpay_ph: "GrabPay",
  bpi_online: "BPI",
  ubp_online: "UnionBank Online",
  br_landbank_ph: "Landbank",
  gc: "GCash",
  qr: "QR Ph",
  online: "Online banking",
  instapay: "InstaPay",
  paygate: "Other banks",
  "UB Online": "UnionBank Online",
  paynamics: "Paynamics",
  manual: "Manual",
  admin: "Admin",
  comp: "Complimentary",
};

export function channelLabel(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  return CHANNEL_LABELS[key] || key.replaceAll("_", " ");
}

export function paymentChannelLabel(method, gatewayChannel) {
  const raw = String(method || "").trim();
  if (raw.startsWith("hitpay:")) return channelLabel(raw.slice("hitpay:".length));
  if (raw.startsWith("upay:")) return channelLabel(raw.slice("upay:".length));
  if (raw === "paynamics") return gatewayChannel ? channelLabel(gatewayChannel) : "Paynamics";
  return channelLabel(raw) || "IBMC";
}

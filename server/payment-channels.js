export const PAYMENT_CHANNELS = [
  {
    code: "upay",
    label: "U Pay · UnionBank",
    detail: "InstaPay, UnionBank Online, or other banks through UnionBank.",
  },
  {
    code: "hitpay_qr",
    label: "HitPay QR",
    detail: "QR Ph on this page. Any QR Ph bank or e-wallet can scan it.",
  },
  {
    code: "hitpay_online",
    label: "HitPay online banking",
    detail: "UnionBank Online on HitPay's secure page.",
  },
  {
    code: "paynamics",
    label: "Paynamics",
    detail: "Cards, e-wallets, and online banking on Paynamics' secure page.",
  },
];

const DEFAULTS = {
  upay: 1,
  hitpay_qr: 0,
  hitpay_online: 0,
  paynamics: 0,
};

export function seedPaymentChannels(db) {
  const insert = db.prepare("INSERT OR IGNORE INTO payment_channels (code, enabled) VALUES (?, ?)");
  for (const channel of PAYMENT_CHANNELS) insert.run(channel.code, DEFAULTS[channel.code]);
}

export function listPaymentChannels(db, { enabledOnly = false } = {}) {
  const rows = db.prepare("SELECT code, enabled FROM payment_channels").all();
  const enabled = new Map(rows.map((row) => [row.code, row.enabled === 1]));
  return PAYMENT_CHANNELS.filter((channel) => !enabledOnly || enabled.get(channel.code)).map((channel) => ({
    code: channel.code,
    label: channel.label,
    detail: channel.detail,
    enabled: Boolean(enabled.get(channel.code)),
  }));
}

export function isChannelEnabled(db, code) {
  const row = db.prepare("SELECT enabled FROM payment_channels WHERE code = ?").get(code);
  return row?.enabled === 1;
}

export function savePaymentChannels(db, input) {
  const body = input && typeof input === "object" ? input : {};
  const update = db.prepare("UPDATE payment_channels SET enabled = ? WHERE code = ?");
  for (const channel of PAYMENT_CHANNELS) {
    if (!Object.prototype.hasOwnProperty.call(body, channel.code)) continue;
    update.run(body[channel.code] ? 1 : 0, channel.code);
  }
  return listPaymentChannels(db);
}

export function hitpayConfigured() {
  return Boolean(String(process.env.HITPAY_API_KEY || "").trim() && String(process.env.HITPAY_SALT || "").trim());
}

export function paynamicsConfigured() {
  return Boolean(
    String(process.env.PAYNAMICS_MERCHANT_ID || "").trim()
    && String(process.env.PAYNAMICS_MERCHANT_KEY || "").trim()
    && String(process.env.PAYNAMICS_BASIC_AUTH_USER || "").trim()
    && String(process.env.PAYNAMICS_BASIC_AUTH_PASSWORD || "").trim()
    && String(process.env.PAYNAMICS_API_BASE_URL || "").trim()
    && process.env.PAYNAMICS_API_ACCOUNT_CONFIRMED === "true",
  );
}

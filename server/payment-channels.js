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
    detail: "Maya, GrabPay, BPI, UnionBank, or Landbank on Paynamics' secure page.",
  },
];

const DEFAULTS = {
  upay: 1,
  hitpay_qr: 0,
  hitpay_online: 0,
  paynamics: 0,
};

const CUSTOM_LABEL_MAX = 80;

export function seedPaymentChannels(db) {
  const insert = db.prepare("INSERT OR IGNORE INTO payment_channels (code, enabled) VALUES (?, ?)");
  for (const channel of PAYMENT_CHANNELS) insert.run(channel.code, DEFAULTS[channel.code]);
}

export function normalizeCustomLabel(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: true, value: null };
  if (text.length > CUSTOM_LABEL_MAX) {
    return { ok: false, error: "Buyer label must be 80 characters or fewer." };
  }
  return { ok: true, value: text };
}

export function listPaymentChannels(db, { enabledOnly = false } = {}) {
  const rows = db.prepare("SELECT code, enabled, custom_label FROM payment_channels").all();
  const saved = new Map(rows.map((row) => [row.code, row]));
  return PAYMENT_CHANNELS.filter((channel) => !enabledOnly || saved.get(channel.code)?.enabled === 1).map((channel) => {
    const row = saved.get(channel.code);
    return {
      code: channel.code,
      label: channel.label,
      customLabel: String(row?.custom_label || "").trim(),
      detail: channel.detail,
      enabled: row?.enabled === 1,
    };
  });
}

export function buyerPaymentChannels(db) {
  return listPaymentChannels(db, { enabledOnly: true }).map((channel) => ({
    code: channel.code,
    label: channel.customLabel || channel.label,
    detail: channel.detail,
  }));
}

export function isChannelEnabled(db, code) {
  const row = db.prepare("SELECT enabled FROM payment_channels WHERE code = ?").get(code);
  return row?.enabled === 1;
}

export function savePaymentChannels(db, input) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const patches = [];
  for (const channel of PAYMENT_CHANNELS) {
    if (!Object.prototype.hasOwnProperty.call(body, channel.code)) continue;
    const value = body[channel.code];
    const patch = { code: channel.code };
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (Object.prototype.hasOwnProperty.call(value, "enabled")) patch.enabled = value.enabled ? 1 : 0;
      if (Object.prototype.hasOwnProperty.call(value, "label")) {
        const normalized = normalizeCustomLabel(value.label);
        if (!normalized.ok) {
          const error = new Error(normalized.error);
          error.status = 400;
          throw error;
        }
        patch.label = normalized.value;
      }
    } else {
      patch.enabled = value ? 1 : 0;
    }
    patches.push(patch);
  }
  const updateEnabled = db.prepare("UPDATE payment_channels SET enabled = ? WHERE code = ?");
  const updateLabel = db.prepare("UPDATE payment_channels SET custom_label = ? WHERE code = ?");
  db.transaction(() => {
    for (const patch of patches) {
      if (patch.enabled !== undefined) updateEnabled.run(patch.enabled, patch.code);
      if (patch.label !== undefined) updateLabel.run(patch.label, patch.code);
    }
  })();
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

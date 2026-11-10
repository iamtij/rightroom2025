import { normalizeFeePercent, normalizeFeePesos } from "./convenience-fee.js";

export const PAYMENT_CHANNELS = [
  {
    code: "upay",
    label: "U Pay · UnionBank",
    detail: "InstaPay, UnionBank Online, or other banks through UnionBank.",
    note: "UnionBank collects this for GLOBAL REFERRAL MARKETING INC.",
  },
  {
    code: "hitpay_qr",
    label: "HitPay QR",
    detail: "QR Ph on this page. Any QR Ph bank or e-wallet can scan it.",
    note: "You'll get a QR Ph code on the next screen. Stay on that page if you already paid.",
  },
  {
    code: "hitpay_online",
    label: "HitPay online banking",
    detail: "UnionBank Online on HitPay's secure page.",
    note: "You'll continue to HitPay to pay with UnionBank Online. That page closes after 5 minutes. Coming back here does not by itself mean the payment went through.",
  },
  {
    code: "paynamics",
    label: "Paynamics",
    detail: "Pay on Paynamics' secure page with one of the options below.",
    note: "You'll continue to Paynamics to finish this payment.",
  },
];

const DEFAULTS = {
  upay: 1,
  hitpay_qr: 0,
  hitpay_online: 0,
  paynamics: 0,
};

// Hosted Paynamics url_link channels. "available" matches the options already offered at checkout.
export const PAYNAMICS_METHODS = [
  { code: "paymaya_ph", pmethod: "wallet", pchannel: "paymaya_ph", group: "E-Wallet", label: "Maya", detail: "Pay with Maya.", preset: "available" },
  { code: "grabpay_ph", pmethod: "wallet", pchannel: "grabpay_ph", group: "E-Wallet", label: "GrabPay", detail: "Pay with GrabPay.", preset: "available" },
  { code: "gc", pmethod: "wallet", pchannel: "gc", group: "E-Wallet", label: "GCash", detail: "Pay with GCash.", preset: "other" },
  { code: "coins_ph", pmethod: "wallet", pchannel: "coins_ph", group: "E-Wallet", label: "Coins.ph", detail: "Pay with Coins.ph.", preset: "other" },
  { code: "alipay", pmethod: "wallet", pchannel: "alipay", group: "E-Wallet", label: "Alipay", detail: "Pay with Alipay.", preset: "other" },
  { code: "wechat", pmethod: "wallet", pchannel: "wechat", group: "E-Wallet", label: "WeChat Pay", detail: "Pay with WeChat Pay.", preset: "other" },
  { code: "bpi_online", pmethod: "onlinebanktransfer", pchannel: "bpi_online", group: "Online banking", label: "BPI", detail: "Pay from a BPI account.", preset: "available" },
  { code: "ubp_online", pmethod: "onlinebanktransfer", pchannel: "ubp_online", group: "Online banking", label: "UnionBank Online", detail: "Pay from a UnionBank account.", preset: "available" },
  { code: "br_landbank_ph", pmethod: "onlinebanktransfer", pchannel: "br_landbank_ph", group: "Online banking", label: "Landbank", detail: "Pay from a Landbank account.", preset: "available" },
  { code: "br_bdo_ph", pmethod: "onlinebanktransfer", pchannel: "br_bdo_ph", group: "Online banking", label: "BDO", detail: "Pay from a BDO account.", preset: "other" },
  { code: "br_metrobank_ph", pmethod: "onlinebanktransfer", pchannel: "br_metrobank_ph", group: "Online banking", label: "Metrobank", detail: "Pay from a Metrobank account.", preset: "other" },
  { code: "ubp_qr_ph", pmethod: "onlinebanktransfer", pchannel: "ubp_qr_ph", group: "QR", label: "QR Ph", detail: "Pay by scanning a QR Ph code.", preset: "other" },
  { code: "creditcard", pmethod: "creditcard", pchannel: "", trxType: "sale", group: "Card", label: "Credit or debit card", detail: "Pay with a credit or debit card on Paynamics.", preset: "other" },
];

const paynamicsMethodCatalog = new Map(PAYNAMICS_METHODS.map((method) => [method.code, method]));

const CUSTOM_LABEL_MAX = 80;
const CUSTOM_NOTE_MAX = 400;

function feeFields(row) {
  return {
    feePercentBps: row?.fee_percent_bps ?? null,
    feeFixedCents: row?.fee_fixed_cents ?? null,
  };
}

function rejectFee(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function readFeePatch(value, patch, label = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const prefix = label ? `${label}: ` : "";
  if (Object.prototype.hasOwnProperty.call(value, "feePercent")) {
    const normalized = normalizeFeePercent(value.feePercent);
    if (!normalized.ok) rejectFee(`${prefix}${normalized.error}`);
    if (!normalized.skip) patch.feePercentBps = normalized.value;
  }
  if (Object.prototype.hasOwnProperty.call(value, "feeFixed")) {
    const normalized = normalizeFeePesos(value.feeFixed);
    if (!normalized.ok) rejectFee(`${prefix}${normalized.error}`);
    if (!normalized.skip) patch.feeFixedCents = normalized.value;
  }
}

export function seedPaymentChannels(db) {
  const insert = db.prepare("INSERT OR IGNORE INTO payment_channels (code, enabled) VALUES (?, ?)");
  for (const channel of PAYMENT_CHANNELS) insert.run(channel.code, DEFAULTS[channel.code]);
  seedPaynamicsMethods(db);
}

export function seedPaynamicsMethods(db) {
  const insert = db.prepare("INSERT OR IGNORE INTO paynamics_methods (code, enabled) VALUES (?, ?)");
  for (const method of PAYNAMICS_METHODS) insert.run(method.code, method.preset === "available" ? 1 : 0);
}

export function paynamicsMethodByCode(code) {
  return paynamicsMethodCatalog.get(String(code || "").trim().toLowerCase()) || null;
}

export function normalizeCustomLabel(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: true, value: null };
  if (text.length > CUSTOM_LABEL_MAX) {
    return { ok: false, error: "Buyer label must be 80 characters or fewer." };
  }
  return { ok: true, value: text };
}

export function normalizeCustomNote(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: true, value: null };
  if (text.length > CUSTOM_NOTE_MAX) {
    return { ok: false, error: "Checkout note must be 400 characters or fewer." };
  }
  return { ok: true, value: text };
}

export function listPaymentChannels(db, { enabledOnly = false } = {}) {
  const rows = db.prepare("SELECT code, enabled, custom_label, custom_note, fee_percent_bps, fee_fixed_cents FROM payment_channels").all();
  const saved = new Map(rows.map((row) => [row.code, row]));
  return PAYMENT_CHANNELS.filter((channel) => !enabledOnly || saved.get(channel.code)?.enabled === 1).map((channel) => {
    const row = saved.get(channel.code);
    return {
      code: channel.code,
      label: channel.label,
      customLabel: String(row?.custom_label || "").trim(),
      detail: channel.detail,
      note: channel.note,
      customNote: String(row?.custom_note || "").trim(),
      enabled: row?.enabled === 1,
      ...feeFields(row),
    };
  });
}

export function buyerPaymentChannels(db) {
  return listPaymentChannels(db, { enabledOnly: true }).map((channel) => ({
    code: channel.code,
    label: channel.customLabel || channel.label,
    detail: channel.detail,
    note: channel.customNote || channel.note,
    feePercentBps: channel.feePercentBps,
    feeFixedCents: channel.feeFixedCents,
  }));
}

export function isChannelEnabled(db, code) {
  const row = db.prepare("SELECT enabled FROM payment_channels WHERE code = ?").get(code);
  return row?.enabled === 1;
}

export function listPaynamicsMethods(db) {
  const rows = db.prepare("SELECT code, enabled, fee_percent_bps, fee_fixed_cents FROM paynamics_methods").all();
  const saved = new Map(rows.map((row) => [row.code, row]));
  return PAYNAMICS_METHODS.map((method) => {
    const row = saved.get(method.code);
    return {
      code: method.code,
      label: method.label,
      group: method.group,
      detail: method.detail,
      preset: method.preset,
      enabled: row ? row.enabled === 1 : method.preset === "available",
      ...feeFields(row),
    };
  });
}

export function buyerPaynamicsMethods(db) {
  return listPaynamicsMethods(db)
    .filter((method) => method.enabled)
    .map(({ code, label, group, detail, feePercentBps, feeFixedCents }) => ({ code, label, group, detail, feePercentBps, feeFixedCents }));
}

export function isPaynamicsMethodEnabled(db, code) {
  const method = paynamicsMethodByCode(code);
  if (!method) return false;
  const row = db.prepare("SELECT enabled FROM paynamics_methods WHERE code = ?").get(method.code);
  if (!row) return method.preset === "available";
  return row.enabled === 1;
}

export function savePaynamicsMethods(db, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const error = new Error("Paynamics channels were not saved.");
    error.status = 400;
    throw error;
  }
  const updateEnabled = db.prepare("UPDATE paynamics_methods SET enabled = ? WHERE code = ?");
  const updatePercent = db.prepare("UPDATE paynamics_methods SET fee_percent_bps = ? WHERE code = ?");
  const updateFixed = db.prepare("UPDATE paynamics_methods SET fee_fixed_cents = ? WHERE code = ?");
  const patches = [];
  for (const method of PAYNAMICS_METHODS) {
    if (!Object.prototype.hasOwnProperty.call(input, method.code)) continue;
    const value = input[method.code];
    const patch = { code: method.code };
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (Object.prototype.hasOwnProperty.call(value, "enabled")) patch.enabled = value.enabled ? 1 : 0;
      readFeePatch(value, patch, method.label);
    } else {
      patch.enabled = value ? 1 : 0;
    }
    patches.push(patch);
  }
  db.transaction(() => {
    for (const patch of patches) {
      if (patch.enabled !== undefined) updateEnabled.run(patch.enabled, patch.code);
      if (patch.feePercentBps !== undefined) updatePercent.run(patch.feePercentBps, patch.code);
      if (patch.feeFixedCents !== undefined) updateFixed.run(patch.feeFixedCents, patch.code);
    }
  })();
  return listPaynamicsMethods(db);
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
      if (Object.prototype.hasOwnProperty.call(value, "note")) {
        const normalized = normalizeCustomNote(value.note);
        if (!normalized.ok) {
          const error = new Error(normalized.error);
          error.status = 400;
          throw error;
        }
        patch.note = normalized.value === channel.note ? null : normalized.value;
      }
      readFeePatch(value, patch, channel.label);
    } else {
      patch.enabled = value ? 1 : 0;
    }
    patches.push(patch);
  }
  const updateEnabled = db.prepare("UPDATE payment_channels SET enabled = ? WHERE code = ?");
  const updateLabel = db.prepare("UPDATE payment_channels SET custom_label = ? WHERE code = ?");
  const updateNote = db.prepare("UPDATE payment_channels SET custom_note = ? WHERE code = ?");
  const updatePercent = db.prepare("UPDATE payment_channels SET fee_percent_bps = ? WHERE code = ?");
  const updateFixed = db.prepare("UPDATE payment_channels SET fee_fixed_cents = ? WHERE code = ?");
  db.transaction(() => {
    for (const patch of patches) {
      if (patch.enabled !== undefined) updateEnabled.run(patch.enabled, patch.code);
      if (patch.label !== undefined) updateLabel.run(patch.label, patch.code);
      if (patch.note !== undefined) updateNote.run(patch.note, patch.code);
      if (patch.feePercentBps !== undefined) updatePercent.run(patch.feePercentBps, patch.code);
      if (patch.feeFixedCents !== undefined) updateFixed.run(patch.feeFixedCents, patch.code);
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

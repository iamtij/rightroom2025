export function convenienceFeeCents(baseCents, percentBps, fixedCents) {
  const base = Math.round(Number(baseCents));
  if (!Number.isFinite(base) || base <= 0) return 0;
  let best = null;
  if (percentBps !== null && percentBps !== undefined && percentBps !== "") {
    const bps = Math.round(Number(percentBps));
    if (Number.isFinite(bps) && bps >= 0) best = Math.round((base * bps) / 10000);
  }
  if (fixedCents !== null && fixedCents !== undefined && fixedCents !== "") {
    const fixed = Math.round(Number(fixedCents));
    if (Number.isFinite(fixed) && fixed >= 0) best = best === null ? fixed : Math.max(best, fixed);
  }
  return best === null ? 0 : best;
}

export function hasFeeRate(percentBps, fixedCents) {
  return (percentBps !== null && percentBps !== undefined) || (fixedCents !== null && fixedCents !== undefined);
}

export function feeRuleLabel(percentBps, fixedCents) {
  const parts = [];
  if (percentBps !== null && percentBps !== undefined) {
    const text = (Number(percentBps) / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    parts.push(`${text}%`);
  }
  if (fixedCents !== null && fixedCents !== undefined) {
    const cents = Math.round(Number(fixedCents));
    const pesos = cents / 100;
    const text = cents % 100 === 0
      ? pesos.toLocaleString("en-PH")
      : pesos.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    parts.push(`₱${text}`);
  }
  return parts.join(" or ");
}

export function formatFeePercentInput(bps) {
  if (bps === null || bps === undefined) return "";
  return (Number(bps) / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function formatFeePesoInput(cents) {
  if (cents === null || cents === undefined) return "";
  return (Number(cents) / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function normalizeFeePercent(value) {
  if (value === undefined) return { ok: true, skip: true };
  if (value === null) return { ok: true, value: null };
  const text = String(value).trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Enter a percent from 0 to 100." };
  const number = Number(text);
  if (!Number.isFinite(number) || number > 100) return { ok: false, error: "Enter a percent from 0 to 100." };
  return { ok: true, value: Math.round(number * 100) };
}

export function normalizeFeePesos(value) {
  if (value === undefined) return { ok: true, skip: true };
  if (value === null) return { ok: true, value: null };
  const text = String(value).trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(text)) return { ok: false, error: "Enter a peso amount." };
  const number = Number(text);
  if (!Number.isFinite(number)) return { ok: false, error: "Enter a peso amount." };
  return { ok: true, value: Math.round(number * 100) };
}

export function settlementBaseCents(row) {
  const total = Math.round(Number(row?.amount_cents) || 0);
  const fee = Math.round(Number(row?.fee_cents) || 0);
  if (fee < 0 || fee > total) {
    const error = new Error("Payment does not match the amount still due");
    error.status = 409;
    throw error;
  }
  return total - fee;
}

function readRate(row) {
  return {
    percentBps: row?.fee_percent_bps ?? null,
    fixedCents: row?.fee_fixed_cents ?? null,
  };
}

export function paymentCharge(db, registration, baseCents, target = {}) {
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  const empty = {
    baseCents: base,
    feeCents: 0,
    totalCents: base,
    listedFeeCents: 0,
    bearer: "shoulder",
    percentBps: null,
    fixedCents: null,
  };
  if (!registration || registration.currency !== "PHP" || base <= 0) return empty;
  let bearer = registration.fee_bearer;
  if (bearer !== "pass" && bearer !== "shoulder" && registration.product_code) {
    bearer = db.prepare("SELECT fee_bearer FROM ticket_products WHERE code = ?").get(registration.product_code)?.fee_bearer;
  }
  bearer = bearer === "pass" ? "pass" : "shoulder";
  let rate = { percentBps: null, fixedCents: null };
  if (target.channel === "paynamics" && target.method) {
    rate = readRate(db.prepare("SELECT fee_percent_bps, fee_fixed_cents FROM paynamics_methods WHERE code = ?").get(target.method));
  } else if (target.channel) {
    rate = readRate(db.prepare("SELECT fee_percent_bps, fee_fixed_cents FROM payment_channels WHERE code = ?").get(target.channel));
  }
  const listedFeeCents = convenienceFeeCents(base, rate.percentBps, rate.fixedCents);
  const feeCents = bearer === "pass" ? listedFeeCents : 0;
  return {
    baseCents: base,
    feeCents,
    totalCents: base + feeCents,
    listedFeeCents,
    bearer,
    percentBps: rate.percentBps,
    fixedCents: rate.fixedCents,
  };
}

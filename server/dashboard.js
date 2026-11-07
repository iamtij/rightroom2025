import { listPaymentChannels } from "./payment-channels.js";
import { addDays, manilaParts } from "./time.js";

function percent(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

function statusCounts(rows) {
  const counts = { updated: 0, delayed: 0, cancelled: 0 };
  for (const row of rows) {
    if (row.status in counts) counts[row.status] = row.count;
  }
  const total = counts.updated + counts.delayed + counts.cancelled;
  return {
    total,
    ...counts,
    updatedPercent: percent(counts.updated, total),
    delayedPercent: percent(counts.delayed, total),
    cancelledPercent: percent(counts.cancelled, total),
  };
}

const CHANNEL_LABELS = {
  upay: "U Pay · UnionBank",
  hitpay_qr: "HitPay QR",
  hitpay_online: "HitPay online banking",
  paynamics: "Paynamics",
  admin: "Marked in admin",
  comp: "Complimentary",
  manual: "Manual",
  other: "Other",
};

const CHANNEL_ORDER = ["upay", "hitpay_qr", "hitpay_online", "paynamics", "admin", "comp", "manual", "other"];
const BUYER_CHANNELS = new Set(["upay", "hitpay_qr", "hitpay_online", "paynamics"]);

const KNOWN_METHODS = [
  { channel: "upay", code: "upay:instapay", label: "InstaPay" },
  { channel: "upay", code: "upay:UB Online", label: "UnionBank Online" },
  { channel: "upay", code: "upay:paygate", label: "Other banks" },
  { channel: "hitpay_qr", code: "hitpay:qr", label: "HitPay QR" },
  { channel: "hitpay_online", code: "hitpay:online", label: "HitPay online banking" },
  { channel: "paynamics", code: "paynamics", label: "Paynamics" },
];

const DEFAULT_METHOD = {
  hitpay_qr: "hitpay:qr",
  hitpay_online: "hitpay:online",
  paynamics: "paynamics",
  admin: "admin",
  comp: "comp",
  manual: "manual",
};

const UPAY_LABELS = {
  "upay:instapay": "InstaPay",
  "upay:UB Online": "UnionBank Online",
  "upay:paygate": "Other banks",
};

const PAYNAMICS_LABELS = {
  gcash: "GCash",
  grabpay: "GrabPay",
  maya: "Maya",
  paymaya: "Maya",
  qrph: "QR Ph",
  instapay: "InstaPay",
  creditcard: "Card",
  card: "Card",
  onlinebank: "Online banking",
  onlinebanking: "Online banking",
  wallet: "E-wallet",
  onlinebanktransfer: "Online banking",
  ubonline: "UnionBank Online",
};

function titleLabel(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function paynamicsLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (PAYNAMICS_LABELS[key]) return PAYNAMICS_LABELS[key];
  const words = key.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? titleLabel(words) : "Paynamics";
}

function classifyPayment(method, detail) {
  if (method.startsWith("upay:")) {
    return {
      channel: "upay",
      code: method,
      label: UPAY_LABELS[method] || titleLabel(method.slice(5)) || "U Pay",
    };
  }
  if (method === "hitpay:qr" || method === "hitpay:online" || method === "admin" || method === "comp" || method === "manual") {
    const channel = method === "hitpay:qr" ? "hitpay_qr" : method === "hitpay:online" ? "hitpay_online" : method;
    return { channel, code: method, label: CHANNEL_LABELS[channel] };
  }
  if (method === "paynamics") {
    if (detail) return { channel: "paynamics", code: `paynamics:${detail}`, label: paynamicsLabel(detail) };
    return { channel: "paynamics", code: "paynamics", label: "Paynamics" };
  }
  return {
    channel: "other",
    code: method,
    label: method === "unknown" ? "Unspecified" : titleLabel(method),
  };
}

function paymentMethodTotals(db) {
  const customLabels = new Map(
    listPaymentChannels(db).flatMap((channel) => (channel.customLabel ? [[channel.code, channel.customLabel]] : [])),
  );
  const rows = db.prepare(`
    SELECT
      COALESCE(NULLIF(TRIM(p.method), ''), 'unknown') AS method,
      p.currency AS currency,
      COUNT(*) AS count,
      COALESCE(SUM(p.amount_cents), 0) AS cents,
      CASE
        WHEN TRIM(COALESCE(p.method, '')) = 'paynamics' THEN NULLIF(LOWER(TRIM(pn.payment_channel)), '')
        ELSE NULL
      END AS detail
    FROM payments p
    JOIN registrations r ON r.id = p.registration_id
    LEFT JOIN paynamics_payments pn
      ON TRIM(COALESCE(p.method, '')) = 'paynamics'
     AND pn.request_id = p.external_reference
    WHERE r.status != 'cancelled'
    GROUP BY 1, 2, 5
  `).all();

  const groups = new Map();
  function groupFor(channel, currency) {
    const key = `${channel}\n${currency}`;
    if (!groups.has(key)) {
      groups.set(key, {
        channel,
        label: CHANNEL_LABELS[channel] || "Other",
        currency,
        methods: new Map(),
      });
    }
    return groups.get(key);
  }
  function addMethod(channel, currency, code, label, count, cents) {
    const group = groupFor(channel, currency);
    const current = group.methods.get(code) || { code, label, count: 0, cents: 0 };
    current.label = label || current.label;
    current.count += count;
    current.cents += cents;
    group.methods.set(code, current);
  }

  for (const method of KNOWN_METHODS) addMethod(method.channel, "PHP", method.code, method.label, 0, 0);
  for (const row of rows) {
    const placed = classifyPayment(row.method, row.detail);
    addMethod(placed.channel, row.currency, placed.code, placed.label, row.count, row.cents);
  }

  const list = [...groups.values()].flatMap((group) => {
    let methods = [...group.methods.values()];
    if (group.channel === "paynamics" && methods.some((method) => method.code !== "paynamics")) {
      methods = methods.flatMap((method) => {
        if (method.code !== "paynamics") return [method];
        if (!method.count && !method.cents) return [];
        return [{ ...method, label: "Not reported" }];
      });
    }
    const known = KNOWN_METHODS.filter((method) => method.channel === group.channel).map((method) => method.code);
    methods.sort((left, right) => {
      const leftUnspecified = left.label === "Not reported";
      const rightUnspecified = right.label === "Not reported";
      if (leftUnspecified !== rightUnspecified) return leftUnspecified ? 1 : -1;
      const leftRank = known.indexOf(left.code);
      const rightRank = known.indexOf(right.code);
      const leftOrder = leftRank === -1 ? 1000 : leftRank;
      const rightOrder = rightRank === -1 ? 1000 : rightRank;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.label.localeCompare(right.label);
    });
    const count = methods.reduce((sum, method) => sum + method.count, 0);
    const cents = methods.reduce((sum, method) => sum + method.cents, 0);
    const buyerZero = BUYER_CHANNELS.has(group.channel) && group.currency === "PHP";
    if (!buyerZero && !count && !cents) return [];
    const sole = methods.length === 1 ? methods[0] : null;
    const hideMethods = Boolean(sole && (sole.code === DEFAULT_METHOD[group.channel] || group.channel === "other"));
    return [{
      channel: group.channel,
      label: customLabels.get(group.channel) || (hideMethods && group.channel === "other" ? sole.label : group.label),
      currency: group.currency,
      count,
      cents,
      methods: hideMethods ? [] : methods.map(({ code, label, count: methodCount, cents: methodCents }) => ({
        code,
        label,
        count: methodCount,
        cents: methodCents,
      })),
    }];
  });

  const channelCurrencies = new Map();
  for (const group of list) channelCurrencies.set(group.channel, (channelCurrencies.get(group.channel) || 0) + 1);
  list.sort((left, right) => {
    if (left.currency !== right.currency) {
      if (left.currency === "PHP") return -1;
      if (right.currency === "PHP") return 1;
      return left.currency.localeCompare(right.currency);
    }
    const leftChannel = CHANNEL_ORDER.indexOf(left.channel);
    const rightChannel = CHANNEL_ORDER.indexOf(right.channel);
    return (leftChannel === -1 ? 99 : leftChannel) - (rightChannel === -1 ? 99 : rightChannel);
  });
  return list.map((group) => ({
    ...group,
    label: channelCurrencies.get(group.channel) > 1
      ? `${group.label} · ${group.currency === "USD" ? "US dollars" : group.currency === "PHP" ? "Pesos" : group.currency}`
      : group.label,
  }));
}

export function dashboardStats(db) {
  const today = manilaParts().date;
  const through = addDays(today, 30);
  const headline = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN status != 'cancelled' AND product_id = (SELECT id FROM ticket_products WHERE code = 'first_mover') THEN 1 ELSE 0 END) AS first_movers,
      SUM(CASE WHEN status = 'cancelled' AND product_id = (SELECT id FROM ticket_products WHERE code = 'first_mover') THEN 1 ELSE 0 END) AS first_movers_cancelled
    FROM registrations
  `).get();

  const tickets = db.prepare(`
    SELECT
      p.code,
      p.name,
      p.currency,
      SUM(CASE WHEN r.status != 'cancelled' THEN 1 ELSE 0 END) AS signups,
      SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN r.status != 'cancelled' AND r.fully_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS fully_paid,
      SUM(CASE WHEN r.status != 'cancelled' AND r.payment_plan = 'full' THEN 1 ELSE 0 END) AS pay_in_full,
      SUM(CASE WHEN r.status != 'cancelled' AND r.payment_plan = 'installment' THEN 1 ELSE 0 END) AS installment,
      COALESCE(SUM(CASE WHEN r.status != 'cancelled' THEN r.amount_due_cents ELSE 0 END), 0) AS booked_cents,
      COALESCE(SUM(CASE WHEN r.status != 'cancelled' THEN (
        SELECT COALESCE(SUM(i.amount_paid_cents), 0)
        FROM registration_installments i
        WHERE i.registration_id = r.id
      ) ELSE 0 END), 0) AS collected_cents
    FROM ticket_products p
    LEFT JOIN registrations r ON r.product_id = p.id
    GROUP BY p.id
    ORDER BY p.sales_start, p.id
  `).all();

  const byDay = db.prepare(`
    SELECT registered_on AS day, COUNT(*) AS signups
    FROM registrations
    WHERE status != 'cancelled'
    GROUP BY registered_on
    ORDER BY registered_on
  `).all();

  const dueSoon = db.prepare(`
    SELECT r.currency AS currency,
      COUNT(*) AS count,
      COALESCE(SUM(i.amount_cents - i.amount_paid_cents), 0) AS cents
    FROM registration_installments i
    JOIN registrations r ON r.id = i.registration_id
    WHERE r.status != 'cancelled'
      AND i.status = 'due'
      AND i.due_on <= ?
      AND i.amount_cents > i.amount_paid_cents
    GROUP BY r.currency
  `).all(through);

  const rosterRows = db.prepare(`
    SELECT reg_status AS status, COUNT(*) AS count
    FROM members
    GROUP BY reg_status
  `).all();
  const firstMoverRosterRows = db.prepare(`
    SELECT reg_status AS status, COUNT(*) AS count
    FROM members
    WHERE lower(COALESCE(ticket_type, '')) LIKE '%first mover%'
    GROUP BY reg_status
  `).all();
  const goldClub = db.prepare("SELECT COUNT(*) AS count FROM members WHERE gold_club = 1").get().count;

  const money = new Map();
  let payInFull = 0;
  let installment = 0;
  let fullyPaid = 0;
  for (const ticket of tickets) {
    payInFull += ticket.pay_in_full;
    installment += ticket.installment;
    fullyPaid += ticket.fully_paid;
    const current = money.get(ticket.currency) || { currency: ticket.currency, collectedCents: 0, bookedCents: 0 };
    current.collectedCents += ticket.collected_cents;
    current.bookedCents += ticket.booked_cents;
    money.set(ticket.currency, current);
  }

  const confirmed = headline.confirmed || 0;
  return {
    signups: {
      total: headline.total || 0,
      confirmed,
      cancelled: headline.cancelled || 0,
      firstMovers: headline.first_movers || 0,
      firstMoversCancelled: headline.first_movers_cancelled || 0,
      firstMoverPercent: percent(headline.first_movers || 0, confirmed),
    },
    tickets: tickets.map((ticket) => ({
      code: ticket.code,
      name: ticket.name,
      currency: ticket.currency,
      signups: ticket.signups,
      cancelled: ticket.cancelled,
      fullyPaid: ticket.fully_paid,
      collectedCents: ticket.collected_cents,
      bookedCents: ticket.booked_cents,
    })),
    plans: {
      payInFull,
      installment,
      fullyPaid,
      owing: confirmed - fullyPaid,
    },
    money: [...money.values()].map((row) => ({
      currency: row.currency,
      collectedCents: row.collectedCents,
      outstandingCents: row.bookedCents - row.collectedCents,
    })),
    byDay: byDay.map((row) => ({ day: row.day, signups: row.signups })),
    dueSoon: {
      through,
      rows: dueSoon.map((row) => ({ currency: row.currency, count: row.count, cents: row.cents })),
    },
    roster: { ...statusCounts(rosterRows), goldClub },
    firstMoverRoster: statusCounts(firstMoverRosterRows),
    paymentMethods: paymentMethodTotals(db),
  };
}

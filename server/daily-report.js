import { pathToFileURL } from "url";
import { collectPaymentMethods } from "./dashboard.js";
import { openDatabase } from "./db.js";
import { assessProductionLiveDeploymentIdentity } from "./deployment-identity.js";
import { sendEmail } from "./providers.js";
import { reportError } from "./report-error.js";
import { renderDailyReport } from "./daily-report-email.js";
import { addDays, formatMoney, manilaParts } from "./time.js";

const TEST_PRODUCT = "test%";
const AT_RISK_LIMIT = 15;
const SEND_AFTER = "09:00";
const SEND_BEFORE = "09:30";

const BANDS = [
  { key: "track", label: "On track", color: "#1E7B4F", late: false },
  { key: "soon", label: "Due in the next 7 days", color: "#A86A00", late: false },
  { key: "nudge", label: "1–3 days late · nudge", color: "#E5646C", late: true },
  { key: "call", label: "4–7 days late · call", color: "#CF2030", late: true },
  { key: "escalate", label: "8–15 days late · escalate", color: "#8F1420", late: true },
  { key: "day15", label: "More than 15 days late · Regular price", color: "#000000", late: true },
];

function norm(column) {
  return `REPLACE(SUBSTR(COALESCE(${column}, ''), 1, 19), 'T', ' ')`;
}

function utcStamp(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function atManila(isoDate, hours, minutes) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours - 8, minutes, 0, 0));
}

function daysBetween(earlier, later) {
  const [year, month, day] = earlier.split("-").map(Number);
  const [laterYear, laterMonth, laterDay] = later.split("-").map(Number);
  return Math.round((Date.UTC(laterYear, laterMonth - 1, laterDay) - Date.UTC(year, month - 1, day)) / 86_400_000);
}

function shortDate(iso, today) {
  const [year, month, day] = iso.split("-").map(Number);
  const options = { month: "short", day: "numeric", timeZone: "UTC" };
  if (!today.startsWith(String(year))) options.year = "numeric";
  return new Intl.DateTimeFormat("en-US", options).format(new Date(Date.UTC(year, month - 1, day)));
}

function blankTotals() {
  return { seats: 0, paidFull: 0, installment: 0, collectedCents: 0, scheduledCents: 0 };
}

function addTotals(totals, ticket) {
  totals.seats += ticket.seats;
  totals.paidFull += ticket.paidFull;
  totals.installment += ticket.installment;
  totals.collectedCents += ticket.collectedCents;
  totals.scheduledCents += ticket.scheduledCents;
}

function moneyBucket() {
  return { PHP: 0, USD: 0 };
}

function addMoney(bucket, currency, cents) {
  if (!cents) return;
  bucket[currency] = (bucket[currency] || 0) + cents;
}

function phaseFor(salesStart, salesEnd, today) {
  if (today < salesStart) return "later";
  if (today > salesEnd) return "ended";
  return "open";
}

function phaseLabel(phase, salesStart, salesEnd, today) {
  if (phase === "later") return `Opens ${shortDate(salesStart, today)}`;
  if (phase === "ended") return `Ended ${shortDate(salesEnd, today)}`;
  return `Open · ends ${shortDate(salesEnd, today)}`;
}

function priceLabel(row) {
  const full = formatMoney(row.full_price_cents, row.currency);
  if (row.installment_total_cents && row.installment_total_cents !== row.full_price_cents) {
    return `${full} / ${formatMoney(row.installment_total_cents, row.currency)}`;
  }
  return full;
}

function classifyPlan(items, today) {
  const soonUntil = addDays(today, 7);
  let oldest = null;
  let overdueCents = 0;
  let soon = false;
  for (const item of items) {
    if (item.status === "waived" || item.amount_paid_cents >= item.amount_cents) continue;
    if (item.due_on < today) {
      overdueCents += item.amount_cents - item.amount_paid_cents;
      if (!oldest || item.due_on < oldest) oldest = item.due_on;
    } else if (item.due_on <= soonUntil) soon = true;
  }
  if (oldest) {
    const days = daysBetween(oldest, today);
    let key = "day15";
    if (days <= 3) key = "nudge";
    else if (days <= 7) key = "call";
    else if (days <= 15) key = "escalate";
    return { key, days, overdueCents, oldest };
  }
  return { key: soon ? "soon" : "track", days: 0, overdueCents: 0, oldest: null };
}

function shareWidths(bands) {
  const total = bands.reduce((sum, band) => sum + band.count, 0);
  if (!total) return bands.map((band) => ({ ...band, width: 0 }));
  const drafted = bands.map((band) => ({ ...band, width: Math.round((band.count / total) * 100) }));
  const drift = 100 - drafted.reduce((sum, band) => sum + band.width, 0);
  if (drift !== 0) {
    const index = drafted.reduce((best, band, item) => (band.count > drafted[best].count ? item : best), 0);
    drafted[index].width += drift;
  }
  return drafted;
}

function sharePercents(rows) {
  const total = rows.reduce((sum, row) => sum + row.cents, 0);
  if (!total) return rows.map((row) => ({ ...row, percent: 0 }));
  const drafted = rows.map((row) => {
    let percent = Math.round((row.cents / total) * 100);
    if (row.cents > 0 && percent < 1) percent = 1;
    return { ...row, percent };
  });
  let drift = 100 - drafted.reduce((sum, row) => sum + row.percent, 0);
  const index = drafted.reduce((best, row, item) => (row.cents > drafted[best].cents ? item : best), 0);
  while (drift > 0) {
    drafted[index].percent += 1;
    drift -= 1;
  }
  while (drift < 0 && drafted[index].percent > 1) {
    drafted[index].percent -= 1;
    drift += 1;
  }
  return drafted;
}

function paymentRows(groups, currency) {
  const merged = new Map();
  for (const group of groups) {
    if (group.currency !== currency || group.channel === "comp") continue;
    const parts = group.methods.length
      ? group.methods
      : [{ label: group.label, count: group.count, cents: group.cents }];
    for (const part of parts) {
      if (!part.count && !part.cents) continue;
      const label = part.label || group.label;
      const current = merged.get(label) || { label, count: 0, cents: 0 };
      current.count += part.count;
      current.cents += part.cents;
      merged.set(label, current);
    }
  }
  return sharePercents([...merged.values()].sort((left, right) => right.cents - left.cents || left.label.localeCompare(right.label)));
}

export function reportRecipients(value = process.env.DAILY_REPORT_TO) {
  const seen = new Set();
  const list = [];
  for (const part of String(value || "").split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || seen.has(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) continue;
    seen.add(email);
    list.push(email);
  }
  return list;
}

export function buildDailyReport(db, asOf = new Date()) {
  const today = manilaParts(asOf).date;
  const windowStart = new Date(asOf.getTime() - 24 * 60 * 60 * 1000);
  const from = utcStamp(windowStart);
  const until = utcStamp(asOf);

  const ticketRows = db.prepare(`
    SELECT
      p.code, p.name, p.currency, p.full_price_cents, p.installment_total_cents, p.sales_start, p.sales_end,
      SUM(CASE WHEN r.id IS NOT NULL AND r.status != 'cancelled' THEN 1 ELSE 0 END) AS seats,
      SUM(CASE WHEN r.status != 'cancelled' AND r.fully_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paid_full,
      SUM(CASE WHEN r.status = 'confirmed' AND r.payment_plan = 'installment' AND r.fully_paid_at IS NULL THEN 1 ELSE 0 END) AS installment,
      COALESCE(SUM(CASE WHEN r.status != 'cancelled' THEN (
        SELECT COALESCE(SUM(pay.amount_cents), 0) FROM payments pay
        WHERE pay.registration_id = r.id AND COALESCE(pay.method, '') != 'comp'
      ) ELSE 0 END), 0) AS collected_cents,
      COALESCE(SUM(CASE WHEN r.status = 'confirmed' THEN (
        SELECT COALESCE(SUM(i.amount_cents - i.amount_paid_cents), 0)
        FROM registration_installments i
        WHERE i.registration_id = r.id AND i.status = 'due' AND i.due_on >= ? AND i.amount_cents > i.amount_paid_cents
      ) ELSE 0 END), 0) AS scheduled_cents
    FROM ticket_products p
    LEFT JOIN registrations r ON r.product_id = p.id
    WHERE p.code NOT LIKE ?
    GROUP BY p.id
    ORDER BY p.sales_start, p.id
  `).all(today, TEST_PRODUCT);

  const tickets = ticketRows.map((row) => {
    const phase = phaseFor(row.sales_start, row.sales_end, today);
    const seats = Number(row.seats) || 0;
    const paidFull = Number(row.paid_full) || 0;
    const installment = Number(row.installment) || 0;
    const collectedCents = Number(row.collected_cents) || 0;
    const scheduledCents = Number(row.scheduled_cents) || 0;
    return {
      code: row.code,
      name: row.name,
      currency: row.currency,
      salesStart: row.sales_start,
      salesEnd: row.sales_end,
      phase,
      phaseLabel: phaseLabel(phase, row.sales_start, row.sales_end, today),
      priceLabel: priceLabel(row),
      seats,
      paidFull,
      installment,
      collectedCents,
      scheduledCents,
      showDash: phase === "later" && !seats && !paidFull && !installment && !collectedCents && !scheduledCents,
    };
  });

  const totals = { PHP: blankTotals(), USD: blankTotals() };
  const collected = moneyBucket();
  const scheduled = moneyBucket();
  for (const ticket of tickets) {
    if (!totals[ticket.currency]) totals[ticket.currency] = blankTotals();
    addTotals(totals[ticket.currency], ticket);
    addMoney(collected, ticket.currency, ticket.collectedCents);
    addMoney(scheduled, ticket.currency, ticket.scheduledCents);
  }

  const overdueRows = db.prepare(`
    SELECT r.currency AS currency, COUNT(DISTINCT r.id) AS registrations,
      COALESCE(SUM(i.amount_cents - i.amount_paid_cents), 0) AS cents
    FROM registration_installments i
    JOIN registrations r ON r.id = i.registration_id
    JOIN ticket_products p ON p.id = r.product_id
    WHERE r.status = 'confirmed' AND p.code NOT LIKE ?
      AND i.status = 'due' AND i.due_on < ? AND i.amount_cents > i.amount_paid_cents
    GROUP BY r.currency
  `).all(TEST_PRODUCT, today);
  const overdue = moneyBucket();
  let overdueRegistrations = 0;
  for (const row of overdueRows) {
    addMoney(overdue, row.currency, Number(row.cents) || 0);
    overdueRegistrations += Number(row.registrations) || 0;
  }

  const seatsConfirmed = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE r.status != 'cancelled' AND p.code NOT LIKE ?
  `).get(TEST_PRODUCT).count) || 0;
  const cancelledToDate = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE r.status = 'cancelled' AND p.code NOT LIKE ?
  `).get(TEST_PRODUCT).count) || 0;

  const created = norm("r.created_at");
  const activityRegistrations = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE r.status != 'cancelled' AND p.code NOT LIKE ?
      AND ${created} >= ? AND ${created} < ?
  `).get(TEST_PRODUCT, from, until).count) || 0;

  const recorded = norm("pay.recorded_at");
  const paymentRowsWindow = db.prepare(`
    SELECT pay.currency AS currency, COUNT(*) AS count, COALESCE(SUM(pay.amount_cents), 0) AS cents
    FROM payments pay
    JOIN registrations r ON r.id = pay.registration_id
    JOIN ticket_products p ON p.id = r.product_id
    WHERE r.status != 'cancelled' AND p.code NOT LIKE ? AND COALESCE(pay.method, '') != 'comp'
      AND ${recorded} >= ? AND ${recorded} < ?
    GROUP BY pay.currency
  `).all(TEST_PRODUCT, from, until);
  const activityCollected = moneyBucket();
  let paymentCount = 0;
  for (const row of paymentRowsWindow) {
    addMoney(activityCollected, row.currency, Number(row.cents) || 0);
    paymentCount += Number(row.count) || 0;
  }

  const held = norm("r.payment_hold_cancelled_at");
  const audited = norm("a.created_at");
  const cancellations = Number(db.prepare(`
    SELECT COUNT(DISTINCT r.id) AS count
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    LEFT JOIN admin_audit a ON a.action = 'registration.cancel' AND a.target = r.reference
      AND ${audited} >= ? AND ${audited} < ?
    WHERE r.status = 'cancelled' AND p.code NOT LIKE ?
      AND ((${held} >= ? AND ${held} < ?) OR a.id IS NOT NULL)
  `).get(from, until, TEST_PRODUCT, from, until).count) || 0;

  const planRows = db.prepare(`
    SELECT r.id, r.full_name, r.chapter, r.currency, i.due_on, i.amount_cents, i.amount_paid_cents, i.status
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    JOIN registration_installments i ON i.registration_id = r.id
    WHERE r.status = 'confirmed' AND r.payment_plan = 'installment' AND r.fully_paid_at IS NULL
      AND p.code NOT LIKE ?
    ORDER BY r.id, i.sequence
  `).all(TEST_PRODUCT);
  const grouped = new Map();
  for (const row of planRows) {
    if (!grouped.has(row.id)) grouped.set(row.id, { id: row.id, name: row.full_name, chapter: row.chapter, currency: row.currency, items: [] });
    grouped.get(row.id).items.push(row);
  }

  const bandState = new Map(BANDS.map((band) => [band.key, { count: 0, overdue: moneyBucket() }]));
  const atRisk = [];
  let reached15 = 0;
  const yesterday = addDays(today, -1);
  for (const plan of grouped.values()) {
    const placed = classifyPlan(plan.items, today);
    const band = bandState.get(placed.key);
    band.count += 1;
    addMoney(band.overdue, plan.currency, placed.overdueCents);
    if (placed.oldest && placed.days > 15 && daysBetween(placed.oldest, yesterday) <= 15) reached15 += 1;
    if (placed.days >= 13 && placed.days <= 15) {
      atRisk.push({
        name: plan.name,
        chapter: plan.chapter || "",
        cents: placed.overdueCents,
        currency: plan.currency,
        daysLate: placed.days,
        movesOn: addDays(placed.oldest, 16),
      });
    }
  }
  atRisk.sort((left, right) => right.daysLate - left.daysLate || left.name.localeCompare(right.name));
  const atRiskTotals = moneyBucket();
  for (const person of atRisk) addMoney(atRiskTotals, person.currency, person.cents);

  const bands = shareWidths(BANDS.map((band) => ({
    ...band,
    count: bandState.get(band.key).count,
    overdue: bandState.get(band.key).overdue,
  })));

  const methods = paymentRows(collectPaymentMethods(db), "PHP");
  const usdList = paymentRows(collectPaymentMethods(db), "USD");
  const usdPayments = usdList.reduce((sum, row) => ({ cents: sum.cents + row.cents, count: sum.count + row.count }), { cents: 0, count: 0 });

  const open = tickets.filter((ticket) => ticket.phase === "open");
  const upcoming = tickets.filter((ticket) => ticket.phase === "later").sort((left, right) => left.salesStart.localeCompare(right.salesStart));
  const notes = [];
  if (open.length) notes.push(open.map((ticket) => `${ticket.name} is open through ${shortDate(ticket.salesEnd, today)}.`).join(" "));
  if (upcoming[0]) notes.push(`${upcoming[0].name} (${upcoming[0].priceLabel}) opens ${shortDate(upcoming[0].salesStart, today)}.`);
  const nextDue = db.prepare("SELECT MIN(due_on) AS due_on FROM installment_plan_items WHERE due_on IS NOT NULL AND due_on >= ?").get(today)?.due_on;
  if (nextDue) {
    const lead = Number(db.prepare(`
      SELECT MAX(days_before) AS days FROM reminder_rules
      WHERE trigger = 'before_due' AND channel = 'email' AND enabled = 1
    `).get()?.days);
    const days = Number.isFinite(lead) ? lead : 7;
    notes.push(`Next installment date is ${shortDate(nextDue, today)}. Reminders go out ${shortDate(addDays(nextDue, -days), today)}.`);
  }

  const late15 = bandState.get("day15").count;
  const chapters = db.prepare(`
    SELECT TRIM(r.chapter) AS name, COUNT(*) AS count
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE r.status != 'cancelled'
      AND p.code NOT LIKE ?
      AND TRIM(COALESCE(r.chapter, '')) != ''
    GROUP BY TRIM(r.chapter)
    ORDER BY COUNT(*) DESC, TRIM(r.chapter)
  `).all(TEST_PRODUCT).map((row) => ({ name: row.name, count: Number(row.count) }));
  return {
    asOf,
    windowStart,
    today,
    seatsConfirmed,
    cancelledToDate,
    collected,
    scheduled,
    overdue,
    overdueRegistrations,
    overdueAlert: overdueRegistrations > 0 || Object.values(overdue).some((cents) => cents > 0),
    late15,
    activity: {
      registrations: activityRegistrations,
      paymentCount,
      collected: activityCollected,
      cancellations,
      reached15,
    },
    tickets,
    totals,
    health: {
      total: grouped.size,
      bands,
      atRisk,
      atRiskShown: atRisk.slice(0, AT_RISK_LIMIT),
      atRiskHidden: Math.max(0, atRisk.length - AT_RISK_LIMIT),
      atRiskTotals,
    },
    methods,
    usdPayments,
    notes,
    chapters,
  };
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recipientsFrom(options) {
  if (Array.isArray(options.to)) return options.to.flatMap((value) => reportRecipients(value));
  return reportRecipients();
}

export async function runDailyReport(db, now = new Date(), options = {}) {
  const force = options.force === true;
  const clock = manilaParts(now);
  if (!force && (clock.time < SEND_AFTER || clock.time >= SEND_BEFORE)) {
    return { status: "waiting", date: clock.date };
  }
  if (!force && !Array.isArray(options.to) && !assessProductionLiveDeploymentIdentity().allowed) {
    return { status: "skipped", reason: "not_production", date: clock.date };
  }
  const recipients = recipientsFrom(options);
  if (!recipients.length) return { status: "skipped", reason: "no_recipients", date: clock.date };

  const asOf = force ? now : atManila(clock.date, 9, 0);
  const reportOn = manilaParts(asOf).date;
  const report = buildDailyReport(db, asOf);
  const rendered = renderDailyReport(report);
  const results = [];

  for (let index = 0; index < recipients.length; index += 1) {
    const recipient = recipients[index];
    if (index > 0) await pause(600);
    if (!force) {
      const existing = db.prepare("SELECT id, status FROM daily_report_sends WHERE report_on = ? AND recipient = ?").get(reportOn, recipient);
      if (existing?.status === "sent") {
        results.push({ recipient, status: "sent", duplicate: true });
        continue;
      }
      if (existing) db.prepare("DELETE FROM daily_report_sends WHERE id = ?").run(existing.id);
    }
    const stamp = force ? `${reportOn}T${manilaParts(asOf).time}` : reportOn;
    const outcome = await sendEmail({
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `daily-report/${force ? "manual" : "scheduled"}/${stamp}/${recipient}`,
      deliveryKind: "daily_report",
      bypassSafeMode: force,
    });
    if (!force) {
      db.prepare(`
        INSERT INTO daily_report_sends (report_on, recipient, status, provider_id, error)
        VALUES (?, ?, ?, ?, ?)
      `).run(reportOn, recipient, outcome.status, outcome.providerId || null, outcome.error || null);
    }
    results.push({ recipient, status: outcome.status, providerId: outcome.providerId || null, error: outcome.error || null });
  }

  const status = results.every((row) => row.duplicate) ? "already_sent" : "sent";
  if (!force && results.some((row) => row.status === "sent" && !row.duplicate)) {
    console.log(`Daily report ${reportOn} sent to ${results.filter((row) => row.status === "sent").length} recipient(s)`);
  }
  return { status, date: reportOn, results };
}

export function startDailyReportLoop(db) {
  const tick = () => {
    runDailyReport(db).catch((error) => {
      console.error("Daily report failed:", error.message);
      reportError(error);
    });
  };
  tick();
  const timer = setInterval(tick, 15 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await import("dotenv/config");
  const db = openDatabase();
  const recipient = process.argv[2];
  const result = await runDailyReport(db, new Date(), {
    force: true,
    to: recipient ? [recipient] : undefined,
  });
  console.log(JSON.stringify({
    status: result.status,
    date: result.date,
    reason: result.reason || null,
    results: (result.results || []).map((row) => ({
      recipient: row.recipient,
      status: row.status,
      providerId: row.providerId || null,
      error: row.error || null,
    })),
  }, null, 2));
  if (result.status === "skipped" || result.results?.some((row) => row.status !== "sent")) process.exitCode = 1;
}

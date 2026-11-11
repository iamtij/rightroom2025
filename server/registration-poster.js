import { formatMoney } from "./time.js";
import { renderPosterJpeg } from "./registration-poster-image.js";

const POSTER_TO = "tjtalusan@gmail.com";
const TEST_PRODUCT = "test%";

function manilaParts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h12",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
}

function manilaDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

function stamp(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function posterRecipients(value = process.env.REGISTRATION_POSTER_TO) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return process.env.REGISTRATION_POSTER_TO === "" ? [] : [POSTER_TO];
  }
  const seen = new Set();
  const list = [];
  for (const part of String(value).split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || seen.has(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) continue;
    seen.add(email);
    list.push(email);
  }
  return list;
}

export function buildRegistrationPoster(db, asOf = new Date()) {
  const today = manilaDate(asOf);
  const since = stamp(new Date(asOf.getTime() - 24 * 60 * 60 * 1000));
  const created = `REPLACE(SUBSTR(COALESCE(r.created_at, ''), 1, 19), 'T', ' ')`;
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN r.status = 'confirmed' AND r.fully_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS full_paid,
      SUM(CASE WHEN r.status = 'confirmed' AND r.payment_plan = 'installment' AND r.fully_paid_at IS NULL THEN 1 ELSE 0 END) AS installment,
      SUM(CASE WHEN r.status = 'confirmed'
        AND (r.fully_paid_at IS NOT NULL OR (r.payment_plan = 'installment' AND r.fully_paid_at IS NULL))
        AND ${created} >= ? THEN 1 ELSE 0 END) AS since_yesterday
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE p.code NOT LIKE ?
  `).get(since, TEST_PRODUCT);
  const fullPaid = Number(counts.full_paid) || 0;
  const installments = Number(counts.installment) || 0;
  const chapters = db.prepare(`
    SELECT TRIM(r.chapter) AS name, COUNT(*) AS count
    FROM registrations r
    JOIN ticket_products p ON p.id = r.product_id
    WHERE lower(r.status) = 'confirmed'
      AND r.payment_hold_cancelled_at IS NULL
      AND p.code NOT LIKE ?
      AND TRIM(COALESCE(r.chapter, '')) != ''
    GROUP BY TRIM(r.chapter)
    ORDER BY COUNT(*) DESC, TRIM(r.chapter)
  `).all(TEST_PRODUCT).map((row) => ({ name: row.name, count: Number(row.count) }));
  const products = db.prepare(`
    SELECT name, full_price_cents, currency, sales_start, sales_end
    FROM ticket_products
    WHERE code NOT LIKE ?
    ORDER BY sales_start, id
  `).all(TEST_PRODUCT);
  const open = products.find((product) => today >= product.sales_start && today <= product.sales_end) || products[0];
  const next = products.find((product) => product.sales_start > (open?.sales_end || today));
  const clock = manilaParts(asOf);
  const bannerTitle = open ? `${open.name} · ${formatMoney(open.full_price_cents, open.currency)}` : "Registration";
  const bannerNote = [
    open ? `Ends ${shortDate(open.sales_end, today)}` : "",
    next ? `${next.name} is ${formatMoney(next.full_price_cents, next.currency)}` : "",
  ].filter(Boolean).join(" · ");
  return {
    asOf,
    asOfLabel: `${clock.weekday}, ${clock.month} ${clock.day}, ${clock.year} · ${clock.hour}:${clock.minute} ${clock.dayPeriod.toUpperCase()}`,
    subjectDate: `${clock.month} ${clock.day}, ${clock.year}`,
    paid: fullPaid + installments,
    fullPaid,
    installments,
    sinceYesterday: Number(counts.since_yesterday) || 0,
    daysLeft: open ? Math.max(0, daysBetween(today, open.sales_end)) : 0,
    bannerTitle,
    bannerNote,
    chapters,
  };
}

export function renderRegistrationPoster(poster) {
  const jpeg = renderPosterJpeg(poster);
  const subject = `IBMC 2027 Registration update · ${poster.subjectDate}`;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${poster.bannerTitle}</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;">
  <img src="cid:registration-poster" width="800" alt="IBMC 2027 registration update" style="display:block;width:100%;max-width:800px;height:auto;border:0;">
</body>
</html>`;
  const text = [
    "IBMC 2027",
    "Registration update",
    `As of ${poster.asOfLabel}`,
    "",
    `Paid registrations: ${poster.paid}`,
    `Paid in full: ${poster.fullPaid}`,
    `Installment: ${poster.installments}`,
    `Since yesterday: ${poster.sinceYesterday}`,
    poster.bannerTitle,
    poster.bannerNote,
    `${poster.daysLeft} days left`,
    "",
    "Chapters",
    ...poster.chapters.map((chapter) => `${chapter.name}: ${chapter.count}`),
  ].join("\n");
  return {
    subject,
    html,
    text,
    jpeg,
    filename: "IBMC-2027-registration-update.jpg",
  };
}

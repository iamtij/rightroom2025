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
  };
}

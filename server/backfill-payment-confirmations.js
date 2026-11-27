import "dotenv/config";
import { pathToFileURL } from "url";
import { openDatabase, registrationBalance } from "./db.js";
import { sendPaymentConfirmation } from "./reminders.js";

function parseArgs(argv) {
  const send = argv.includes("--send");
  const dryRun = argv.includes("--dry-run") || !send;
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : null;
  return { dryRun, send, limit: Number.isFinite(limit) && limit > 0 ? limit : null };
}

/** Registrations with installment 1 paid, seat not fully paid, at least one ledger payment. */
export function listFirstPaymentBackfillTargets(db) {
  const rows = db.prepare(`
    SELECT
      r.id AS registration_id,
      r.reference,
      r.email,
      r.full_name,
      i.id AS installment_id,
      (
        SELECT p.id FROM payments p
        WHERE p.registration_id = r.id AND p.installment_id = i.id
        ORDER BY p.id ASC LIMIT 1
      ) AS payment_id
    FROM registrations r
    INNER JOIN registration_installments i ON i.registration_id = r.id AND i.sequence = 1
    WHERE r.status = 'confirmed'
      AND r.fully_paid_at IS NULL
      AND i.status = 'paid'
      AND i.amount_paid_cents >= i.amount_cents
      AND r.email IS NOT NULL AND trim(r.email) != ''
  `).all();

  return rows
    .filter((row) => {
      if (!row.payment_id) return false;
      if (registrationBalance(db, row.registration_id) === 0) return false;
      const sent = db.prepare(`
        SELECT status FROM reminder_dispatches
        WHERE dispatch_key = ? AND template_key = 'payment_confirmation'
      `).get(`payment:${row.payment_id}`);
      return sent?.status !== "sent";
    })
    .map((row) => ({
      registrationId: row.registration_id,
      reference: row.reference,
      email: row.email,
      fullName: row.full_name,
      paymentId: row.payment_id,
    }));
}

export async function sendFirstPaymentBackfill(db, options = {}) {
  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : null;
  let targets = listFirstPaymentBackfillTargets(db);
  const total = targets.length;
  if (limit) targets = targets.slice(0, limit);

  const summary = {
    mode: "send",
    eligible: total,
    planned: targets.length,
    targets: targets.map((t) => ({ reference: t.reference, email: t.email, paymentId: t.paymentId })),
  };

  const results = { sent: 0, failed: 0, skipped: 0, errors: [] };
  for (const target of targets) {
    const outcome = await sendPaymentConfirmation(db, target.registrationId, target.paymentId);
    if (outcome.ok && outcome.skipped) results.skipped += 1;
    else if (outcome.ok) results.sent += 1;
    else {
      results.failed += 1;
      results.errors.push({ reference: target.reference, error: outcome.error || outcome.status });
    }
  }
  return { ...summary, results };
}

async function main() {
  const { dryRun, send, limit } = parseArgs(process.argv.slice(2));
  const db = openDatabase();
  const total = listFirstPaymentBackfillTargets(db).length;
  const summary = {
    mode: dryRun ? "dry-run" : "send",
    eligible: total,
    planned: limit ? Math.min(limit, total) : total,
    skippedFullyPaid: 0,
    targets: listFirstPaymentBackfillTargets(db)
      .slice(0, limit || undefined)
      .map((t) => ({ reference: t.reference, email: t.email, paymentId: t.paymentId })),
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const payload = await sendFirstPaymentBackfill(db, { limit });
  console.log(JSON.stringify(payload, null, 2));
  if (payload.results.failed) process.exit(1);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

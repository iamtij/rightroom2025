import { pathToFileURL } from "url";
import { openDatabase, registrationBalance } from "./db.js";
import { createRegistration, getRegistration, recordPayment } from "./registrations.js";
import { sendEmail, sendSms } from "./providers.js";
import { renderEntryPass, renderInstallmentReminder, renderPaymentConfirmation } from "./templates.js";
import { addDays, formatLongDate, manilaParts } from "./time.js";

export { createRegistration, getRegistration, recordPayment };

const PASS_MARKERS = ["/pass/", "<svg", "open my qr ticket"];

function siteUrl() {
  return (process.env.SITE_URL || "https://ibmcph.com").replace(/\/$/, "");
}

function looksLikePass(rendered) {
  const text = `${rendered.subject}\n${rendered.body}\n${rendered.html || ""}`.toLowerCase();
  return PASS_MARKERS.some((marker) => text.includes(marker));
}

function reminderApplies(db, rule, installment) {
  if (installment.product_code !== "test_200") return true;
  if (rule.channel !== "email" || rule.days_before !== 1 || installment.sequence === 1) return false;
  const anchor = db.prepare(`
    SELECT status, amount_paid_cents, amount_cents
    FROM registration_installments
    WHERE registration_id = ? AND sequence = 1
  `).get(installment.registration_id);
  return Boolean(anchor && anchor.status === "paid" && anchor.amount_paid_cents >= anchor.amount_cents);
}

function installmentStillDue(db, installmentId) {
  const row = db.prepare(`
    SELECT i.status, i.amount_cents, i.amount_paid_cents, r.status AS registration_status, r.fully_paid_at
    FROM registration_installments i
    JOIN registrations r ON r.id = i.registration_id
    WHERE i.id = ?
  `).get(installmentId);
  if (!row || row.registration_status !== "confirmed" || row.fully_paid_at) return false;
  return row.status === "due" && row.amount_paid_cents < row.amount_cents;
}

async function deliver(channel, recipient, rendered, idempotencyKey, deliveryKind = "general") {
  if (channel === "email") {
    return sendEmail({
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.body,
      idempotencyKey,
      deliveryKind,
    });
  }
  return sendSms({ to: recipient, message: rendered.body });
}

function insertDispatch(db, row, result) {
  db.prepare(`
    INSERT INTO reminder_dispatches (
      dispatch_key, registration_id, installment_id, rule_id, channel, template_key,
      recipient, subject, body, html, includes_qr, status, provider_id, error, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.dispatchKey,
    row.registrationId,
    row.installmentId,
    row.ruleId,
    row.channel,
    row.templateKey,
    row.recipient,
    row.subject,
    row.body,
    row.html,
    row.includesQr ? 1 : 0,
    result.status,
    result.providerId || null,
    result.error || null,
    result.status === "sent" ? new Date().toISOString() : null,
  );
}

function providerReady(channel) {
  if (channel === "email") return Boolean(process.env.RESEND_API_KEY);
  if (channel === "sms") return Boolean(process.env.SEMAPHORE_API_KEY);
  return false;
}

async function queue(db, row, rendered) {
  if (row.templateKey === "installment_reminder" && !installmentStillDue(db, row.installmentId)) return false;
  const existing = db.prepare("SELECT id, status, error FROM reminder_dispatches WHERE dispatch_key = ?").get(row.dispatchKey);
  if (existing) {
    const retryable = existing.status !== "sent"
      && existing.status === "skipped"
      && (existing.error === "provider_not_configured" || existing.error === "staging_safe_mode")
      && providerReady(row.channel);
    if (!retryable) return false;
    db.prepare("DELETE FROM reminder_dispatches WHERE id = ?").run(existing.id);
  }
  const pass = looksLikePass(rendered);
  if ((row.templateKey !== "entry_pass" && (rendered.includesQr || pass)) || (rendered.includesQr && registrationBalance(db, row.registrationId) !== 0)) {
    insertDispatch(db, { ...row, ...rendered, includesQr: false }, { status: "failed", error: "qr_blocked" });
    return true;
  }
  const deliveryKind = row.templateKey === "entry_pass" ? "entry_pass" : "general";
  const result = await deliver(row.channel, row.recipient, rendered, `${row.templateKey}/${row.dispatchKey}`, deliveryKind);
  insertDispatch(db, { ...row, ...rendered }, result);
  return true;
}

export async function sendEntryPassForRegistration(db, registrationId, { force = false } = {}) {
  const registration = getRegistration(db, registrationId);
  if (!registration?.qr_token || registration.balance_cents !== 0 || !registration.fully_paid_at) {
    return { ok: false, error: "not_fully_paid" };
  }
  const rule = db.prepare(`
    SELECT * FROM reminder_rules
    WHERE enabled = 1 AND trigger = 'fully_paid' AND channel = 'email' AND template_key = 'entry_pass'
    LIMIT 1
  `).get();
  if (!rule) return { ok: false, error: "no_rule" };
  const dispatchKey = `reg:${registration.id}:rule:${rule.id}`;
  if (force) db.prepare("DELETE FROM reminder_dispatches WHERE dispatch_key = ?").run(dispatchKey);
  const passUrl = `${siteUrl()}/pass/${registration.qr_token}`;
  const rendered = await renderEntryPass({ registration, passUrl });
  const queued = await queue(db, {
    dispatchKey,
    registrationId: registration.id,
    installmentId: null,
    ruleId: rule.id,
    channel: rule.channel,
    templateKey: rule.template_key,
    recipient: registration.email,
  }, rendered);
  const row = db.prepare("SELECT status, error FROM reminder_dispatches WHERE dispatch_key = ?").get(dispatchKey);
  return { ok: queued && row?.status === "sent", status: row?.status, error: row?.error || (queued ? null : "not_queued") };
}

export function queueEntryPassAfterPayment(db, registrationId) {
  void sendEntryPassForRegistration(db, registrationId).catch((error) => {
    console.error("Entry pass email failed:", error.message);
  });
}

export async function sendPaymentConfirmation(db, registrationId, paymentId) {
  const payment = db.prepare(`
    SELECT id, installment_id, amount_cents, method
    FROM payments WHERE id = ? AND registration_id = ?
  `).get(paymentId, registrationId);
  if (!payment) return { ok: false, error: "payment_not_found" };
  const registration = getRegistration(db, registrationId);
  if (!registration?.email || registration.status !== "confirmed") {
    return { ok: false, error: "registration_not_emailable" };
  }
  const installment = registration.installments.find((item) => item.id === payment.installment_id);
  if (!installment) return { ok: false, error: "installment_not_found" };
  const payUrl = `${siteUrl()}/pay/${registration.reference}`;
  const manageUrl = `${siteUrl()}/register`;
  const rendered = renderPaymentConfirmation({
    registration,
    installment,
    amountCents: payment.amount_cents,
    payUrl,
    manageUrl,
  });
  const dispatchKey = `payment:${payment.id}`;
  const existing = db.prepare("SELECT id, status FROM reminder_dispatches WHERE dispatch_key = ?").get(dispatchKey);
  if (existing?.status === "sent") return { ok: true, status: "sent", skipped: true };
  if (existing) db.prepare("DELETE FROM reminder_dispatches WHERE id = ?").run(existing.id);
  const rule = db.prepare(`
    SELECT id FROM reminder_rules
    WHERE enabled = 1 AND trigger = 'fully_paid' AND channel = 'email'
    LIMIT 1
  `).get();
  const result = await deliver("email", registration.email, rendered, `payment_confirmation/${dispatchKey}`, "payment_confirmation");
  if (!rule?.id) return { ok: result.status === "sent", status: result.status, error: result.error };
  const row = {
    dispatchKey,
    registrationId: registration.id,
    installmentId: installment.id,
    ruleId: rule.id,
    channel: "email",
    templateKey: "payment_confirmation",
    recipient: registration.email,
    ...rendered,
    includesQr: false,
  };
  insertDispatch(db, row, result);
  return { ok: result.status === "sent", status: result.status, error: result.error };
}

export function queuePaymentConfirmationAfterPayment(db, registrationId, paymentId) {
  void sendPaymentConfirmation(db, registrationId, paymentId).catch((error) => {
    console.error("Payment confirmation email failed:", error.message);
  });
}

export async function runReminders(db, now = new Date()) {
  const clock = manilaParts(now);
  const rules = db.prepare("SELECT * FROM reminder_rules WHERE enabled = 1").all();
  let created = 0;

  for (const rule of rules) {
    if (rule.trigger === "before_due") {
      const due = db.prepare(`
        SELECT i.*, r.email, r.mobile, r.full_name, r.reference, r.currency, r.qr_token, p.code AS product_code
        FROM registration_installments i
        JOIN registrations r ON r.id = i.registration_id
        JOIN ticket_products p ON p.id = r.product_id
        WHERE i.status = 'due'
          AND i.amount_paid_cents < i.amount_cents
          AND r.status = 'confirmed'
          AND r.fully_paid_at IS NULL
      `).all();
      for (const installment of due) {
        if (!reminderApplies(db, rule, installment)) continue;
        if (addDays(installment.due_on, -rule.days_before) !== clock.date) continue;
        if (clock.time < rule.send_time) continue;
        const registration = getRegistration(db, installment.registration_id);
        const rendered = renderInstallmentReminder({
          registration,
          installment,
          daysBefore: rule.days_before,
          payUrl: `${siteUrl()}/pay/${registration.reference}`,
        });
        const queued = await queue(db, {
          dispatchKey: `inst:${installment.id}:rule:${rule.id}`,
          registrationId: registration.id,
          installmentId: installment.id,
          ruleId: rule.id,
          channel: rule.channel,
          templateKey: rule.template_key,
          recipient: rule.channel === "email" ? registration.email : registration.mobile,
        }, rendered);
        if (queued) created += 1;
      }
    }

    if (rule.trigger === "fully_paid") {
      const paid = db.prepare(`
        SELECT id FROM registrations
        WHERE status = 'confirmed' AND qr_token IS NOT NULL AND fully_paid_at IS NOT NULL
      `).all();
      for (const row of paid) {
        const registration = getRegistration(db, row.id);
        if (registration.balance_cents !== 0) continue;
        const passUrl = `${siteUrl()}/pass/${registration.qr_token}`;
        const rendered = await renderEntryPass({ registration, passUrl });
        const queued = await queue(db, {
          dispatchKey: `reg:${registration.id}:rule:${rule.id}`,
          registrationId: registration.id,
          installmentId: null,
          ruleId: rule.id,
          channel: rule.channel,
          templateKey: rule.template_key,
          recipient: rule.channel === "email" ? registration.email : registration.mobile,
        }, rendered);
        if (queued) created += 1;
      }
    }
  }

  created += await runCustomSchedules(db, clock);
  return created;
}

async function runCustomSchedules(db, clock) {
  const schedules = db.prepare(`
    SELECT s.*, t.channel, t.subject, t.body
    FROM message_schedules s
    JOIN message_templates t ON t.id = s.template_id
    WHERE s.enabled = 1
  `).all();
  let created = 0;
  for (const schedule of schedules) {
    const targets = scheduleTargets(db, schedule);
    for (const target of targets) {
      const sentCount = db.prepare("SELECT COUNT(*) AS count FROM schedule_sends WHERE schedule_id = ? AND registration_id = ?").get(schedule.id, target.registrationId).count;
      if (!scheduleIsDue(schedule, target.firstOn, clock, sentCount)) continue;
      const key = schedule.frequency === "once"
        ? `sched:${schedule.id}:reg:${target.registrationId}:inst:${target.installmentId || 0}`
        : `sched:${schedule.id}:reg:${target.registrationId}:inst:${target.installmentId || 0}:${clock.date}`;
      if (db.prepare("SELECT id FROM schedule_sends WHERE send_key = ?").get(key)) continue;
      const rendered = fillScheduleTemplate(schedule, target);
      const result = schedule.channel === "email"
        ? await sendEmail({ to: target.email, subject: rendered.subject, html: rendered.html, text: rendered.body, idempotencyKey: `schedule/${key}` })
        : await sendSms({ to: target.mobile, message: rendered.body });
      db.prepare(`
        INSERT INTO schedule_sends (send_key, schedule_id, registration_id, sent_on, status) VALUES (?, ?, ?, ?, ?)
      `).run(key, schedule.id, target.registrationId, clock.date, result.status);
      created += 1;
    }
  }
  return created;
}

function scheduleTargets(db, schedule) {
  if (schedule.trigger === "before_due") {
    return db.prepare(`
      SELECT i.id AS installment_id, i.sequence AS installment_sequence, i.due_on, i.amount_cents, i.amount_paid_cents,
        (SELECT COUNT(*) FROM registration_installments c WHERE c.registration_id = i.registration_id) AS installment_count,
        r.*
      FROM registration_installments i
      JOIN registrations r ON r.id = i.registration_id
      WHERE r.status = 'confirmed' AND i.status = 'due'
    `).all().filter((row) => audienceMatches(schedule.audience, row)).map((row) => targetFrom(row, addDays(row.due_on, -schedule.days_offset), row.due_on));
  }
  return db.prepare(`
    SELECT r.*,
      (SELECT i.sequence FROM registration_installments i
        WHERE i.registration_id = r.id AND i.status = 'due' AND i.amount_paid_cents < i.amount_cents
        ORDER BY i.sequence LIMIT 1) AS installment_sequence,
      (SELECT COUNT(*) FROM registration_installments i WHERE i.registration_id = r.id) AS installment_count
    FROM registrations r
    WHERE r.status = 'confirmed'
  `).all()
    .filter((row) => audienceMatches(schedule.audience, row))
    .map((row) => targetFrom(row, schedule.trigger === "on_date" ? schedule.start_on : addDays(row.registered_on, schedule.days_offset), null));
}

function audienceMatches(audience, row) {
  if (audience === "all") return true;
  if (audience === "fully_paid") return Boolean(row.fully_paid_at);
  return !row.fully_paid_at;
}

function targetFrom(row, firstOn, dueOn) {
  return {
    registrationId: row.registration_id || row.id,
    installmentId: row.installment_id || null,
    email: row.email,
    mobile: row.mobile,
    firstOn,
    firstName: String(row.full_name || "").trim().split(/\s+/)[0] || "",
    reference: row.reference,
    dueOn,
    amountCents: row.amount_cents ? row.amount_cents - (row.amount_paid_cents || 0) : null,
    currency: row.currency,
    fullyPaid: Boolean(row.fully_paid_at),
    qrToken: row.qr_token,
    installmentLabel: row.payment_plan === "installment" && row.installment_sequence && row.installment_count
      ? `${row.installment_sequence} of ${row.installment_count}`
      : "",
  };
}

function scheduleIsDue(schedule, firstOn, clock, sentCount) {
  if (!firstOn || clock.date < firstOn) return false;
  if (schedule.ends_on && clock.date > schedule.ends_on) return false;
  if (schedule.ends_after && sentCount >= schedule.ends_after) return false;
  if (clock.time < (schedule.send_time || "09:00")) return false;
  const elapsed = daysBetween(firstOn, clock.date);
  if (schedule.frequency === "once") return elapsed === 0;
  if (schedule.frequency === "weekly") return elapsed % 7 === 0;
  return true;
}

function daysBetween(start, end) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return Math.round((Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / 86400000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fillScheduleTemplate(schedule, target) {
  const amount = target.amountCents == null ? "" : target.currency === "USD" ? `USD ${target.amountCents / 100}` : `P${target.amountCents / 100}`;
  const values = {
    first_name: target.firstName,
    amount,
    due_date: target.dueOn ? formatLongDate(target.dueOn) : "",
    pay_url: `${siteUrl()}/pay/${target.reference}`,
    reference: target.reference,
    pass_url: target.fullyPaid && target.qrToken ? `${siteUrl()}/pass/${target.qrToken}` : "",
    installment: target.installmentLabel || "",
  };
  const apply = (text, escape) => String(text || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => {
    const value = values[key] ?? "";
    return escape ? escapeHtml(value) : value;
  });
  const body = apply(schedule.body, false);
  let subject = apply(schedule.subject || "IBMC 2027", false);
  if (schedule.channel === "email" && target.installmentLabel && !subject.includes(target.installmentLabel)) {
    subject = `${subject} · ${target.installmentLabel}`;
  }
  return { subject, body, html: `<p>${escapeHtml(body).replaceAll("\n", "<br>")}</p>` };
}

export function startReminderLoop(db) {
  const tick = () => {
    runReminders(db).catch((error) => {
      console.error("Reminders failed:", error.message);
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
  const created = await runReminders(db);
  console.log(`Reminders recorded: ${created}`);
}

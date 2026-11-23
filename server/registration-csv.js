import { entryPassEligible, getRegistration } from "./registrations.js";

export const REGISTRATION_CSV_HEADERS = [
  "reference",
  "full_name",
  "email",
  "mobile",
  "business",
  "industry",
  "chapter",
  "attendee_type",
  "invited_by",
  "product_name",
  "product_code",
  "payment_plan",
  "currency",
  "total",
  "paid",
  "balance",
  "status",
  "plan_status",
  "registered_on",
  "fully_paid_at",
  "created_at",
  "coupon_code",
  "qr_ready",
];

export function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function moneyMajor(cents) {
  const amount = Number(cents) || 0;
  return (amount / 100).toFixed(2);
}

export function registrationPlanStatus(registration) {
  if (registration.status === "cancelled") return "cancelled";
  if (registration.balance_cents === 0) return "fully_paid";
  return registration.plan_status || "active";
}

export function registrationCsvCells(registration) {
  const totalCents = registration.amount_due_cents || 0;
  const balanceCents = registration.balance_cents || 0;
  const paidCents = totalCents - balanceCents;
  return [
    registration.reference,
    registration.full_name,
    registration.email,
    registration.mobile,
    registration.business || "",
    registration.industry || "",
    registration.chapter || "",
    registration.attendee_type || "",
    registration.invited_by || "",
    registration.product_name || "",
    registration.product_code || "",
    registration.payment_plan || "",
    registration.currency || "",
    moneyMajor(totalCents),
    moneyMajor(paidCents),
    moneyMajor(balanceCents),
    registration.status || "",
    registrationPlanStatus(registration),
    registration.registered_on || "",
    registration.fully_paid_at || "",
    registration.created_at || "",
    registration.coupon_code || "",
    entryPassEligible(registration) ? "yes" : "no",
  ];
}

export function buildRegistrationsCsv(db) {
  const rows = db.prepare(`
    SELECT r.id
    FROM registrations r
    ORDER BY r.created_at DESC, r.id DESC
  `).all();
  const lines = [REGISTRATION_CSV_HEADERS.map(csvEscape).join(",")];
  for (const row of rows) {
    const registration = getRegistration(db, row.id);
    if (!registration) continue;
    lines.push(registrationCsvCells(registration).map(csvEscape).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function registrationsCsvFilename(now = new Date()) {
  const stamp = now.toISOString().slice(0, 10);
  return `ibmc-registrations-${stamp}.csv`;
}

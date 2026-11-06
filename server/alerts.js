import { sendEmail } from "./providers.js";

const THRESHOLDS = {
  "admin.login.fail": 5,
  "upay.callback": 30,
  "pass.duplicate": 3,
};

export async function recordSecurityEvent(db, kind, detail = "") {
  const text = String(detail || "").slice(0, 200);
  db.prepare("INSERT INTO security_events (kind, detail) VALUES (?, ?)").run(kind, text);
  const recent = db.prepare(`
    SELECT COUNT(*) AS n FROM security_events
    WHERE kind = ? AND created_at >= datetime('now', '-1 hour')
  `).get(kind).n;
  const threshold = THRESHOLDS[kind];
  const notable = kind === "registration.comp" || kind === "registration.list" || kind === "member.list" || kind === "pass.override";
  if (!notable && (!threshold || recent < threshold || recent % threshold !== 0)) return;
  const to = String(process.env.ADMIN_EMAIL || "").trim();
  if (!to) return;
  await sendEmail({
    to,
    subject: `IBMC security: ${kind}`,
    text: `${kind} reached ${recent} in the last hour. ${text}`.trim(),
    idempotencyKey: `security/${kind}/${new Date().toISOString().slice(0, 13)}/${recent}`,
  }).catch((error) => {
    console.error("Security alert was not sent:", error instanceof Error ? error.message : "send failed");
  });
}

import { Resend } from "resend";
import { philippineMobile } from "./contact.js";
import { outboundEmailSuppressed, outboundSmsSuppressed } from "./staging-safe.js";

const SEMAPHORE_URL = "https://api.semaphore.co/api/v4/messages";

export { philippineMobile };

function senderName() {
  const name = (process.env.SMS_SENDER_NAME || "").trim();
  if (!/^[A-Za-z0-9]{1,11}$/.test(name)) return null;
  return name;
}

async function pause(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendEmail({ to, subject, html, text, idempotencyKey, deliveryKind = "general", headers, attachments, bypassSafeMode = false }) {
  if (!bypassSafeMode && outboundEmailSuppressed({ to, deliveryKind })) return { status: "skipped", error: "staging_safe_mode" };
  if (!process.env.RESEND_API_KEY) return { status: "skipped", error: "provider_not_configured" };
  const resend = new Resend(process.env.RESEND_API_KEY);
  const payload = {
    from: process.env.EMAIL_FROM || "IBMC 2027 <tickets@ibmcph.com>",
    to: [to],
    subject,
    html,
    text,
  };
  if (process.env.EMAIL_REPLY_TO) payload.replyTo = process.env.EMAIL_REPLY_TO;
  if (headers) payload.headers = headers;
  if (attachments?.length) payload.attachments = attachments;

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await resend.emails.send(payload, { idempotencyKey });
    if (!error) return { status: "sent", providerId: data?.id || null };
    lastError = error;
    const statusCode = error.statusCode || 0;
    if (statusCode !== 429 && statusCode < 500) break;
    await pause(300 * (attempt + 1));
  }
  return { status: "failed", error: lastError?.message || "email_failed" };
}

export async function sendSms({ to, message }) {
  if (outboundSmsSuppressed()) return { status: "skipped", error: "staging_safe_mode" };
  if (!process.env.SEMAPHORE_API_KEY) return { status: "skipped", error: "provider_not_configured" };
  const number = philippineMobile(to);
  if (!number) return { status: "failed", error: "mobile_not_philippine" };
  if (/^\s*test\b/i.test(message)) return { status: "failed", error: "sms_starts_with_test" };

  const body = new URLSearchParams({
    apikey: process.env.SEMAPHORE_API_KEY,
    number,
    message,
  });
  const from = senderName();
  if (from) body.set("sendername", from);

  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(SEMAPHORE_URL, { method: "POST", body });
    if (response.status !== 429) break;
    const wait = Number(response.headers.get("retry-after")) || 1;
    await pause(Math.min(wait, 2) * 1000);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.message || payload.sendername?.[0] || payload.apikey?.[0] || `sms ${response.status}`;
    return { status: "failed", error: detail };
  }
  const messageRow = Array.isArray(payload) ? payload[0] : payload;
  if (!messageRow?.message_id) return { status: "failed", error: "sms_missing_id" };
  return { status: "sent", providerId: String(messageRow.message_id) };
}

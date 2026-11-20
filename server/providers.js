import { Resend } from "resend";
import { philippineMobile } from "./contact.js";
import { outboundEmailSuppressed, outboundSmsSuppressed } from "./staging-safe.js";

const SEMAPHORE_URL = "https://api.semaphore.co/api/v4/messages";
export const SEMAPHORE_BULK_MAX_NUMBERS = 1000;

export { philippineMobile };

/**
 * Normalize a Philippine mobile to Semaphore API format (639XXXXXXXXX).
 * Local DB / phone_key stay on 09… via philippineMobile.
 */
export function semaphoreMobile(value) {
  const local = philippineMobile(value);
  if (!local) return null;
  return `63${local.slice(1)}`;
}

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

async function postSemaphore(body) {
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(SEMAPHORE_URL, { method: "POST", body });
    if (response.status !== 429) break;
    const wait = Number(response.headers.get("retry-after")) || 1;
    await pause(Math.min(wait, 2) * 1000);
  }
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function semaphoreError(payload, status) {
  const body = payload && typeof payload === "object" ? payload : {};
  return body.message || body.sendername?.[0] || body.apikey?.[0] || body.number?.[0] || `sms ${status}`;
}

export function readSemaphoreSend(response, payload) {
  if (!response?.ok || !Array.isArray(payload) || payload.length === 0 || payload.some((row) => !row?.message_id)) {
    return { status: "failed", error: Array.isArray(payload) ? "sms_missing_id" : semaphoreError(payload, response?.status), results: [] };
  }
  return { status: "sent", results: payload };
}

export async function sendSms({ to, message }) {
  if (outboundSmsSuppressed()) return { status: "skipped", error: "staging_safe_mode" };
  if (!process.env.SEMAPHORE_API_KEY) return { status: "skipped", error: "provider_not_configured" };
  const number = semaphoreMobile(to);
  if (!number) return { status: "failed", error: "mobile_not_philippine" };
  if (/^\s*test\b/i.test(message)) return { status: "failed", error: "sms_starts_with_test" };

  const body = new URLSearchParams({
    apikey: process.env.SEMAPHORE_API_KEY,
    number,
    message,
  });
  const from = senderName();
  if (from) body.set("sendername", from);

  const { response, payload } = await postSemaphore(body);
  const parsed = readSemaphoreSend(response, payload);
  if (parsed.status !== "sent") return { status: "failed", error: parsed.error };
  return { status: "sent", providerId: String(parsed.results[0].message_id) };
}

/**
 * Send the same SMS to many numbers via Semaphore bulk `number` (comma-separated, ≤1000).
 * Dedupes and chunks automatically. Never throws.
 */
export async function sendSmsBulk(numbers, message) {
  if (outboundSmsSuppressed()) return { status: "skipped", error: "staging_safe_mode", results: [] };
  if (!process.env.SEMAPHORE_API_KEY) return { status: "skipped", error: "provider_not_configured", results: [] };
  const body = String(message || "").trim();
  if (!body) return { status: "failed", error: "empty_message", results: [] };
  if (/^\s*test\b/i.test(body)) return { status: "failed", error: "sms_starts_with_test", results: [] };

  const formatted = [...new Set((Array.isArray(numbers) ? numbers : []).map(semaphoreMobile).filter(Boolean))];
  if (!formatted.length) return { status: "failed", error: "no_valid_numbers", results: [] };

  const from = senderName();
  const results = [];
  for (let i = 0; i < formatted.length; i += SEMAPHORE_BULK_MAX_NUMBERS) {
    const chunk = formatted.slice(i, i + SEMAPHORE_BULK_MAX_NUMBERS);
    const params = new URLSearchParams({
      apikey: process.env.SEMAPHORE_API_KEY,
      number: chunk.join(","),
      message: body,
    });
    if (from) params.set("sendername", from);
    const { response, payload } = await postSemaphore(params);
    const parsed = readSemaphoreSend(response, payload);
    if (parsed.status !== "sent") {
      return {
        status: "failed",
        error: parsed.error,
        results,
        failedNumbers: chunk,
      };
    }
    results.push(...parsed.results);
    if (i + SEMAPHORE_BULK_MAX_NUMBERS < formatted.length) await pause(100);
  }
  return { status: "sent", results, numbers: formatted };
}

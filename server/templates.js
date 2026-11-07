import QRCode from "qrcode";
import { daysLabel, formatLongDate, formatMoney } from "./time.js";

const EVENT = "June 16–17, 2027 · Newport Performing Arts Theater, Pasay City";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function firstName(fullName) {
  return fullName.trim().split(/\s+/)[0];
}

function shell({ headline, intro, body, action }) {
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;background:#F6F4F1;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4F1;">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
        <tr><td style="background:#0E0E10;padding:28px 32px;">
          <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:800;letter-spacing:0.04em;color:#FFFFFF;">IBMC <span style="color:#FF4D5A;">2027</span></div>
          <div style="margin-top:8px;font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.18em;color:#FF4D5A;">AMPLIFY</div>
        </td></tr>
        <tr><td style="height:4px;background:#D0202E;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="background:#FFFFFF;padding:36px 32px;font-family:Arial,sans-serif;color:#141416;">
          <h1 style="margin:0;font-size:30px;line-height:1.15;font-weight:800;">${headline}</h1>
          <p style="margin:16px 0 0;font-size:16px;line-height:1.55;color:#3A3A40;">${intro}</p>
          ${body}
          ${action}
        </td></tr>
        <tr><td style="padding:20px 8px 0;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#5C5C63;">
          Amplify others. Get amplified.<br>
          ${EVENT}<br>
          Hosted by BNI Philippines
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href, label) {
  return `<p style="margin:28px 0 0;">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#D0202E;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:14px 24px;border-radius:999px;">${escapeHtml(label)}</a>
  </p>`;
}

export function renderInstallmentReminder({ registration, installment, daysBefore, payUrl }) {
  const amount = formatMoney(installment.amount_cents - installment.amount_paid_cents, registration.currency);
  const due = formatLongDate(installment.due_on);
  const when = daysLabel(daysBefore);
  const name = firstName(registration.full_name);
  const headline = daysBefore === 0 ? "Your payment is due today." : `Your payment is ${when}.`;
  const installmentLabel = registration.payment_plan === "installment"
    ? `${installment.sequence} of ${registration.installment_count}`
    : "";
  const subject = installmentLabel
    ? `IBMC 2027 · ${amount} ${when} · ${installmentLabel}`
    : `IBMC 2027 · ${amount} ${when}`;
  const planNote = registration.product_code === "test_200"
    ? "Counted from the day you paid: Day 0 ₱100, Day 2 ₱50, Day 3 ₱50. Paying ₱200 at once covers the seat."
    : "";
  const text = [
    `IBMC 2027`,
    `Hi ${name}, ${amount} for your ${registration.product_name} seat is ${when} (${due}).`,
    `Payment ${installment.sequence} of ${registration.installment_count}.`,
    planNote,
    `Ref ${registration.reference}`,
    payUrl,
  ].filter(Boolean).join("\n");
  const html = shell({
    headline: escapeHtml(headline),
    intro: `Hi ${escapeHtml(name)}, this is a reminder for your IBMC 2027 seat. Your QR ticket is sent only after the seat is fully paid.`,
    body: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background:#F6F4F1;border-radius:16px;">
        <tr><td style="padding:20px 22px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#A8131F;">${escapeHtml(registration.product_name)} · payment ${installment.sequence} of ${registration.installment_count}</div>
          <div style="margin-top:8px;font-size:36px;font-weight:800;line-height:1;">${escapeHtml(amount)}</div>
          <div style="margin-top:8px;font-size:16px;color:#3A3A40;">Due ${escapeHtml(due)}</div>
          ${planNote ? `<div style="margin-top:14px;font-size:14px;line-height:1.5;color:#3A3A40;">${escapeHtml(planNote)}</div>` : ""}
          <div style="margin-top:14px;font-size:14px;color:#5C5C63;">Reference ${escapeHtml(registration.reference)}</div>
        </td></tr>
      </table>`,
    action: button(payUrl, "Pay this installment"),
  });
  return { subject, body: text, html, includesQr: false };
}

export function entryQrPng(passUrl) {
  return QRCode.toBuffer(passUrl, {
    type: "png",
    margin: 1,
    width: 440,
    color: { dark: "#0E0E10", light: "#FFFFFF" },
  });
}

function qrImageUrl(passUrl) {
  const url = new URL(passUrl);
  const token = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  return `${url.origin}/api/passes/${encodeURIComponent(token)}/qr`;
}

export async function renderEntryPass({ registration, passUrl }) {
  if (registration.balance_cents !== 0 || !registration.qr_token) {
    throw new Error("A QR ticket is only created for a fully paid seat");
  }
  const name = firstName(registration.full_name);
  const subject = "IBMC 2027 · Your QR ticket";
  const text = [
    "IBMC 2027",
    `${name}, your seat is fully paid.`,
    `QR ticket: ${passUrl}`,
    EVENT,
    `Ref ${registration.reference}`,
  ].join("\n");
  const html = shell({
    headline: "You're in.",
    intro: `${escapeHtml(name)}, your ${escapeHtml(registration.product_name)} seat is fully paid. This QR ticket is your entry. Bring it on both days.`,
    body: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border:1px solid #E4E1DC;border-radius:16px;">
        <tr><td align="center" style="padding:28px 22px 12px;">
          <div style="font-family:Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:0.04em;color:#141416;">IBMC <span style="color:#D0202E;">2027</span></div>
        </td></tr>
        <tr><td align="center" style="padding:0 22px 12px;">
          <img src="${escapeHtml(qrImageUrl(passUrl))}" width="220" height="220" alt="QR ticket" style="display:block;width:220px;height:220px;border:0;">
        </td></tr>
        <tr><td align="center" style="padding:0 22px 24px;font-size:14px;color:#5C5C63;">
          ${escapeHtml(registration.reference)}<br>${EVENT}
        </td></tr>
      </table>`,
    action: button(passUrl, "Open my QR ticket"),
  });
  return { subject, body: text, html, includesQr: true };
}

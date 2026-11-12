import QRCode from "qrcode";
import { daysLabel, formatDateTimeManila, formatLongDate, formatMoney } from "./time.js";

const EVENT = "June 16–17, 2027 · Newport Performing Arts Theater, Pasay City";
const EVENT_LOGO = "https://ibmcph.com/assets/ibmc-2027-logo.png?v=3";

function brandHeader() {
  return `<tr><td style="background:#0E0E10;padding:22px 32px 18px;">
          <img src="${EVENT_LOGO}" width="320" height="89" alt="IBMC 2027" style="display:block;border:0;width:320px;max-width:100%;height:auto;">
        </td></tr>
        <tr><td style="height:4px;background:#D0202E;font-size:0;line-height:0;">&nbsp;</td></tr>`;
}

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
        ${brandHeader()}
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

const OTP_PREVIEW = "Expires in 10 minutes.";

export function renderOtpEmail({ code, purpose = "registration" }) {
  const lead = purpose === "member"
    ? "Use this OTP (One-time password) to edit your IBMC 2027 details:"
    : "Use this OTP (One-time password) to open your IBMC 2027 registration:";
  const subject = `${code} is your IBMC 2027 code`;
  const text = [
    `${lead} ${code}`,
    "It expires in 10 minutes. Didn't ask for this? You can ignore this email.",
    "Don't share this code. BNI PH staff will never ask for it.",
    "IBMC 2027 · Hosted by BNI Philippines",
    "Need help? Email helpdesk@bni.ph or visit https://helpdesk.bni.ph",
  ].join("\n");
  const safeCode = escapeHtml(code);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${safeCode} is your IBMC 2027 code</title>
</head>
<body style="margin:0;padding:0;background:#F6F4F1;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${OTP_PREVIEW}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F6F4F1;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        ${brandHeader()}
        <tr>
          <td style="background:#FFFFFF;padding:32px 28px 28px;font-family:Arial,Helvetica,sans-serif;color:#141416;">
            <p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#2A2A2E;">${escapeHtml(lead)}</p>
            <p style="margin:0 0 20px;font-size:40px;line-height:1;font-weight:bold;letter-spacing:0.12em;color:#141416;font-family:'Courier New',Courier,monospace;">${safeCode}</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#2A2A2E;">It expires in 10 minutes.</p>
            <p style="margin:0;padding-top:16px;border-top:1px solid #ECE8E2;font-size:13px;line-height:1.6;color:#5C5C63;">Didn't ask for this? You can ignore this email.<br>Don't share this code. BNI PH staff will never ask for it.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5C5C63;">
            IBMC 2027 · Hosted by BNI Philippines<br>
            Need help? Email <a href="mailto:helpdesk@bni.ph" style="color:#A8131F;">helpdesk@bni.ph</a> or visit <a href="https://helpdesk.bni.ph" style="color:#A8131F;">helpdesk.bni.ph</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}

function button(href, label) {
  return `<p style="margin:28px 0 0;">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#D0202E;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:14px 24px;border-radius:999px;">${escapeHtml(label)}</a>
  </p>`;
}

export function templateUses(text, key) {
  return new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`).test(String(text ?? ""));
}

export function renderPlainEmail({ subject, text, payUrl = "", passUrl = "" }) {
  const actions = [
    payUrl ? button(payUrl, "Pay this installment") : "",
    passUrl ? button(passUrl, "Open my QR ticket") : "",
  ].join("");
  return shell({
    headline: escapeHtml(String(subject || "").trim() || "IBMC 2027"),
    intro: escapeHtml(text).replaceAll("\n", "<br>"),
    body: "",
    action: actions,
  });
}

export const TEST_PLAN_NOTE = "Counted from the day you paid: Day 0 ₱100, Day 2 ₱50, Day 3 ₱50. Paying ₱200 at once covers the seat.";
export const SMS_CHARACTERS_PER_CREDIT = 161;

export function smsCreditCount(text) {
  const characters = Array.from(String(text ?? "")).length;
  const credits = characters === 0 ? 0 : Math.ceil(characters / SMS_CHARACTERS_PER_CREDIT);
  return { characters, credits };
}

export const INSTALLMENT_REMINDER_SUBJECT = "IBMC 2027 · {{amount}} {{when}}";
export const INSTALLMENT_REMINDER_BODY = [
  "IBMC 2027",
  "Hi {{first_name}}, {{amount}} for your {{product}} seat is {{when}} ({{due_date}}).",
  "Payment {{installment}}.",
  "{{plan_note}}",
  "Ref {{reference}}",
  "{{pay_url}}",
].join("\n");
export const ENTRY_PASS_SUBJECT = "IBMC 2027 · Your QR ticket";
export const ENTRY_PASS_BODY = [
  "IBMC 2027",
  "{{first_name}}, your seat is fully paid.",
  "QR ticket: {{pass_url}}",
  EVENT,
  "Ref {{reference}}",
].join("\n");

function fillTemplate(text, values) {
  return String(text ?? "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => values[key] ?? "");
}

function plainBody(text) {
  return String(text).split("\n").filter((line) => line.trim()).join("\n");
}

function sameCopy(left, right) {
  return String(left || "").trim() === String(right || "").trim();
}

export function renderInstallmentReminder({ registration, installment, daysBefore, payUrl, template, preview = false }) {
  const amount = formatMoney(installment.amount_cents - installment.amount_paid_cents, registration.currency);
  const due = formatLongDate(installment.due_on);
  const when = daysLabel(daysBefore);
  const name = firstName(registration.full_name);
  const headline = daysBefore === 0 ? "Your payment is due today." : `Your payment is ${when}.`;
  const paymentNumber = `${installment.sequence} of ${registration.installment_count}`;
  const installmentLabel = registration.payment_plan === "installment" ? paymentNumber : "";
  const planNote = registration.product_code === "test_200" ? TEST_PLAN_NOTE : "";
  const placeholderNote = planNote || (preview ? TEST_PLAN_NOTE : "");
  const values = {
    first_name: name,
    amount,
    due_date: due,
    when,
    pay_url: payUrl,
    reference: registration.reference,
    pass_url: "",
    installment: paymentNumber,
    product: registration.product_name,
    plan_note: placeholderNote,
  };
  const fallback = [
    "IBMC 2027",
    `Hi ${name}, ${amount} for your ${registration.product_name} seat is ${when} (${due}).`,
    `Payment ${paymentNumber}.`,
    planNote,
    `Ref ${registration.reference}`,
    payUrl,
  ].filter(Boolean).join("\n");
  let subject = template?.subject ? fillTemplate(template.subject, values) : (installmentLabel ? `IBMC 2027 · ${amount} ${when} · ${installmentLabel}` : `IBMC 2027 · ${amount} ${when}`);
  if (template?.subject && installmentLabel && !subject.includes(installmentLabel)) subject = `${subject} · ${installmentLabel}`;
  const text = template?.body ? plainBody(fillTemplate(template.body, values)) : fallback;
  const intro = template?.body && !sameCopy(template.body, INSTALLMENT_REMINDER_BODY)
    ? escapeHtml(text).replaceAll("\n", "<br>")
    : `Hi ${escapeHtml(name)}, this is a reminder for your IBMC 2027 seat. Your QR ticket is sent only after the seat is fully paid.`;
  const html = shell({
    headline: escapeHtml(headline),
    intro,
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

export function renderPaymentConfirmation({
  registration,
  installment,
  amountCents,
  payUrl,
  manageUrl,
  paymentChannel = "",
  paidAt = "",
  paymentReference = "",
}) {
  const amount = formatMoney(amountCents, registration.currency);
  const paidTotal = registration.installments.reduce((sum, item) => sum + item.amount_paid_cents, 0);
  const seatTotal = registration.installments.reduce((sum, item) => sum + item.amount_cents, 0);
  const paidSoFar = formatMoney(paidTotal, registration.currency);
  const seatTotalLabel = formatMoney(seatTotal, registration.currency);
  const balance = formatMoney(registration.balance_cents, registration.currency);
  const name = firstName(registration.full_name);
  const paidCount = registration.installments.filter((item) => item.status === "paid").length;
  const next = registration.installments.find((item) => item.status === "due");
  const fullyPaid = registration.balance_cents === 0;
  const installmentLine = registration.payment_plan === "installment" && registration.installment_count > 1
    ? `Payment ${installment.sequence} of ${registration.installment_count}`
    : "";
  const subject = fullyPaid
    ? `IBMC 2027 · Payment received · ${amount} · fully paid`
    : installmentLine
      ? `IBMC 2027 · Payment received · ${amount} · ${installment.sequence} of ${registration.installment_count}`
      : `IBMC 2027 · Payment received · ${amount}`;
  const headline = fullyPaid ? "You're all paid up." : "Payment received.";
  const intro = fullyPaid
    ? `Hi ${escapeHtml(name)}, we recorded ${escapeHtml(amount)} for your ${escapeHtml(registration.product_name)} seat. Your QR ticket is on its way by email and SMS.`
    : `Hi ${escapeHtml(name)}, we recorded ${escapeHtml(amount)} for your ${escapeHtml(registration.product_name)} seat.${installmentLine ? ` ${escapeHtml(installmentLine)}.` : ""} Your QR ticket is sent only after the seat is fully paid.`;
  const paidWhen = formatDateTimeManila(paidAt);
  const receiptMeta = [
    paymentChannel ? `Payment channel: ${paymentChannel}` : "",
    paidWhen ? `Date & time: ${paidWhen}` : "",
    `Reference: ${registration.reference}`,
    paymentReference && paymentReference !== registration.reference
      ? `Payment reference: ${paymentReference}`
      : "",
  ].filter(Boolean);
  const receiptMetaHtml = receiptMeta.length
    ? `<div style="margin-top:16px;padding-top:16px;border-top:1px solid #E4E1DC;font-size:14px;line-height:1.7;color:#5C5C63;">
          ${receiptMeta.map((line) => {
            const [label, ...rest] = line.split(": ");
            return `<div><span style="color:#3A3A40;font-weight:700;">${escapeHtml(label)}</span><span style="color:#3A3A40;">: </span>${escapeHtml(rest.join(": "))}</div>`;
          }).join("")}
        </div>`
    : "";
  const nextBlock = !fullyPaid && next
    ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid #E4E1DC;font-size:15px;color:#3A3A40;">
          <span style="color:#5C5C63;">Next payment</span><br>
          <span style="font-size:18px;font-weight:800;">${escapeHtml(formatMoney(next.amount_cents - next.amount_paid_cents, registration.currency))}</span>
          <span style="color:#5C5C63;"> · Due ${escapeHtml(formatLongDate(next.due_on))}</span>
        </div>`
    : "";
  const text = [
    "IBMC 2027",
    fullyPaid
      ? `Hi ${name}, we recorded ${amount} for your ${registration.product_name} seat. Your seat is fully paid.`
      : `Hi ${name}, we recorded ${amount} for your ${registration.product_name} seat.${installmentLine ? ` ${installmentLine}.` : ""}`,
    ...receiptMeta,
    `Paid so far: ${paidSoFar} of ${seatTotalLabel}.`,
    fullyPaid ? "Balance: ₱0." : `Balance: ${balance}.`,
    !fullyPaid && next
      ? `Next payment: ${formatMoney(next.amount_cents - next.amount_paid_cents, registration.currency)} due ${formatLongDate(next.due_on)}.`
      : "",
    fullyPaid
      ? "Your QR ticket is on its way by email and SMS."
      : "Reminders come by email and SMS. Your QR ticket unlocks when you're fully paid.",
    !fullyPaid && next ? payUrl : manageUrl,
  ].filter(Boolean).join("\n");
  const html = shell({
    headline: escapeHtml(headline),
    intro,
    body: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background:#F6F4F1;border-radius:16px;">
        <tr><td style="padding:20px 22px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#A8131F;">${escapeHtml(registration.product_name)}${installmentLine ? ` · ${escapeHtml(installmentLine)}` : ""}</div>
          <div style="margin-top:8px;font-size:36px;font-weight:800;line-height:1;">${escapeHtml(amount)}</div>
          <div style="margin-top:8px;font-size:16px;color:#3A3A40;">Paid so far <strong>${escapeHtml(paidSoFar)}</strong> of ${escapeHtml(seatTotalLabel)}</div>
          <div style="margin-top:6px;font-size:14px;color:#5C5C63;">${paidCount} of ${registration.installment_count} payments made · Balance ${escapeHtml(balance)}</div>
          ${nextBlock}
          ${receiptMetaHtml}
        </td></tr>
      </table>`,
    action: fullyPaid
      ? button(manageUrl, "Manage my registration")
      : button(next ? payUrl : manageUrl, next ? "Pay next installment" : "Manage my registration"),
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

function sampleQrSrc(value) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  let path = "";
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.get(y, x)) path += `M${x} ${y}h1v1H${x}z`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#FFFFFF"/><path fill="#0E0E10" d="${path}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const PREVIEW_PASS_URL = "https://ibmcph.com/pass/preview";
const PREVIEW_PAY_URL = "https://ibmcph.com/pay/IBMC-2048";

function previewRegistration() {
  return {
    full_name: "Maria Santos",
    product_name: "First Mover",
    product_code: "first_mover",
    currency: "PHP",
    reference: "IBMC-2048",
    payment_plan: "installment",
    installment_count: 7,
    balance_cents: 0,
    qr_token: "preview",
  };
}

function fitPreview(html) {
  return String(html)
    .replaceAll('width="560"', 'width="100%"')
    .replace("<body", `<head><meta name="viewport" content="width=device-width,initial-scale=1"><style>img{max-width:100%!important;height:auto!important;}table{max-width:100%!important;}</style></head><body`);
}

export function previewTemplate({ channel, subject, body, systemKey = "" }) {
  const key = String(systemKey || "");
  const template = { subject: channel === "email" ? subject : null, body };
  if (key.startsWith("installment_reminder")) {
    const rendered = renderInstallmentReminder({
      registration: previewRegistration(),
      installment: { amount_cents: 200_000, amount_paid_cents: 0, due_on: "2027-03-15", sequence: 2 },
      daysBefore: 3,
      payUrl: PREVIEW_PAY_URL,
      template,
      preview: true,
    });
    return { ...rendered, html: fitPreview(rendered.html) };
  }
  if (key.startsWith("entry_pass")) {
    const rendered = renderEntryPass({
      registration: previewRegistration(),
      passUrl: PREVIEW_PASS_URL,
      template,
      qrSrc: sampleQrSrc(PREVIEW_PASS_URL),
    });
    return { ...rendered, html: fitPreview(rendered.html) };
  }
  const values = {
    first_name: "Maria",
    amount: "₱2,000",
    due_date: "Mar 15, 2027",
    when: "due in 3 days",
    pay_url: PREVIEW_PAY_URL,
    reference: "IBMC-2048",
    pass_url: PREVIEW_PASS_URL,
    installment: "2 of 7",
    product: "First Mover",
    plan_note: TEST_PLAN_NOTE,
  };
  const text = plainBody(fillTemplate(body, values));
  const filledSubject = fillTemplate(subject, values).trim();
  const html = channel === "email"
    ? fitPreview(renderPlainEmail({
      subject: filledSubject,
      text,
      payUrl: templateUses(body, "pay_url") ? values.pay_url : "",
      passUrl: templateUses(body, "pass_url") ? values.pass_url : "",
    }))
    : fitPreview(`<!DOCTYPE html><html lang="en"><body style="margin:0;background:#FFFFFF;"><div style="padding:28px 24px;font-family:Arial,sans-serif;font-size:16px;line-height:1.55;color:#141416;">${escapeHtml(text).replaceAll("\n", "<br>")}</div></body></html>`);
  return { subject: filledSubject, body: text, html, includesQr: false };
}

export function renderEntryPass({ registration, passUrl, template, qrSrc }) {
  if (registration.balance_cents !== 0 || !registration.qr_token) {
    throw new Error("A QR ticket is only created for a fully paid seat");
  }
  const name = firstName(registration.full_name);
  const values = {
    first_name: name,
    amount: "",
    due_date: "",
    when: "",
    pay_url: "",
    reference: registration.reference,
    pass_url: passUrl,
    installment: "",
    product: registration.product_name,
    plan_note: "",
  };
  const subject = template?.subject ? fillTemplate(template.subject, values) : ENTRY_PASS_SUBJECT;
  let text = template?.body
    ? plainBody(fillTemplate(template.body, values))
    : ["IBMC 2027", `${name}, your seat is fully paid.`, `QR ticket: ${passUrl}`, EVENT, `Ref ${registration.reference}`].join("\n");
  if (passUrl && !text.includes(passUrl)) text = `${text}\n${passUrl}`;
  const intro = template?.body && !sameCopy(template.body, ENTRY_PASS_BODY)
    ? escapeHtml(text).replaceAll("\n", "<br>")
    : `${escapeHtml(name)}, your ${escapeHtml(registration.product_name)} seat is fully paid. This QR ticket is your entry. Bring it on both days.`;
  const html = shell({
    headline: "You're in.",
    intro,
    body: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border:1px solid #E4E1DC;border-radius:16px;">
        <tr><td align="center" style="padding:28px 22px 12px;">
          <div style="font-family:Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:0.04em;color:#141416;">IBMC <span style="color:#D0202E;">2027</span></div>
        </td></tr>
        <tr><td align="center" style="padding:0 22px 12px;">
          <img src="${escapeHtml(qrSrc || qrImageUrl(passUrl))}" width="220" height="220" alt="QR ticket" style="display:block;width:220px;height:220px;border:0;">
        </td></tr>
        <tr><td align="center" style="padding:0 22px 24px;font-size:14px;color:#5C5C63;">
          ${escapeHtml(registration.reference)}<br>${EVENT}
        </td></tr>
      </table>`,
    action: button(passUrl, "Open my QR ticket"),
  });
  return { subject, body: text, html, includesQr: true };
}

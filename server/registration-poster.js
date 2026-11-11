const FONT = "Arial,Helvetica,sans-serif";
const POSTER_TO = "tjtalusan@gmail.com";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function manilaParts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h12",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
}

function clockLabel(date) {
  const parts = manilaParts(date);
  return {
    dateLine: `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.year}`,
    timeLine: `${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`,
    subjectDate: `${parts.month} ${parts.day}, ${parts.year}`,
  };
}

function count(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function share(value, total) {
  if (!total || !value) return 0;
  return Math.max(8, Math.round((value / total) * 100));
}

function bar(value, total, color) {
  const width = share(value, total);
  const fill = width >= 100
    ? `<td height="18" bgcolor="${color}" style="height:18px;background:${color};font-size:0;line-height:18px;">&nbsp;</td>`
    : `<td width="${width}%" height="18" bgcolor="${color}" style="width:${width}%;height:18px;background:${color};font-size:0;line-height:18px;">&nbsp;</td><td bgcolor="#E7E2DA" style="background:#E7E2DA;font-size:0;line-height:18px;">&nbsp;</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#E7E2DA" style="background:#E7E2DA;"><tr>${fill}</tr></table>`;
}

function stat(label, value, total, color) {
  return `<tr><td style="padding:0 0 18px;font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td nowrap style="font-family:${FONT};font-size:13px;line-height:1.2;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64666A;white-space:nowrap;">${esc(label)}</td>
        <td nowrap align="right" style="font-family:${FONT};font-size:36px;line-height:1;font-weight:800;color:#141416;text-align:right;white-space:nowrap;">${count(value)}</td>
      </tr>
    </table>
    <div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>
    ${bar(value, total, color)}
  </td></tr>`;
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

export function renderRegistrationPoster(report) {
  const clock = clockLabel(new Date(report.asOf));
  const total = Number(report.seatsConfirmed) || 0;
  const firstMovers = Number(report.firstMovers) || 0;
  const fullPaid = Number(report.fullyPaid) || 0;
  const installments = (report.tickets || []).reduce((sum, ticket) => sum + (Number(ticket.installment) || 0), 0);
  const chapters = report.chapters || [];
  const chapterTotal = chapters.reduce((sum, chapter) => sum + chapter.count, 0);
  const widest = Math.max(...chapters.map((chapter) => chapter.count), 1);
  const chapterRows = chapters.map((chapter) => `<tr>
    <td nowrap width="132" style="width:132px;padding:8px 10px 8px 0;font-family:${FONT};font-size:15px;line-height:1.2;color:#141416;white-space:nowrap;">${esc(chapter.name)}</td>
    <td style="padding:8px 10px;">${bar(chapter.count, widest, "#141416")}</td>
    <td nowrap width="36" align="right" style="width:36px;padding:8px 0;font-family:${FONT};font-size:16px;line-height:1;font-weight:800;text-align:right;color:#141416;white-space:nowrap;">${count(chapter.count)}</td>
  </tr>`).join("");
  const chapterBlock = chapters.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${chapterRows}
        <tr>
          <td nowrap style="padding:12px 10px 0 0;border-top:2px solid #141416;font-family:${FONT};font-size:15px;font-weight:800;white-space:nowrap;">Total</td>
          <td style="padding:12px 10px 0;border-top:2px solid #141416;"></td>
          <td nowrap align="right" style="padding:12px 0 0;border-top:2px solid #141416;font-family:${FONT};font-size:16px;font-weight:800;text-align:right;white-space:nowrap;">${count(chapterTotal)}</td>
        </tr>
      </table>`
    : `<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.4;color:#64666A;">No chapter is on a confirmed registration yet.</p>`;
  const subject = `IBMC 2027 Registrations · ${clock.subjectDate}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style type="text/css">
  table, td, p, h1, h2, div { overflow: visible !important; max-height: none !important; }
</style>
</head>
<body style="margin:0;padding:0;background:#E7E2DA;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#E7E2DA" style="background:#E7E2DA;">
  <tr><td align="center" style="padding:28px 16px 40px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
      <tr><td bgcolor="#141416" style="background:#141416;padding:36px 32px 28px;font-family:${FONT};">
        <p style="margin:0;font-size:13px;line-height:1.2;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#FFFFFF;">IBMC</p>
        <h1 style="margin:10px 0 0;font-family:${FONT};font-size:40px;line-height:0.95;font-weight:800;letter-spacing:-0.03em;color:#FFFFFF;">Registrations</h1>
        <p style="margin:16px 0 0;font-size:14px;line-height:1.4;color:#C8C4BE;white-space:nowrap;">Extracted ${esc(clock.dateLine)} · ${esc(clock.timeLine)} PHT</p>
      </td></tr>
      <tr><td bgcolor="#D0202E" style="background:#D0202E;height:8px;font-size:0;line-height:8px;">&nbsp;</td></tr>
      <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:32px 32px 8px;font-family:${FONT};">
        <p style="margin:0;font-size:72px;line-height:0.9;font-weight:800;letter-spacing:-0.04em;color:#141416;white-space:nowrap;">${count(total)}</p>
        <p style="margin:8px 0 28px;font-size:13px;line-height:1.2;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#64666A;">Total registrations</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${stat("First Mover", firstMovers, total, "#141416")}
          ${stat("Full paid", fullPaid, total, "#141416")}
          ${stat("Installments", installments, total, "#D0202E")}
        </table>
      </td></tr>
      <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:8px 32px 32px;font-family:${FONT};">
        <p style="margin:0 0 14px;font-size:13px;line-height:1.2;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#64666A;">Chapters</p>
        ${chapterBlock}
      </td></tr>
      <tr><td style="padding:14px 8px 0;font-family:${FONT};font-size:12px;line-height:1.4;color:#64666A;text-align:center;">
        Confirmed seats only · Extracted ${esc(clock.dateLine)} · ${esc(clock.timeLine)} PHT
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const text = [
    "IBMC",
    "Registrations",
    `Extracted ${clock.dateLine} · ${clock.timeLine} PHT`,
    "",
    `Total registrations: ${total}`,
    `First Mover: ${firstMovers}`,
    `Full paid: ${fullPaid}`,
    `Installments: ${installments}`,
    "",
    "Chapters",
    ...(chapters.length ? chapters.map((chapter) => `${chapter.name}: ${chapter.count}`) : ["None"]),
    ...(chapters.length ? [`Total: ${chapterTotal}`] : []),
  ].join("\n");
  return { subject, html, text, total, firstMovers, fullPaid, installments };
}

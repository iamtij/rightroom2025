import { formatMoney } from "./time.js";

const FONT = "Arial,Helvetica,sans-serif";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function manilaParts(date, options) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", ...options })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function clockLabel(date) {
  const parts = manilaParts(date, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  });
  return {
    dateLine: `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.year}`,
    timeLine: `${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`,
  };
}

function shortStamp(date) {
  const parts = manilaParts(date, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  });
  return `${parts.month} ${parts.day}, ${parts.hour}:${parts.minute} ${parts.dayPeriod.toUpperCase()}`;
}

function shortDate(iso, today) {
  const [year, month, day] = iso.split("-").map(Number);
  const options = { month: "short", day: "numeric", timeZone: "UTC" };
  if (!today.startsWith(String(year))) options.year = "numeric";
  return new Intl.DateTimeFormat("en-US", options).format(new Date(Date.UTC(year, month - 1, day)));
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

function peso(cents) {
  return formatMoney(cents || 0, "PHP");
}

function moneyLine(map) {
  const parts = Object.entries(map || {}).filter(([, cents]) => cents > 0).map(([currency, cents]) => formatMoney(cents, currency));
  return parts.join(" · ");
}

export function dailyReportSubject(report) {
  const { dateLine } = clockLabel(report.asOf);
  const dated = dateLine.replace(/^[A-Za-z]+, /, "");
  return `IBMC 2027 Sales Report · ${dated}`;
}

function pill(text, active) {
  const color = active ? "#1E7B4F" : "#64666A";
  const background = active ? "#E6F2EC" : "#F2F2F2";
  return `<span style="display:inline-block;font-size:12px;line-height:1.4;font-weight:700;color:${color};background:${background};padding:2px 8px;">${esc(text)}</span>`;
}

function tile(label, value, subHtml, alert) {
  const background = alert ? "#FBEAEB" : "#FFFFFF";
  const border = alert ? "#CF2030" : "#C8C8C8";
  const accent = alert ? "#CF2030" : "#000000";
  const labelColor = alert ? "#CF2030" : "#64666A";
  const subColor = alert ? "#7A1A22" : "#64666A";
  return `<td width="50%" valign="top" style="width:50%;padding:6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${background}" style="background:${background};border:1px solid ${border};">
      <tr><td style="padding:16px 16px 14px;font-family:${FONT};">
        <p style="margin:0;font-size:11px;line-height:1.3;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${labelColor};">${esc(label)}</p>
        <p style="margin:8px 0 0;font-size:28px;line-height:1.05;font-weight:800;color:${accent};${NOW}">${esc(value)}</p>
        <p style="margin:8px 0 0;font-size:13px;line-height:1.45;color:${subColor};">${subHtml}</p>
      </td></tr>
    </table>
  </td>`;
}

function metric(dash, value) {
  return dash ? "–" : value;
}

function chip(phase, label) {
  if (phase === "open") {
    return `<span style="display:inline-block;font-size:12px;line-height:1.3;font-weight:700;padding:3px 8px;background:#E6F2EC;color:#1E7B4F;white-space:nowrap;">${esc(label)}</span>`;
  }
  if (phase === "ended") {
    return `<span style="display:inline-block;font-size:12px;line-height:1.3;font-weight:700;padding:3px 8px;background:#F2F2F2;color:#64666A;white-space:nowrap;">${esc(label)}</span>`;
  }
  return `<span style="display:inline-block;font-size:12px;line-height:1.3;font-weight:700;padding:3px 8px;border:1px dashed #C8C8C8;color:#64666A;white-space:nowrap;">${esc(label)}</span>`;
}

const TH = `font-family:${FONT};font-size:10px;line-height:1.3;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#64666A;text-align:left;padding:8px 5px;border-bottom:2px solid #000000;`;
const TD = `font-family:${FONT};font-size:13px;line-height:1.35;padding:10px 5px;border-bottom:1px solid #E3E3E3;color:#000000;`;

const NOW = "white-space:nowrap;";

function splitLine(label, value) {
  return `<tr>
    <td nowrap style="${TD}${NOW}">${esc(label)}</td>
    <td nowrap align="right" style="${TD}${NOW}text-align:right;font-weight:700;">${value}</td>
  </tr>`;
}

function ticketBlock(ticket, { money = true } = {}) {
  const dash = ticket.showDash;
  const muted = ticket.phase === "later" && dash;
  const color = muted ? "#64666A" : "#000000";
  if (dash) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid #E3E3E3;">
      <tr>
        <td nowrap style="${TD}${NOW}border-bottom:none;font-weight:700;color:${color};">${esc(ticket.name)}</td>
        <td nowrap align="right" style="${TD}${NOW}border-bottom:none;text-align:right;">${chip(ticket.phase, ticket.phaseLabel)}</td>
      </tr>
      ${money ? `<tr><td nowrap colspan="2" style="${TD}${NOW}padding-top:0;border-bottom:none;color:#64666A;">${esc(ticket.priceLabel)}</td></tr>` : ""}
    </table>`;
  }
  const paid = ticket.planUnknown ? "–" : esc(money ? amountCount(ticket.paidFullCents, ticket.paidFull, ticket.currency) : countCell(ticket.paidFull));
  const plan = ticket.planUnknown ? "–" : esc(money ? amountCount(ticket.installmentCents, ticket.installment, ticket.currency) : countCell(ticket.installment));
  const detail = money
    ? `${esc(ticket.priceLabel)} · ${ticket.seats.toLocaleString("en-US")} seats`
    : `${ticket.seats.toLocaleString("en-US")} seats`;
  const extra = money ? `${splitLine("Collected", esc(formatMoney(ticket.collectedCents, ticket.currency)))}${splitLine("Scheduled", esc(formatMoney(ticket.scheduledCents, ticket.currency)))}` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid #E3E3E3;">
    <tr>
      <td nowrap style="${TD}${NOW}border-bottom:none;font-weight:700;color:${color};">${esc(ticket.name)}</td>
      <td nowrap align="right" style="${TD}${NOW}border-bottom:none;text-align:right;">${chip(ticket.phase, ticket.phaseLabel)}</td>
    </tr>
    <tr><td nowrap colspan="2" style="${TD}${NOW}padding-top:0;color:#64666A;">${detail}</td></tr>
    ${splitLine("Full paid", paid)}
    ${splitLine("Installments", plan)}
    ${extra}
  </table>`;
}

function totalBlock(label, totals, currency) {
  const cell = `${TD}font-weight:700;border-top:2px solid #000000;border-bottom:none;`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
    <tr><td colspan="2" style="${cell}">${esc(label)} · ${totals.seats.toLocaleString("en-US")} seats</td></tr>
    ${splitLine("Full paid", totals.planUnknown ? "–" : esc(amountCount(totals.paidFullCents, totals.paidFull, currency)))}
    ${splitLine("Installments", totals.planUnknown ? "–" : esc(amountCount(totals.installmentCents, totals.installment, currency)))}
    ${splitLine("Collected", esc(formatMoney(totals.collectedCents, currency)))}
    ${splitLine("Scheduled", esc(formatMoney(totals.scheduledCents, currency)))}
  </table>`;
}

function bar(bands) {
  const active = bands.filter((band) => band.count > 0);
  if (!active.length) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#F2F2F2;"><tr><td height="22" style="height:22px;font-size:0;line-height:22px;">&nbsp;</td></tr></table>`;
  }
  const cells = active.map((band) => (
    `<td width="${band.width}%" height="22" bgcolor="${band.color}" style="width:${band.width}%;height:22px;background:${band.color};font-size:0;line-height:22px;">&nbsp;</td>`
  )).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#F2F2F2;"><tr>${cells}</tr></table>`;
}

function healthTable(report) {
  const rows = report.health.bands.filter((band) => band.count != null).map((band) => {
    const background = band.key === "day15" ? "#EFEFEF" : band.late ? "#FBEAEB" : "#FFFFFF";
    const amount = band.late ? (moneyLine(band.overdue) || "–") : "–";
    const amountStyle = band.late && amount !== "–" ? "color:#CF2030;font-weight:700;" : "";
    return `<tr>
      <td style="${TD}background:${background};"><span style="display:inline-block;width:12px;height:12px;background:${band.color};margin-right:8px;">&nbsp;</span>${esc(band.label)}</td>
      <td align="right" style="${TD}background:${background};text-align:right;">${band.count == null ? "–" : band.count.toLocaleString("en-US")}</td>
      <td align="right" style="${TD}background:${background};text-align:right;${amountStyle}">${esc(amount)}</td>
    </tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;">
    <thead><tr>
      <th align="left" style="${TH}">Status</th>
      <th align="right" style="${TH}text-align:right;">Plans</th>
      <th align="right" style="${TH}text-align:right;">Overdue</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function atRisk(report, { money = true } = {}) {
  const people = report.health.atRisk;
  if (!people.length) {
    return `<p style="margin:16px 0 0;font-size:14px;line-height:1.45;color:#64666A;">No one reaches the Regular price within the next 3 days.</p>`;
  }
  const owes = money ? moneyLine(report.health.atRiskTotals) : "";
  const summary = `${countLabel(people.length, "person", "people")}${owes ? ` · ${owes}` : ""}`;
  const rows = report.health.atRiskShown.map((person) => `<tr>
    <td nowrap style="${TD}${NOW}background:#FFFFFF;">${esc(person.name)}</td>
    <td nowrap style="${TD}${NOW}background:#FFFFFF;">${esc(person.chapter || "—")}</td>
    ${money ? `<td nowrap align="right" style="${TD}${NOW}background:#FFFFFF;text-align:right;">${formatMoney(person.cents, person.currency)}</td>` : ""}
    <td nowrap align="right" style="${TD}${NOW}background:#FFFFFF;text-align:right;font-weight:700;color:#8F1420;">${person.daysLate} days</td>
    <td nowrap align="right" style="${TD}${NOW}background:#FFFFFF;text-align:right;">${esc(shortDate(person.movesOn, report.today))}</td>
  </tr>`).join("");
  const more = report.health.atRiskHidden > 0
    ? `<p style="margin:8px 0 0;font-size:13px;color:#64666A;">And ${countLabel(report.health.atRiskHidden, "more registration", "more registrations")}.</p>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border:2px solid #CF2030;">
    <tr><td bgcolor="#CF2030" style="background:#CF2030;padding:12px 16px;font-family:${FONT};">
      <p style="margin:0;font-size:15px;line-height:1.3;font-weight:800;color:#FFFFFF;">Reaches the Regular price within 3 days</p>
      <p style="margin:4px 0 0;font-size:13px;line-height:1.4;color:#FFFFFF;">${esc(summary)}</p>
    </td></tr>
    <tr><td style="padding:0 12px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <thead><tr>
          <th align="left" style="${TH}">Name</th>
          <th align="left" style="${TH}">Chapter</th>
          ${money ? `<th nowrap align="right" style="${TH}${NOW}text-align:right;">Owes</th>` : ""}
          <th nowrap align="right" style="${TH}${NOW}text-align:right;">Late</th>
          <th align="right" style="${TH}text-align:right;">Moves on</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${more}
    </td></tr>
  </table>`;
}

function methodsBlock(report) {
  if (!report.methods.length) {
    return `<p style="margin:14px 0 0;font-size:14px;line-height:1.45;color:#64666A;">No peso payments yet.</p>`;
  }
  const rows = report.methods.map((method) => {
    const fill = method.percent >= 100
      ? `<td height="14" bgcolor="#000000" style="height:14px;background:#000000;font-size:0;line-height:14px;">&nbsp;</td>`
      : `<td width="${method.percent}%" height="14" bgcolor="#000000" style="width:${method.percent}%;height:14px;background:#000000;font-size:0;line-height:14px;">&nbsp;</td><td bgcolor="#F2F2F2" style="background:#F2F2F2;font-size:0;line-height:14px;">&nbsp;</td>`;
    return `<tr>
      <td width="118" valign="middle" style="width:118px;padding:7px 8px 7px 0;font-family:${FONT};font-size:14px;color:#000000;">${esc(method.label)}</td>
      <td valign="middle" style="padding:7px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F2F2F2" style="background:#F2F2F2;"><tr>${fill}</tr></table>
      </td>
      <td width="132" valign="middle" align="right" style="width:132px;padding:7px 0 7px 8px;font-family:${FONT};font-size:14px;line-height:1.3;text-align:right;color:#000000;">${peso(method.cents)}<br><span style="font-size:12px;color:#64666A;">${method.percent}%${method.count == null ? "" : ` · ${countLabel(method.count, "payment")}`}</span></td>
    </tr>`;
  }).join("");
  const usd = report.usdPayments.count
    ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.45;color:#64666A;">US dollars collected: ${formatMoney(report.usdPayments.cents, "USD")} · ${countLabel(report.usdPayments.count, "payment")}.</p>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${rows}</table>${usd}`;
}

function chapterSection(chapters) {
  if (!chapters?.length) return "";
  const total = chapters.reduce((sum, chapter) => sum + chapter.count, 0);
  const cell = `${TD}font-weight:700;border-top:2px solid #000000;border-bottom:none;`;
  const rows = chapters.map((chapter) => `<tr>
    <td style="${TD}">${esc(chapter.name)}</td>
    <td align="right" style="${TD}text-align:right;">${chapter.count.toLocaleString("en-US")}</td>
  </tr>`).join("");
  return `<tr><td style="padding-bottom:16px;">
    ${card("By chapter", "", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;">
      <thead><tr>
        <th align="left" style="${TH}">Chapter</th>
        <th align="right" style="${TH}text-align:right;">Seats</th>
      </tr></thead>
      <tbody>${rows}
        <tr>
          <td style="${cell}">Total</td>
          <td align="right" style="${cell}text-align:right;">${total.toLocaleString("en-US")}</td>
        </tr>
      </tbody>
    </table>`)}
  </td></tr>`;
}

function card(title, hint, body) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #C8C8C8;">
    <tr><td style="padding:22px;font-family:${FONT};color:#000000;">
      <h2 style="margin:0;font-family:${FONT};font-size:20px;line-height:1.2;font-weight:800;color:#000000;">${esc(title)}</h2>
      ${hint ? `<p style="margin:4px 0 0;font-size:13px;line-height:1.45;color:#64666A;">${esc(hint)}</p>` : ""}
      ${body}
    </td></tr>
  </table>`;
}

function collectedSub(report) {
  const added = report.activity.collected.PHP || 0;
  const stock = report.collected.USD || 0;
  const extra = stock ? ` plus ${formatMoney(stock, "USD")}` : "";
  return `${pill(`+${peso(added)} today`, added > 0)}${extra ? ` ${esc(extra.trim())}` : ""}`;
}

function overdueSub(report) {
  const behind = report.overdueRegistrations === 0
    ? "No one is behind"
    : `${countLabel(report.overdueRegistrations, "registration")} behind`;
  const late = report.late15 === 1
    ? "1 moved to the Regular price"
    : report.late15 > 1
      ? `${report.late15.toLocaleString("en-US")} moved to the Regular price`
      : "";
  const usd = report.overdue.USD ? `plus ${formatMoney(report.overdue.USD, "USD")}` : "";
  return esc([behind, late, usd].filter(Boolean).join(" · "));
}

function paymentStripLabel(report) {
  const parts = ["Payments"];
  parts.push(peso(report.activity.collected.PHP || 0));
  if (report.activity.collected.USD) parts.push(formatMoney(report.activity.collected.USD, "USD"));
  return parts.join(" · ");
}

function countCell(value) {
  return value == null ? "–" : Number(value).toLocaleString("en-US");
}

function amountCount(cents, count, currency) {
  return `${formatMoney(cents || 0, currency)} · ${Number(count || 0).toLocaleString("en-US")}`;
}

function renderCountReport(report) {
  const clock = clockLabel(report.asOf);
  const covers = report.coversLabel || `${shortStamp(report.windowStart)} to ${shortStamp(report.asOf)}`;
  const subject = `IBMC 2027 Report · ${clock.dateLine.replace(/^[A-Za-z]+, /, "")}`;
  const preview = `${report.seatsConfirmed.toLocaleString("en-US")} seats confirmed · ${report.cancelledToDate.toLocaleString("en-US")} cancelled · ${report.roster.total.toLocaleString("en-US")} on the roster`;
  const ticketRows = report.tickets.map((ticket) => ticketBlock(ticket, { money: false })).join("");
  const healthRows = report.health.bands.filter((band) => band.count != null).map((band) => {
    const background = band.key === "day15" ? "#EFEFEF" : band.late ? "#FBEAEB" : "#FFFFFF";
    return `<tr>
      <td style="${TD}background:${background};"><span style="display:inline-block;width:12px;height:12px;background:${band.color};margin-right:8px;">&nbsp;</span>${esc(band.label)}</td>
      <td align="right" style="${TD}background:${background};text-align:right;">${band.count == null ? "–" : band.count.toLocaleString("en-US")}</td>
    </tr>`;
  }).join("");
  const visibleNotes = report.notes.filter((note) => !/[₱]|USD /.test(note));
  const notes = visibleNotes.map((note) => `<li style="margin:0 0 6px;font-size:14px;line-height:1.45;">${esc(note)}</li>`).join("");
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
<body style="margin:0;padding:0;background:#F2F2F2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F2F2F2" style="background:#F2F2F2;">
  <tr><td align="center" style="padding:24px 12px 32px;">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;">
      <tr><td style="padding-bottom:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="background:#000000;">
          <tr><td style="padding:24px 28px 22px;font-family:${FONT};color:#FFFFFF;">
            <p style="margin:0;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#C8C8C8;">BNI Philippines · Report</p>
            <h1 style="margin:8px 0 0;font-family:${FONT};font-size:28px;line-height:1.15;font-weight:800;color:#FFFFFF;">IBMC 2027 Report</h1>
            <p style="margin:8px 0 0;font-size:15px;line-height:1.4;font-weight:700;color:#FFFFFF;">As of ${esc(clock.dateLine)} · ${esc(clock.timeLine)} (PHT)</p>
            <p style="margin:4px 0 0;font-size:13px;line-height:1.4;color:#C8C8C8;">Covers ${esc(covers)}</p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${tile("Seats confirmed", report.seatsConfirmed.toLocaleString("en-US"), pill(`+${report.activity.registrations.toLocaleString("en-US")} today`, report.activity.registrations > 0), false)}
            ${tile("First movers", report.firstMovers.toLocaleString("en-US"), esc("Confirmed seats"), false)}
          </tr>
          <tr>
            ${tile("Fully paid", (report.fullyPaid ?? 0).toLocaleString("en-US"), esc("Confirmed seats, all tickets"), false)}
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        ${card("Last 24 hours", "", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border:1px solid #C8C8C8;"><tr>
          <td width="50%" valign="top" style="width:50%;padding:14px 10px;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;">${report.activity.registrations.toLocaleString("en-US")}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;">New registrations</p></td>
          <td width="50%" valign="top" style="width:50%;padding:14px 10px;border-left:1px solid #C8C8C8;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;color:${report.activity.reached15 > 0 ? "#CF2030" : "#000000"};">${report.activity.reached15.toLocaleString("en-US")}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;">Moved to Regular</p></td>
        </tr></table>`)}
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        ${card("By ticket", "Installment seats are not fully paid yet.", ticketRows)}
      </td></tr>
      ${chapterSection(report.chapters)}
      <tr><td style="padding-bottom:16px;">
        ${card("Installment health", report.healthHint, `${bar(report.health.bands)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-collapse:collapse;">
          <thead><tr>
            <th align="left" style="${TH}">Status</th>
            <th align="right" style="${TH}text-align:right;">Plans</th>
          </tr></thead>
          <tbody>${healthRows}</tbody>
        </table>${atRisk(report, { money: false })}`)}
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        ${card("Roster", "Members on the chapter roster.", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border:1px solid #C8C8C8;"><tr>
          <td width="50%" valign="top" style="width:50%;padding:14px 10px;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;">${report.roster.total.toLocaleString("en-US")}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;">On the roster · ${esc(report.roster.updated)} updated</p></td>
          <td width="50%" valign="top" style="width:50%;padding:14px 10px;border-left:1px solid #C8C8C8;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;">${report.roster.firstMovers.toLocaleString("en-US")}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;">First movers on the roster</p></td>
        </tr></table>`)}
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        ${card("Notes", "", `<ul style="margin:12px 0 0;padding-left:18px;">${notes}</ul>`)}
      </td></tr>
      <tr><td style="padding:4px 8px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#64666A;text-align:center;">
        Sample for review · Figures as of the time above
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const text = [
    "IBMC 2027 Report",
    `As of ${clock.dateLine} · ${clock.timeLine} (PHT)`,
    `Covers ${covers}`,
    "",
    `Seats confirmed: ${report.seatsConfirmed} (+${report.activity.registrations} today)`,
    `Fully paid: ${report.fullyPaid ?? 0}`,
    `Roster: ${report.roster.total} on the roster, ${report.roster.updated} updated, ${report.roster.delayed} delayed`,
    `First movers on the roster: ${report.roster.firstMovers}`,
    "",
    "Last 24 hours",
    `New registrations: ${report.activity.registrations}`,
    `Moved to Regular: ${report.activity.reached15}`,
    "",
    "By ticket",
    ...report.tickets.map((ticket) => `${ticket.name} · ${ticket.phaseLabel} · ${ticket.showDash ? "no seats yet" : `${ticket.seats} seats · full paid ${ticket.paidFull || 0} · installments ${ticket.installment || 0}`}`),
    "",
    "By chapter",
    ...(report.chapters?.length ? report.chapters.map((chapter) => `${chapter.name}: ${chapter.count}`) : ["None"]),
    ...(report.chapters?.length ? [`Total: ${report.chapters.reduce((sum, chapter) => sum + chapter.count, 0)}`] : []),
    "",
    report.healthHint,
    ...report.health.bands.filter((band) => band.count != null).map((band) => `${band.label}: ${band.count}`),
    "",
    "Notes",
    ...visibleNotes.map((note) => `- ${note}`),
  ].join("\n");
  return { subject, html, text };
}

export function renderDailyReport(report) {
  if (report.omitSales) return renderCountReport(report);
  const subject = dailyReportSubject(report);
  const clock = clockLabel(report.asOf);
  const covers = report.coversLabel || `${shortStamp(report.windowStart)} to ${shortStamp(report.asOf)}`;
  const preview = report.screen
    ? `${report.screen.signups.toLocaleString("en-US")} signups · ${peso(report.screen.collectedCents)} collected · ${peso(report.screen.stillDueCents)} still due`
    : `${report.seatsConfirmed.toLocaleString("en-US")} seats confirmed · ${peso(report.collected.PHP)} collected · ${peso(report.overdue.PHP)} overdue`;
  const scheduledUsd = report.scheduled?.USD ? ` · plus ${formatMoney(report.scheduled.USD, "USD")}` : "";
  const phpTickets = report.screen ? [] : report.tickets.filter((ticket) => ticket.currency === "PHP");
  const usdTickets = report.screen ? [] : report.tickets.filter((ticket) => ticket.currency === "USD");
  const otherTickets = report.screen ? [] : report.tickets.filter((ticket) => ticket.currency !== "PHP" && ticket.currency !== "USD");

  const ticketTable = report.screen ? "" : [
    ...phpTickets.map((ticket) => ticketBlock(ticket)),
    totalBlock("Total (PHP)", report.totals.PHP, "PHP"),
    ...usdTickets.map((ticket) => ticketBlock(ticket)),
    ...(usdTickets.length ? [totalBlock("Total (USD)", report.totals.USD, "USD")] : []),
    ...otherTickets.map((ticket) => ticketBlock(ticket)),
  ].join("");

  const notes = report.notes.map((note) => `<li style="margin:0 0 6px;font-size:14px;line-height:1.45;">${esc(note)}</li>`).join("");
  const healthHint = report.healthHint || (report.screen ? "" : `${countLabel(report.health.total, "open installment plan")}. 1–3 days late is a nudge, 4–7 a call, 8–15 an escalation. After more than 15 days, the balance automatically becomes the Regular price.`);

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
<body style="margin:0;padding:0;background:#F2F2F2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F2F2F2" style="background:#F2F2F2;">
  <tr><td align="center" style="padding:24px 12px 32px;">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;">
      <tr><td style="padding-bottom:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#000000" style="background:#000000;">
          <tr><td style="padding:24px 28px 18px;font-family:${FONT};color:#FFFFFF;">
            <p style="margin:0;font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#C8C8C8;">BNI Philippines · Sales Report</p>
            <h1 style="margin:8px 0 0;font-family:${FONT};font-size:28px;line-height:1.15;font-weight:800;color:#FFFFFF;">IBMC 2027 Sales Report</h1>
            <p style="margin:8px 0 0;font-size:15px;line-height:1.4;font-weight:700;color:#FFFFFF;">As of ${esc(clock.dateLine)} · ${esc(clock.timeLine)} (PHT)</p>
            <p style="margin:4px 0 0;font-size:13px;line-height:1.4;color:#C8C8C8;">Covers ${esc(covers)}</p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${report.screen ? `<tr>
            ${tile("Total signups", report.screen.signups.toLocaleString("en-US"), esc(`${report.screen.confirmed.toLocaleString("en-US")} confirmed · ${report.screen.cancelled.toLocaleString("en-US")} cancelled`), false)}
            ${tile("First movers", report.screen.firstMovers.toLocaleString("en-US"), esc(report.screen.firstMoverNote), false)}
          </tr>
          <tr>
            ${tile("Collected", peso(report.screen.collectedCents), esc("Confirmed registrations, pesos"), false)}
            ${tile("Still due", peso(report.screen.stillDueCents), esc(report.screen.stillDueNote), true)}
          </tr>` : `<tr>
            ${tile("Seats confirmed", report.seatsConfirmed.toLocaleString("en-US"), pill(`+${report.activity.registrations.toLocaleString("en-US")} today`, report.activity.registrations > 0), false)}
            ${tile("Fully paid", (report.fullyPaid ?? 0).toLocaleString("en-US"), esc("Confirmed seats, all tickets"), false)}
          </tr>
          <tr>
            ${tile("Collected", peso(report.collected.PHP), collectedSub(report), false)}
            ${tile("Scheduled", peso(report.scheduled.PHP), esc(report.scheduledNote || `Future installments, not late${scheduledUsd}`), false)}
          </tr>
          <tr>
            ${tile("Overdue", peso(report.overdue.PHP), overdueSub(report), report.overdueAlert)}
          </tr>`}
        </table>
      </td></tr>
      ${report.screen ? `<tr><td style="padding-bottom:16px;">
        ${card("Roster", "Same counts as the dashboard.", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border:1px solid #C8C8C8;"><tr>
          <td width="25%" valign="top" style="width:25%;padding:14px 10px;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;">${report.screen.rosterTotal.toLocaleString("en-US")}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;">On the roster</p></td>
          <td width="25%" valign="top" style="width:25%;padding:14px 10px;border-left:1px solid #C8C8C8;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;">${esc(report.screen.updated)}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;">Updated</p></td>
          <td width="25%" valign="top" style="width:25%;padding:14px 10px;border-left:1px solid #C8C8C8;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;">${esc(report.screen.delayed)}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;">Delayed</p></td>
          <td width="25%" valign="top" style="width:25%;padding:14px 10px;border-left:1px solid #C8C8C8;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;">${report.screen.rosterFirstMovers.toLocaleString("en-US")}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;">First movers on the roster</p></td>
        </tr></table>`)}
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        ${card("By ticket", "Every confirmed signup is a First Mover.", `<p style="margin:14px 0 0;font-size:15px;line-height:1.45;">First Mover is open through Nov 30. <b>${report.screen.confirmed.toLocaleString("en-US")} confirmed</b>, ${report.screen.cancelled.toLocaleString("en-US")} cancelled. Collected ${peso(report.screen.collectedCents)}. Still due ${peso(report.screen.stillDueCents)}.</p>`)}
      </td></tr>` : `<tr><td style="padding-bottom:16px;">
        ${card("Last 24 hours", "", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border:1px solid #C8C8C8;"><tr>
          <td width="50%" valign="top" style="width:50%;padding:14px 12px;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;${NOW}">${report.activity.registrations.toLocaleString("en-US")}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;${NOW}">New registrations</p></td>
          <td width="50%" valign="top" style="width:50%;padding:14px 12px;border-left:1px solid #C8C8C8;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;${NOW}">${report.activity.paymentCount == null ? "–" : report.activity.paymentCount.toLocaleString("en-US")}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;${NOW}">${esc(paymentStripLabel(report))}</p></td>
        </tr><tr>
          <td width="50%" valign="top" style="width:50%;padding:14px 12px;border-top:1px solid #C8C8C8;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;${NOW}">${report.activity.cancellations.toLocaleString("en-US")}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;${NOW}">Cancellations</p></td>
          <td width="50%" valign="top" style="width:50%;padding:14px 12px;border-top:1px solid #C8C8C8;border-left:1px solid #C8C8C8;font-family:${FONT};"><p style="margin:0;font-size:22px;line-height:1.1;font-weight:800;color:${report.activity.reached15 > 0 ? "#CF2030" : "#000000"};${NOW}">${report.activity.reached15.toLocaleString("en-US")}</p><p style="margin:4px 0 0;font-size:13px;line-height:1.35;color:#64666A;${NOW}">Moved to Regular price</p></td>
        </tr></table>`)}
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        ${card("By ticket", "Full paid and installments show the amount collected, then the number of seats. Installment seats are not fully paid yet.", ticketTable)}
      </td></tr>
      ${chapterSection(report.chapters)}
      <tr><td style="padding-bottom:16px;">
        ${card("Installment health", healthHint, `${bar(report.health.bands)}${healthTable(report)}${atRisk(report)}`)}
      </td></tr>
      <tr><td style="padding-bottom:16px;">
        ${card("Payment methods", "All payments to date, pesos.", methodsBlock(report))}
      </td></tr>`}
      <tr><td style="padding-bottom:16px;">
        ${card("Notes", "", `<ul style="margin:12px 0 0;padding-left:18px;">${notes}</ul>`)}
      </td></tr>
      <tr><td style="padding:4px 8px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#64666A;text-align:center;">
        Sent daily at 9:00 AM PHT to IBMC stakeholders from tickets@ibmcph.com · Figures as of the time above
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = renderText(report, clock, covers);
  return { subject, html, text };
}

function renderText(report, clock, covers) {
  if (report.screen) {
    const screen = report.screen;
    return [
      "IBMC 2027 Sales Report",
      `As of ${clock.dateLine} · ${clock.timeLine} (PHT)`,
      covers,
      "",
      `Total signups: ${screen.signups} (${screen.confirmed} confirmed, ${screen.cancelled} cancelled)`,
      `First movers: ${screen.firstMovers} (${screen.firstMoverNote})`,
      `Collected: ${peso(screen.collectedCents)}`,
      `Still due: ${peso(screen.stillDueCents)} (${screen.stillDueNote})`,
      "",
      `Roster: ${screen.rosterTotal} on the roster, ${screen.updated} updated, ${screen.delayed} delayed`,
      `First movers on the roster: ${screen.rosterFirstMovers}`,
      "",
      `First Mover: ${screen.confirmed} confirmed, ${screen.cancelled} cancelled, collected ${peso(screen.collectedCents)}, still due ${peso(screen.stillDueCents)}`,
      "",
      "Notes",
      ...report.notes.map((note) => `- ${note}`),
      "",
      "Sent daily at 9:00 AM PHT to IBMC stakeholders from tickets@ibmcph.com.",
    ].join("\n");
  }
  const lines = [
    "IBMC 2027 Sales Report",
    `As of ${clock.dateLine} · ${clock.timeLine} (PHT)`,
    `Covers ${covers}`,
    "",
    `Seats confirmed: ${report.seatsConfirmed.toLocaleString("en-US")} (+${report.activity.registrations.toLocaleString("en-US")} today)`,
    `Fully paid: ${(report.fullyPaid ?? 0).toLocaleString("en-US")}`,
    `Collected: ${peso(report.collected.PHP)} (+${peso(report.activity.collected.PHP || 0)} today)${report.collected.USD ? `, plus ${formatMoney(report.collected.USD, "USD")}` : ""}`,
    `Scheduled: ${peso(report.scheduled.PHP)}`,
    `Overdue: ${peso(report.overdue.PHP)} · ${overdueSub(report)}`,
    "",
    "Last 24 hours",
    `New registrations: ${report.activity.registrations}`,
    `${paymentStripLabel(report)}${report.activity.paymentCount == null ? "" : ` (${report.activity.paymentCount})`}`,
    `Cancellations: ${report.activity.cancellations}`,
    `Moved to Regular price: ${report.activity.reached15}`,
    "",
    "By ticket",
  ];
  for (const ticket of report.tickets) {
    if (ticket.showDash) {
      lines.push(`${ticket.name} · ${ticket.phaseLabel} · ${ticket.priceLabel} · no seats yet`);
      continue;
    }
    lines.push(`${ticket.name} · ${ticket.phaseLabel} · ${ticket.priceLabel} · ${ticket.seats} seats · full paid ${amountCount(ticket.paidFullCents, ticket.paidFull, ticket.currency)} · installments ${amountCount(ticket.installmentCents, ticket.installment, ticket.currency)} · collected ${formatMoney(ticket.collectedCents, ticket.currency)} · scheduled ${formatMoney(ticket.scheduledCents, ticket.currency)}`);
  }
  lines.push(`Total (PHP): ${report.totals.PHP.seats} seats · collected ${peso(report.totals.PHP.collectedCents)} · scheduled ${peso(report.totals.PHP.scheduledCents)}`);
  lines.push("", "By chapter");
  if (report.chapters?.length) {
    for (const chapter of report.chapters) lines.push(`${chapter.name}: ${chapter.count}`);
    lines.push(`Total: ${report.chapters.reduce((sum, chapter) => sum + chapter.count, 0)}`);
  } else lines.push("None");
  if (report.totals.USD) {
    lines.push(`Total (USD): ${report.totals.USD.seats} seats · collected ${formatMoney(report.totals.USD.collectedCents, "USD")} · scheduled ${formatMoney(report.totals.USD.scheduledCents, "USD")}`);
  }
  lines.push("", report.healthHint || `Installment health (${report.health.total} open plans)`);
  for (const band of report.health.bands) {
    const overdue = band.late ? moneyLine(band.overdue) || "–" : "–";
    const plans = band.count == null ? "–" : band.count;
    lines.push(`${band.label}: ${plans} plans, overdue ${overdue}`);
  }
  if (!report.health.atRisk.length) lines.push("At risk: no one reaches the Regular price within the next 3 days.");
  else {
    lines.push(`At risk: ${countLabel(report.health.atRisk.length, "person", "people")}`);
    for (const person of report.health.atRiskShown) {
      lines.push(`- ${person.name}, ${person.chapter || "—"}, ${formatMoney(person.cents, person.currency)}, ${person.daysLate} days late, moves on ${shortDate(person.movesOn, report.today)}`);
    }
    if (report.health.atRiskHidden) lines.push(`And ${report.health.atRiskHidden} more.`);
  }
  lines.push("", "Payment methods");
  if (!report.methods.length) lines.push("No peso payments yet.");
  for (const method of report.methods) {
    const count = method.count == null ? "" : `, ${countLabel(method.count, "payment")}`;
    lines.push(`${method.label}: ${peso(method.cents)} (${method.percent}%${count})`);
  }
  if (report.usdPayments.count) lines.push(`US dollars collected: ${formatMoney(report.usdPayments.cents, "USD")} · ${countLabel(report.usdPayments.count, "payment")}`);
  lines.push("", "Notes");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("", "Sent daily at 9:00 AM PHT to IBMC stakeholders from tickets@ibmcph.com.");
  return lines.join("\n");
}

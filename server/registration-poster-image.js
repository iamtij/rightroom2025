import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import path from "path";
import { fileURLToPath } from "url";

const fontFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts", "Archivo.ttf");
GlobalFonts.registerFromPath(fontFile, "Archivo");

const WIDTH = 800;
const SCALE = 2;

function font(weight, size) {
  return `${weight} ${size}px Archivo`;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, height / 2, Math.max(width, 0) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRound(ctx, x, y, width, height, radius, color) {
  if (width <= 0) return;
  roundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function textWidth(ctx, value, weight, size) {
  ctx.font = font(weight, size);
  return ctx.measureText(String(value)).width;
}

export function renderPosterJpeg(poster) {
  const chapters = poster.chapters || [];
  const header = 196;
  const footer = 78;
  const y0 = header + 8 + 36;
  const labelY0 = y0 + 118;
  const barY0 = labelY0 + 28;
  const legendY0 = barY0 + 48;
  const cardY0 = legendY0 + 28;
  const chapterY0 = cardY0 + 132;
  const chapterH = 64 + chapters.length * 46;
  const footY0 = chapterY0 + chapterH + 28;
  const height = footY0 + footer;
  const canvas = createCanvas(WIDTH * SCALE, height * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  ctx.fillStyle = "#F3F4F6";
  ctx.fillRect(0, 0, WIDTH, height);

  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, WIDTH, header);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = font(700, 18);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
  ctx.fillText("IBMC 2027", 40, 58);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.font = font(800, 48);
  ctx.fillText("Registration update", 40, 118);
  ctx.fillStyle = "#D6D6D6";
  ctx.font = font(400, 22);
  ctx.fillText(`As of ${poster.asOfLabel}`, 40, 162);

  ctx.fillStyle = "#D0121B";
  ctx.fillRect(0, header, WIDTH, 8);

  const paid = poster.paid || 0;
  const fullPaid = poster.fullPaid || 0;
  const installments = poster.installments || 0;
  let y = header + 8 + 36;
  ctx.fillStyle = "#111111";
  ctx.font = font(800, 92);
  ctx.fillText(paid.toLocaleString("en-US"), 40, y + 78);

  const labelY = y + 118;
  ctx.fillStyle = "#8D8D8D";
  ctx.font = font(700, 16);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";
  ctx.fillText("PAID REGISTRATIONS", 40, labelY);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  const change = `+${poster.sinceYesterday.toLocaleString("en-US")} since yesterday`;
  ctx.font = font(700, 16);
  const changeWidth = ctx.measureText(change).width;
  fillRound(ctx, WIDTH - 40 - changeWidth - 28, labelY - 24, changeWidth + 28, 34, 17, "#E5F6EC");
  ctx.fillStyle = "#1B8A4C";
  ctx.fillText(change, WIDTH - 40 - changeWidth - 14, labelY);

  const barY = labelY + 28;
  const barX = 40;
  const barW = WIDTH - 80;
  const barH = 22;
  fillRound(ctx, barX, barY, barW, barH, 11, "#6A6A6A");
  const fullWidth = paid > 0 ? Math.round((fullPaid / paid) * barW) : 0;
  if (fullWidth > 0) fillRound(ctx, barX, barY, Math.max(fullWidth, barH), barH, 11, "#111111");

  const legendY = barY + 48;
  ctx.fillStyle = "#111111";
  ctx.fillRect(40, legendY - 12, 12, 12);
  ctx.font = font(500, 18);
  ctx.fillStyle = "#3A3A3A";
  const fullLegend = `${fullPaid.toLocaleString("en-US")} paid in full`;
  ctx.fillText(fullLegend, 60, legendY);
  const legendGap = 60 + textWidth(ctx, fullLegend, 500, 18) + 28;
  ctx.fillStyle = "#6A6A6A";
  ctx.fillRect(legendGap, legendY - 12, 12, 12);
  ctx.fillStyle = "#3A3A3A";
  ctx.fillText(`${installments.toLocaleString("en-US")} installment`, legendGap + 20, legendY);

  const cardY = legendY + 28;
  fillRound(ctx, 28, cardY, WIDTH - 56, 112, 18, "#D0121B");
  ctx.fillStyle = "#FFFFFF";
  ctx.font = font(800, 26);
  ctx.fillText(poster.bannerTitle, 52, cardY + 48);
  ctx.font = font(400, 18);
  ctx.fillText(poster.bannerNote, 52, cardY + 80);
  const days = String(poster.daysLeft);
  ctx.font = font(800, 42);
  const daysWidth = ctx.measureText(days).width;
  ctx.fillText(days, WIDTH - 52 - daysWidth, cardY + 52);
  ctx.font = font(500, 16);
  const daysLabel = poster.daysLeft === 1 ? "day left" : "days left";
  const daysLabelWidth = ctx.measureText(daysLabel).width;
  ctx.fillText(daysLabel, WIDTH - 52 - daysLabelWidth, cardY + 78);

  const chapterY = cardY + 132;
  fillRound(ctx, 28, chapterY, WIDTH - 56, chapterH, 18, "#FFFFFF");
  ctx.fillStyle = "#8D8D8D";
  ctx.font = font(700, 14);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";
  ctx.fillText("CHAPTERS", 52, chapterY + 36);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  const maxCount = Math.max(...chapters.map((chapter) => chapter.count), 1);
  chapters.forEach((chapter, index) => {
    const rowY = chapterY + 64 + index * 46;
    ctx.fillStyle = "#222222";
    ctx.font = font(500, 20);
    ctx.fillText(chapter.name, 52, rowY + 16);
    const trackX = 330;
    const trackW = 360;
    fillRound(ctx, trackX, rowY, trackW, 16, 8, "#EEEEEE");
    const fillW = Math.max(16, Math.round((chapter.count / maxCount) * trackW));
    fillRound(ctx, trackX, rowY, fillW, 16, 8, "#111111");
    ctx.font = font(700, 20);
    ctx.fillStyle = "#222222";
    const countLabel = chapter.count.toLocaleString("en-US");
    const countWidth = ctx.measureText(countLabel).width;
    ctx.fillText(countLabel, WIDTH - 52 - countWidth, rowY + 16);
  });

  const footY = chapterY + chapterH + 28;
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, footY, WIDTH, footer);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = font(500, 20);
  ctx.fillText("Get your seat", 40, footY + 48);
  ctx.font = font(700, 20);
  const site = "ibmcph.com";
  const siteWidth = ctx.measureText(site).width;
  ctx.fillText(site, WIDTH - 40 - siteWidth, footY + 48);

  return canvas.toBuffer("image/jpeg", 90);
}

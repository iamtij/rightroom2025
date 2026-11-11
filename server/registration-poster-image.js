import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "fonts", "Archivo.ttf");
const logoFile = path.join(root, "public", "assets", "ibmc-2027-logo.png");
GlobalFonts.registerFromPath(fontFile, "Archivo");
const logoPromise = loadImage(logoFile);

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

export async function renderPosterJpeg(poster) {
  const logo = await logoPromise;
  const chapters = poster.chapters || [];
  const header = 230;
  const footer = 78;
  const y = header + 8 + 28;
  const labelY = y + 108;
  const splitY = labelY + 52;
  const cardY = splitY + 108;
  const chapterY = cardY + 132;
  const chapterH = 64 + chapters.length * 46;
  const footY = chapterY + chapterH + 28;
  const height = footY + footer;
  const canvas = createCanvas(WIDTH * SCALE, height * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  ctx.fillStyle = "#F3F4F6";
  ctx.fillRect(0, 0, WIDTH, height);

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, WIDTH, header);
  const logoWidth = 300;
  const logoHeight = Math.round(logoWidth * (logo.height / logo.width));
  ctx.drawImage(logo, 36, 26, logoWidth, logoHeight);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = font(800, 42);
  ctx.fillText("Registration update", 40, 168);
  ctx.fillStyle = "#D6D6D6";
  ctx.font = font(400, 22);
  ctx.fillText(`As of ${poster.asOfLabel}`, 40, 206);

  ctx.fillStyle = "#D0121B";
  ctx.fillRect(0, header, WIDTH, 8);

  const paid = poster.paid || 0;
  const fullPaid = poster.fullPaid || 0;
  const installments = poster.installments || 0;
  ctx.fillStyle = "#111111";
  ctx.font = font(800, 92);
  ctx.fillText(paid.toLocaleString("en-US"), 40, y + 78);
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

  ctx.fillStyle = "#111111";
  ctx.font = font(800, 64);
  ctx.fillText(fullPaid.toLocaleString("en-US"), 40, splitY + 52);
  ctx.fillText(installments.toLocaleString("en-US"), 400, splitY + 52);
  ctx.fillStyle = "#5C5C5C";
  ctx.font = font(700, 16);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "1.2px";
  ctx.fillText("FULLY PAID", 40, splitY + 80);
  ctx.fillText("INSTALLMENTS", 400, splitY + 80);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
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

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const sessionSecret = process.env.ADMIN_SESSION_SECRET || "";
if (process.env.NODE_ENV === "production" && (sessionSecret.length < 32 || sessionSecret === "ibmc-dev-session")) {
  console.error("ADMIN_SESSION_SECRET must be a random value of at least 32 characters");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
const pageHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const inlineScript = pageHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";
const scriptHash = createHash("sha256").update(inlineScript).digest("base64");
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' https://connect.facebook.net https://challenges.cloudflare.com 'sha256-${scriptHash}'`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https://www.facebook.com",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self' https://www.facebook.com https://connect.facebook.net https://challenges.cloudflare.com https://*.ingest.us.sentry.io",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
app.use((_req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", contentSecurityPolicy);
  next();
});

const { createApi } = await import('./server/api.js');
const api = createApi();
app.use((req, res, next) => {
  if (!req.url.startsWith('/api')) return next();
  api(req, res, next);
});

app.use((req, res, next) => {
  if (req.path.endsWith(".map")) {
    res.status(404).end();
    return;
  }
  next();
});
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.IBMC_STAGING_SAFE_MODE === "true") {
    console.log("IBMC_STAGING_SAFE_MODE: outbound email/SMS and automatic backups are suppressed; login codes still send");
  }
});

process.once("SIGTERM", () => {
  const force = setTimeout(() => process.exit(0), 10_000);
  force.unref();
  server.close(() => process.exit(0));
});

process.once("SIGTERM", () => {
  const force = setTimeout(() => process.exit(0), 10_000);
  force.unref();
  server.close(() => process.exit(0));
});

try {
  const { openDatabase } = await import('./server/db.js');
  const { startBackupLoop } = await import('./server/backup.js');
  const db = openDatabase();
  startBackupLoop(db);
  if (process.env.REMINDERS_ENABLED !== 'false') {
    const { startReminderLoop } = await import('./server/reminders.js');
    startReminderLoop(db);
  }
} catch (error) {
  console.error('Reminder database was not started:', error.message);
  const { reportError } = await import('./server/report-error.js');
  reportError(error);
}

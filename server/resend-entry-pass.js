import { pathToFileURL } from "url";
import { openDatabase } from "./db.js";
import { sendEntryPassForRegistration } from "./reminders.js";

const reference = String(process.argv[2] || "").trim();
if (!reference) {
  console.error("Usage: node server/resend-entry-pass.js <registration-reference>");
  process.exit(1);
}

await import("dotenv/config");
const db = openDatabase();
const row = db.prepare("SELECT id FROM registrations WHERE reference = ?").get(reference);
if (!row) {
  console.error("Registration not found");
  process.exit(1);
}
const result = await sendEntryPassForRegistration(db, row.id, { force: true });
if (!result.ok) {
  console.error(result.error || result.status || "send_failed");
  process.exit(1);
}
console.log(`Entry pass email sent for ${reference}`);

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!invokedDirectly) process.exit(0);

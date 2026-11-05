import "dotenv/config";
import { downloadBackup } from "./backup.js";

const [objectKey, destination] = process.argv.slice(2);
if (!objectKey || !destination) {
  console.error("Usage: node server/restore-backup.js <object-key> <output-sqlite>");
  process.exit(1);
}

await downloadBackup(objectKey, destination);
console.log(`Restored to ${destination}`);

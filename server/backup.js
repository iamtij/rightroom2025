import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import fs from "fs";
import http from "node:http";
import https from "node:https";
import os from "os";
import path from "path";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { reportError } from "./report-error.js";
import { automaticBackupsSuppressed } from "./staging-safe.js";

const MAGIC = Buffer.from("IBMCBAK1");
const RETENTION_DAYS = 30;

export function encryptionKey() {
  const raw = (process.env.BACKUP_ENCRYPTION_KEY || "").trim();
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function encryptBackup(plain, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackup(payload, key) {
  if (payload.length < MAGIC.length + 12 + 16 || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Backup file is not an IBMC backup");
  }
  const iv = payload.subarray(8, 20);
  const tag = payload.subarray(20, 36);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(36)), decipher.final()]);
}

function bucketConfig() {
  const endpoint = process.env.BACKUP_S3_ENDPOINT || "";
  const bucket = process.env.BACKUP_S3_BUCKET || "";
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY || "";
  const unresolved = [endpoint, bucket, accessKeyId, secretAccessKey].some((value) => !value || value.includes("${{"));
  if (unresolved) return null;
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.BACKUP_S3_REGION || "auto",
  };
}

const CLOSED_UPLOAD = new Set(["EPIPE", "ECONNRESET", "ECONNABORTED"]);
const closedPipeGuarded = Symbol("closedPipeGuarded");

// Object storage can answer 502 and close the socket while the encrypted
// database is still being written. Node completes that write from
// WriteWrap.onWriteComplete, and with no remaining request error listener the
// EPIPE/ECONNRESET exits the process. Finishing the write callback keeps the
// failure on the S3 request so the backup job can catch it.
function closedPipeCallback(callback) {
  return (error) => {
    if (typeof callback !== "function") return;
    if (error && !CLOSED_UPLOAD.has(error.code)) {
      callback(error);
      return;
    }
    callback(null);
  };
}

function guardClosedPipe(socket) {
  if (!socket || socket[closedPipeGuarded]) return socket;
  socket[closedPipeGuarded] = true;
  const write = socket._write;
  socket._write = function guardedWrite(data, encoding, callback) {
    return write.call(socket, data, encoding, closedPipeCallback(callback));
  };
  const writev = socket._writev;
  if (typeof writev === "function") {
    socket._writev = function guardedWritev(chunks, callback) {
      return writev.call(socket, chunks, closedPipeCallback(callback));
    };
  }
  return socket;
}

class GuardedHttpAgent extends http.Agent {
  createConnection(options, callback) {
    return guardClosedPipe(super.createConnection(options, callback));
  }
}

class GuardedHttpsAgent extends https.Agent {
  createConnection(options, callback) {
    return guardClosedPipe(super.createConnection(options, callback));
  }
}

export function createBackupHttpAgents(tls = {}) {
  return {
    httpAgent: new GuardedHttpAgent({ keepAlive: true, maxSockets: 50 }),
    httpsAgent: new GuardedHttpsAgent({ keepAlive: true, maxSockets: 50, ...tls }),
  };
}

export function createBackupClient(config, options = {}) {
  const agents = createBackupHttpAgents(options.tls);
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: options.forcePathStyle === true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
    requestHandler: new NodeHttpHandler({
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
    }),
  });
}

function s3(config) {
  return createBackupClient(config);
}

async function pruneOldBackups(client, bucket) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let token;
  do {
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: "nightly/",
      ContinuationToken: token,
    }));
    for (const item of listed.Contents || []) {
      if (!item.Key || !item.LastModified || item.LastModified.getTime() >= cutoff) continue;
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: item.Key }));
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
}

export async function createEncryptedBackup(db) {
  if (automaticBackupsSuppressed()) {
    console.log("Database backup skipped: IBMC_STAGING_SAFE_MODE is enabled");
    return null;
  }
  const key = encryptionKey();
  const config = bucketConfig();
  if (!key || !config) {
    console.error("Database backup skipped: backup encryption or bucket settings are missing");
    return null;
  }
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const objectKey = `nightly/ibmc-${stamp}.sqlite.enc`;
  const tempPath = path.join(os.tmpdir(), `ibmc-${stamp}.sqlite`);
  let client;
  try {
    await db.backup(tempPath);
    client = s3(config);
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: encryptBackup(fs.readFileSync(tempPath), key),
      ContentType: "application/octet-stream",
    }));
    await pruneOldBackups(client, config.bucket);
    console.log(`Database backup stored: ${objectKey}`);
    return objectKey;
  } finally {
    client?.destroy();
    fs.rmSync(tempPath, { force: true });
  }
}

function msUntilManilaHour(hour) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  let delta = hour * 3600 - (read("hour") * 3600 + read("minute") * 60 + read("second"));
  if (delta <= 0) delta += 86400;
  return delta * 1000;
}

export function startBackupLoop(db) {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    createEncryptedBackup(db)
      .catch((error) => {
        console.error("Database backup failed:", error.message);
        reportError(error);
      })
      .finally(() => {
        running = false;
      });
  };
  const first = setTimeout(run, 20_000);
  const scheduleNext = () => {
    const timer = setTimeout(() => {
      run();
      scheduleNext();
    }, msUntilManilaHour(3));
    if (typeof timer.unref === "function") timer.unref();
  };
  scheduleNext();
  if (typeof first.unref === "function") first.unref();
}

export async function downloadBackup(objectKey, destination) {
  const key = encryptionKey();
  const config = bucketConfig();
  if (!key || !config) throw new Error("Backup settings are missing");
  const client = s3(config);
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }));
    fs.writeFileSync(destination, decryptBackup(Buffer.from(await response.Body.transformToByteArray()), key));
  } finally {
    client.destroy();
  }
}

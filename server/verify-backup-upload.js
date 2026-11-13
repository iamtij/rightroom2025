import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createBackupClient, createBackupHttpAgents } from "./backup.js";

const crashes = [];
process.on("uncaughtException", (error) => {
  crashes.push(error);
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ibmc-backup-upload-"));
const keyPath = path.join(dir, "key.pem");
const certPath = path.join(dir, "cert.pem");
execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048",
  "-keyout", keyPath,
  "-out", certPath,
  "-days", "1",
  "-nodes",
  "-subj", "/CN=localhost",
], { stdio: "ignore" });

const server = https.createServer({
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
}, (req, res) => {
  req.on("error", () => {});
  if (req.url.includes("stored.sqlite.enc")) {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { etag: '"backup"', "content-length": "0" });
      res.end();
    });
    return;
  }
  res.writeHead(502, { "content-length": "0", connection: "keep-alive" });
  res.end();
  req.on("data", () => {
    if (!req.socket.destroyed) req.socket.destroy();
  });
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const body = Buffer.alloc(1024 * 1024, 7);
  const agents = createBackupHttpAgents({ rejectUnauthorized: false });

  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("backup upload response timed out")), 2000);
    const req = https.request({
      host: "127.0.0.1",
      port,
      method: "PUT",
      path: "/ibmc-backups/nightly/test.sqlite.enc",
      rejectUnauthorized: false,
      agent: agents.httpsAgent,
      headers: { "content-length": String(body.length) },
    }, (res) => {
      res.resume();
      res.on("end", () => {
        clearTimeout(timer);
        resolve(res.statusCode);
      });
    });
    req.end(body);
  });
  assert.equal(status, 502);
  assert.equal(crashes.length, 0);

  const client = createBackupClient({
    region: "auto",
    endpoint: `https://127.0.0.1:${port}`,
    accessKeyId: "test",
    secretAccessKey: "test",
  }, {
    forcePathStyle: true,
    maxAttempts: 1,
    tls: { rejectUnauthorized: false },
  });
  try {
    await assert.rejects(() => client.send(new PutObjectCommand({
      Bucket: "ibmc-backups",
      Key: "nightly/test.sqlite.enc",
      Body: body,
      ContentType: "application/octet-stream",
    })));
  } finally {
    client.destroy();
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(crashes.length, 0);

  const stored = createBackupClient({
    region: "auto",
    endpoint: `https://127.0.0.1:${port}`,
    accessKeyId: "test",
    secretAccessKey: "test",
  }, {
    forcePathStyle: true,
    maxAttempts: 1,
    tls: { rejectUnauthorized: false },
  });
  try {
    await stored.send(new PutObjectCommand({
      Bucket: "ibmc-backups",
      Key: "nightly/stored.sqlite.enc",
      Body: Buffer.from("backup-bytes"),
      ContentType: "application/octet-stream",
    }));
  } finally {
    stored.destroy();
  }
  assert.equal(crashes.length, 0);
  agents.httpAgent.destroy();
  agents.httpsAgent.destroy();
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}

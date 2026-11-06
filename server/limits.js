export function rateLimit({ windowMs, max, bucket, db }) {
  return function limit(req, res, next) {
    const database = db();
    const now = Date.now();
    const ip = req.ip || "unknown";
    database.prepare("DELETE FROM rate_hits WHERE bucket = ? AND ip = ? AND at < ?").run(bucket, ip, now - windowMs);
    const count = database.prepare("SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ? AND ip = ?").get(bucket, ip).n;
    if (count >= max) {
      const oldest = database.prepare("SELECT MIN(at) AS at FROM rate_hits WHERE bucket = ? AND ip = ?").get(bucket, ip).at || now;
      const retry = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      res.setHeader("Retry-After", String(retry));
      res.status(429).json({ error: "Too many requests. Try again shortly." });
      return;
    }
    database.prepare("INSERT INTO rate_hits (bucket, ip, at) VALUES (?, ?, ?)").run(bucket, ip, now);
    next();
  };
}

export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return function limit(req, res, next) {
    const now = Date.now();
    const key = req.ip || "unknown";
    const recent = (hits.get(key) || []).filter((time) => now - time < windowMs);
    if (recent.length >= max) {
      const retry = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      res.setHeader("Retry-After", String(retry));
      res.status(429).json({ error: "Too many requests. Try again shortly." });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [name, times] of hits) {
        if (times.every((time) => now - time >= windowMs)) hits.delete(name);
      }
    }
    next();
  };
}

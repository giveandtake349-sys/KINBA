import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetMs: number;
}

const buckets = new Map<string, RateLimitEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now >= entry.resetMs) buckets.delete(key);
  }
}, 60_000);

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyPrefix: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const key = `${opts.keyPrefix}:${ip}`;
    let entry = buckets.get(key);

    if (!entry || now >= entry.resetMs) {
      entry = { count: 0, resetMs: now + opts.windowMs };
      buckets.set(key, entry);
    }

    entry.count++;

    if (entry.count > opts.max) {
      res.setHeader("Retry-After", Math.ceil((entry.resetMs - now) / 1000));
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }

    next();
  };
}

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

/**
 * Minimal structural shape getClientIp needs. Both Express 4 and Express 5
 * Request objects satisfy this, avoiding a hard dependency on one
 * @types/express version (the repo has both in the tree).
 */
export interface ClientIpSource {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string | undefined };
}

export function getClientIp(req: ClientIpSource): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    // Proxies APPEND to X-Forwarded-For, so only the LAST hop is trustworthy:
    // a client can prepend fake entries but cannot forge what a proxy appends
    // after their position. Taking [0] lets attackers rotate spoofed IPs and
    // dodge (or poison) IP-keyed rate limits and dedup.
    const hops = forwarded
      .split(",")
      .map(hop => hop.trim())
      .filter(Boolean);
    const lastHop = hops[hops.length - 1];
    if (lastHop) return lastHop;
  }
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

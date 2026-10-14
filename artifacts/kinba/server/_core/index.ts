import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { isAllowedCorsOrigin, parseAllowedOrigins } from "../httpSecurity";
import { serveStatic, setupVite } from "./vite";
import { registerVideoUploadRoute } from "../videoUploadRoute";
import { registerDmUploadRoute } from "../dmMedia";
import { registerCommentRoutes } from "../commentRoutes";
import { getVideoSharePreview, listSpotlightHighlights } from "../db";
import { getClientIp, rateLimit } from "../rateLimiter";
import { getClickTarget, recordLinkClick } from "../submissions";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { execSync } from "node:child_process";

function getBuildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (sha) return sha;
  } catch {
    // git not available or not a repo
  }
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (sha) return sha.slice(0, 12);
  } catch {
    // git not available
  }
  return "unknown";
}

const BUILD_ID = getBuildId();

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Render and other reverse proxies forward the original HTTPS scheme. Trusting
  // the first proxy keeps secure session cookies stable for protected mutations.
  app.set("trust proxy", 1);

  // --- Health check: fast liveness probe (no DB dependency) ---
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // --- Readiness check: includes DB connectivity (used by monitoring, not by Render routing) ---
  app.get("/api/ready", async (_req, res) => {
    try {
      const db = await getDb();
      if (!db) {
        res.status(200).json({ ok: true, db: "not_configured" });
        return;
      }
      await db.execute(sql`SELECT 1`);
      res.status(200).json({ ok: true, db: "connected" });
    } catch (error) {
      console.error("[Readiness] Database check failed:", error);
      res.status(503).json({ ok: false, db: "unreachable" });
    }
  });

  app.get("/api/spotlight/highlights", async (_req, res) => {
    try {
      const highlights = await listSpotlightHighlights();
      return res.status(200).json({ highlights });
    } catch (error) {
      console.error("[Spotlight] Failed to load highlights:", error);
      return res.status(200).json({ highlights: [] });
    }
  });
  app.get("/videos/:videoId", async (req, res, next) => {
    const userAgent = req.get("user-agent") || "";
    if (!/(bot|crawler|spider|facebookexternalhit|whatsapp|slack|twitter)/i.test(userAgent)) return next();
    const videoId = Number(req.params.videoId);
    if (!Number.isInteger(videoId) || videoId <= 0) return next();
    const preview = await getVideoSharePreview(videoId);
    if (!preview) return next();
    const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
    const canonical = `${req.protocol}://${req.get("host")}/videos/${videoId}`;
    res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(preview.title)}</title><meta name="description" content="${escape(preview.description)}"><meta property="og:title" content="${escape(preview.title)}"><meta property="og:description" content="${escape(preview.description)}"><meta property="og:url" content="${canonical}">${preview.image ? `<meta property="og:image" content="${escape(preview.image)}">` : ""}<meta property="og:type" content="article"><meta property="og:site_name" content="JHILIK"><meta name="twitter:card" content="summary_large_image"></head><body><p>Open in JHILIK</p></body></html>`);
  });
  const allowedOrigins = parseAllowedOrigins(
    [
      process.env.CORS_ORIGIN?.trim(),
      "https://kinba.onrender.com",
      "https://ba.onrender.com",
    ]
      .filter(Boolean)
      .join(","),
  );
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (!isAllowedCorsOrigin(origin, allowedOrigins)) return next();

    res.vary("Origin");
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Range"
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Accept-Ranges, Content-Length, Content-Range, Content-Type"
    );
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  });

  // Build identification header for all responses
  app.use((_req, res, next) => {
    res.setHeader("X-Build-Id", BUILD_ID);
    next();
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerVideoUploadRoute(app);
  registerDmUploadRoute(app);
  registerCommentRoutes(app);

  // --- Rate limiting ---
  // Search: 60 req/min — normal browsing involves typing + auto-search
  app.use("/api/trpc/home.search", rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "srch" }));
  app.use("/api/trpc/home.searchAll", rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "srch" }));

  // Hashtag: 60 req/min — similar to search
  app.use("/api/trpc/hashtag.byTag", rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "tag" }));
  app.use("/api/trpc/hashtag.content", rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "tag" }));
  app.use("/api/trpc/hashtag.suggest", rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "tag" }));

  // Spotlight: 10 req/min — loaded on page views, not continuous
  app.use("/api/spotlight/highlights", rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "spot" }));

  // View: 30 req/min — allows normal multi-video browsing
  app.use("/api/trpc/videos.view", rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "view" }));

  // Comments: 10 req/min — prevents spam
  app.use("/api/trpc/videos.comments.create", rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "cmt" }));
  app.use("/api/trpc/community.comments.create", rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "cmt" }));

  // Reactions/likes: 30 req/min — fast toggling is normal
  app.use("/api/trpc/videos.react", rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "react" }));
  app.use("/api/trpc/videos.comments.like", rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "react" }));
  app.use("/api/trpc/videos.comments.react", rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "react" }));
  app.use("/api/trpc/community.react", rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "react" }));

  // Shares/bookmarks/follows: 20 req/min
  app.use("/api/trpc/videos.share", rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "share" }));
  app.use("/api/trpc/videos.bookmark", rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "bkmk" }));
  app.use("/api/trpc/profile.toggleFollow", rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "fol" }));
  app.use("/api/trpc/community.bookmark", rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "bkmk" }));

  // Video creation: 5 req/min — expensive, infrequent
  app.use("/api/trpc/videos.create", rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "create" }));

  // Community post creation: 5 req/min
  app.use("/api/trpc/community.create", rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "create" }));

  // Drop claims: 10 req/min — spec §21.4; prevents claim-spam races
  app.use("/api/trpc/drops.claim", rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "claim" }));

  // Room messages: 20 req/min — spec §21.4 proposal for sendMessage
  app.use("/api/trpc/hypeRooms.sendMessage", rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "roommsg" }));

  // M9 reports: 10 req/min — E13 (rate limiter keys by client IP)
  app.use("/api/trpc/reports.create", rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "rpt" }));

  // Profile updates: 5 req/min
  app.use("/api/trpc/profile.update", rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "prof" }));

  // Feature flag toggles: 20 req/min — rare admin action
  app.use("/api/trpc/admin.featureFlags.set", rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "flag" }));

  // Global catch-all for any tRPC route not explicitly limited: 120 req/min
  app.use("/api/trpc", rateLimit({ windowMs: 60_000, max: 120, keyPrefix: "tRPC" }));

  // JHILIK Ads Phase 4 — short link redirect with click tracking.
  // Idempotent per (linkId, ipHash, UTC day); bots are redirected but not counted.
  // Must sit before the static/Vite catch-all below.
  app.get(
    "/r/:linkId",
    rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "clk" }),
    async (req, res) => {
      const linkId = Number(req.params.linkId);
      if (!Number.isInteger(linkId) || linkId <= 0) {
        return res.status(404).send("Not found");
      }
      const target = await getClickTarget(linkId);
      if (!target) return res.status(404).send("Not found");
      const userAgent = req.get("user-agent") || "";
      const isBot = /(bot|crawler|spider|facebookexternalhit|whatsapp|slack|twitter)/i.test(userAgent);
      if (!isBot) {
        try {
          await recordLinkClick({
            linkId,
            ip: getClientIp(req),
            ipSalt: process.env.CLICK_SALT ?? "jhilik-click-salt",
            userAgent,
            referrer: req.get("referer") || req.get("referrer") || null,
          });
        } catch (error) {
          // A tracking failure must never break the redirect itself.
          console.error("[ClickTracking] Failed to record click:", error);
        }
      }
      return res.redirect(302, target);
    }
  );

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // --- Global Express error handler (must be last) ---
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[Express] Unhandled error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  const port = Number(process.env.PORT || 10000);

  // Eagerly initialize DB pool so it's ready when the first API request arrives.
  // This avoids lazy-init latency on cold start.
  getDb().catch(() => {});

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `Server running on 0.0.0.0:${port}/ (direct original-video playback enabled; HLS recovery disabled)`
    );
  });
}

// --- Process-level error handlers ---
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Process] Unhandled Promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught exception:", error);
});

startServer().catch(error => {
  console.error("[Startup] Server failed to start:", error);
  process.exitCode = 1;
});

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
import { registerCommentRoutes } from "../commentRoutes";
import { listSpotlightHighlights } from "../db";
import { rateLimit } from "../rateLimiter";
import { getDb } from "../db";
import { sql } from "drizzle-orm";

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
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerVideoUploadRoute(app);
  registerCommentRoutes(app);

  // --- Rate limiting ---
  // Search: 60 req/min — normal browsing involves typing + auto-search
  app.use("/api/trpc/home.search", rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "srch" }));
  app.use("/api/trpc/home.searchAll", rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "srch" }));

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

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

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Render and other reverse proxies forward the original HTTPS scheme. Trusting
  // the first proxy keeps secure session cookies stable for protected mutations.
  app.set("trust proxy", 1);
  // Keep the platform health check independent of Supabase, R2, auth, and HLS.
  // Render must be able to verify the process is alive while integrations are
  // unavailable or background jobs are recovering.
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  const allowedOrigins = parseAllowedOrigins(
    process.env.CORS_ORIGIN?.trim() || "https://kinba.onrender.com,https://ba.onrender.com"
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

  const port = Number(process.env.PORT || 10000);

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `Server running on 0.0.0.0:${port}/ (direct original-video playback enabled; HLS recovery disabled)`
    );
  });
}

startServer().catch(error => {
  console.error("[Startup] Server failed to start:", error);
  process.exitCode = 1;
});

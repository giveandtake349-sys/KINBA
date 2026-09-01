import type { Express } from "express";
import { storageGet } from "../storage";

/**
 * Media delivery is intentionally redirect-only. R2 handles range requests,
 * caching, and connection memory; the Render process never owns a video body.
 */
export function registerStorageProxy(app: Express) {
  app.get("/api/media/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing media key");
      return;
    }
    try {
      const stored = await storageGet(key);
      res.set("Cache-Control", "public, max-age=3600");
      res.redirect(307, stored.url);
    } catch (error) {
      console.error("[StorageProxy] R2 redirect failed:", error);
      res.status(404).send("Media unavailable");
    }
  });

  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    try {
      const stored = await storageGet(key);
      res.set("Cache-Control", "public, max-age=3600");
      res.redirect(307, stored.url);
    } catch (error) {
      console.error("[StorageProxy] Legacy storage redirect failed:", error);
      res.status(502).send("Storage backend error");
    }
  });
}

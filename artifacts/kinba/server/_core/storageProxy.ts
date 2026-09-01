import type { Express } from "express";
import { storageGet, storageReadObject } from "../storage";

function rewriteManifest(text: string) {
  return text
    .split(/\r?\n/)
    .map(line => {
      if (!line.trim()) return line;
      const rewrite = (url: string) => {
        try {
          const parsed = new URL(url);
          return parsed.hostname.endsWith(".r2.dev")
            ? `/api/media/${parsed.pathname.replace(/^\/+/, "")}`
            : url;
        } catch {
          return `/api/media/${url.replace(/^\/+/, "")}`;
        }
      };
      if (line.startsWith("#")) {
        return line.replace(/URI="(https?:\/\/[^\"]+\.r2\.dev[^\"]*)"/gi, (_match, url) => `URI="${rewrite(url)}"`);
      }
      return rewrite(line.trim());
    })
    .join("\n");
}

export function registerStorageProxy(app: Express) {
  app.get("/api/media/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing media key");
      return;
    }
    try {
      if (/\.m3u8(?:$|\?)/i.test(key)) {
        const object = await storageReadObject(key);
        const chunks: Buffer[] = [];
        for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
        res.set({
          "Cache-Control": "public, max-age=60",
          "Content-Type": "application/vnd.apple.mpegurl",
        });
        res.send(rewriteManifest(Buffer.concat(chunks).toString("utf8")));
        return;
      }
      const object = await storageReadObject(key, req.header("range") || undefined);
      res.status(object.contentRange ? 206 : 200).set({
        "Cache-Control": "public, max-age=3600",
        "Accept-Ranges": object.acceptRanges || "bytes",
        ...(object.contentLength === undefined ? {} : { "Content-Length": String(object.contentLength) }),
        ...(object.contentRange ? { "Content-Range": object.contentRange } : {}),
        "Content-Type": object.contentType || (key.endsWith(".ts") ? "video/mp2t" : "application/octet-stream"),
      });
      object.body.on("error", error => {
        if (!res.headersSent) res.status(502).end();
        else res.destroy(error);
      });
      object.body.pipe(res);
    } catch (error) {
      console.error("[StorageProxy] R2 media read failed:", error);
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
      console.error("[StorageProxy] Legacy storage read failed:", error);
      res.status(502).send("Storage backend error");
    }
  });
}

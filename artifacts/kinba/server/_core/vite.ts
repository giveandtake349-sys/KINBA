import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";
import { ENV } from "./env";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

function runtimeConfigScript() {
  const config = JSON.stringify({
    supabaseUrl: ENV.supabaseUrl || undefined,
    supabaseAnonKey: ENV.supabaseAnonKey || undefined,
  }).replace(/</g, "\\u003c");
  return `<script>window.__KINBA_CONFIG__=${config};</script>`;
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  const indexPath = path.resolve(distPath, "index.html");
  const sendIndex = async (_req: express.Request, res: express.Response) => {
    try {
      const template = await fs.promises.readFile(indexPath, "utf-8");
      const html = template.replace("</head>", `${runtimeConfigScript()}</head>`);
      res.status(200).type("html").send(html);
    } catch (error) {
      console.error("[Static] Could not serve the KINBA client:", error);
      res.status(500).send("KINBA client is unavailable.");
    }
  };

  // Serve the index through the injector even when the browser requests "/".
  app.get(["/", "/index.html"], sendIndex);
  app.use(express.static(distPath));

  // Fall through to index.html for client-side routes.
  app.use("*", sendIndex);
}

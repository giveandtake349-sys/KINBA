import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const configuredCorsOrigins = [
  process.env.CORS_ORIGINS,
  process.env.CORS_ORIGIN,
  process.env.FRONTEND_URL,
  process.env.VERCEL_FRONTEND_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
]
  .flatMap(value => (value ?? "").split(","))
  .map(value => value.trim().replace(/\/$/, ""))
  .filter(Boolean);
const allowAllCors = configuredCorsOrigins.includes("*");
const allowedCorsOrigins = new Set([
  ...configuredCorsOrigins.filter(origin => origin !== "*"),
  "https://upbids.vercel.app",
]);
const isVercelOrigin = (origin: string) =>
  /^https:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app$/i.test(origin);
const isLocalOrigin = (origin: string) =>
  process.env.NODE_ENV !== "production" &&
  /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);

const corsOrigin = (
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) => {
  if (!origin || allowAllCors || allowedCorsOrigins.has(origin) || isVercelOrigin(origin) || isLocalOrigin(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error("Origin is not allowed by KINBA API CORS policy"));
};

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    optionsSuccessStatus: 204,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;

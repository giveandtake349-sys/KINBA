import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { pushTokens } from "../drizzle/schema";

const SECRET_FILE_PATH = "/etc/secrets/firebase-service-account.json";
let firebaseApp: App | null | undefined;

function loadServiceAccount(): Record<string, string> | null {
  try {
    const raw = existsSync(SECRET_FILE_PATH)
      ? readFileSync(SECRET_FILE_PATH, "utf8")
      : process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
        ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8")
        : process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    const account = JSON.parse(raw) as Record<string, string>;
    if (account.private_key) {
      account.private_key = account.private_key.replace(/\\n/g, "\n");
    }
    return account;
  } catch (error) {
    console.error("[PushNotifications] Firebase credential could not be loaded", error);
    return null;
  }
}

function getFirebaseApp(): App | null {
  if (firebaseApp !== undefined) return firebaseApp;
  const account = loadServiceAccount();
  if (!account?.project_id || !account.client_email || !account.private_key) {
    console.warn("[PushNotifications] Firebase credential is not configured; push delivery is disabled");
    firebaseApp = null;
    return null;
  }
  try {
    firebaseApp = getApps()[0] ?? initializeApp({ credential: cert(account) });
    return firebaseApp;
  } catch (error) {
    console.error("[PushNotifications] Firebase Admin initialization failed", error);
    firebaseApp = null;
    return null;
  }
}

export async function upsertPushToken(input: {
  userId: number;
  token: string;
  platform: "android" | "ios";
}): Promise<{ registered: true }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(pushTokens)
    .values({ userId: input.userId, token: input.token, platform: input.platform })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId: input.userId, platform: input.platform, updatedAt: new Date() },
    });
  return { registered: true };
}

export async function removePushTokens(tokens: string[]): Promise<void> {
  if (!tokens.length) return;
  const db = await getDb();
  if (!db) return;
  await db.delete(pushTokens).where(inArray(pushTokens.token, tokens));
}

export async function sendPushToUser(input: {
  userId: number;
  title: string;
  body?: string | null;
  link?: string | null;
  notificationId?: number;
}): Promise<number> {
  const app = getFirebaseApp();
  if (!app) return 0;
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(eq(pushTokens.userId, input.userId))
    .limit(500);
  if (!rows.length) return 0;

  const response = await getMessaging(app).sendEachForMulticast({
    tokens: rows.map(row => row.token),
    notification: { title: input.title, body: input.body ?? undefined },
    data: {
      link: input.link ?? "/",
      notificationId: input.notificationId ? String(input.notificationId) : "",
    },
  });

  const invalidTokens = response.responses
    .map((result, index) =>
      !result.success && result.error &&
      ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(result.error.code)
        ? rows[index]?.token
        : null
    )
    .filter((token): token is string => Boolean(token));
  await removePushTokens(invalidTokens);
  return response.successCount;
}

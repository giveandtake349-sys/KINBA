import { Capacitor } from "@capacitor/core";
import {
  PushNotifications,
  type ActionPerformed,
  type Token,
} from "@capacitor/push-notifications";

const PUSH_TOKEN_STORAGE_KEY = "kinba.push-token";

/**
 * Registers the native Android/iOS app for FCM push notifications.
 * Web builds intentionally skip this path; browser notifications remain a
 * separate permission controlled by the web app.
 */
export async function initializePushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  await PushNotifications.addListener("registration", ({ value }: Token) => {
    localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, value);
    console.info("[PushNotifications] FCM token registered");
    window.dispatchEvent(new CustomEvent("kinba:push-token", { detail: value }));
  });

  await PushNotifications.addListener("registrationError", error => {
    console.error("[PushNotifications] registration failed", error);
  });

  await PushNotifications.addListener("pushNotificationReceived", notification => {
    console.info("[PushNotifications] notification received", notification);
    window.dispatchEvent(
      new CustomEvent("kinba:push-received", { detail: notification }),
    );
  });

  await PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action: ActionPerformed) => {
      console.info("[PushNotifications] notification opened", action);
      window.dispatchEvent(
        new CustomEvent("kinba:push-opened", { detail: action }),
      );
    },
  );

  const permission = await PushNotifications.checkPermissions();
  const granted =
    permission.receive === "granted"
      ? permission
      : await PushNotifications.requestPermissions();

  if (granted.receive !== "granted") {
    console.warn("[PushNotifications] notification permission was not granted");
    return;
  }

  await PushNotifications.register();
}

export function getRegisteredPushToken(): string | null {
  return localStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
}

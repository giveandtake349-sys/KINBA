import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * Slim global banner shown while the browser reports no network connection.
 * Mounted once near the app root; Retry revalidates cached queries.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const utils = trpc.useUtils();

  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="offline-banner" role="alert">
      <WifiOff size={16} aria-hidden="true" />
      <span>You&apos;re offline. Content may be outdated.</span>
      <button type="button" onClick={() => void utils.invalidate()}>
        Retry
      </button>
    </div>
  );
}

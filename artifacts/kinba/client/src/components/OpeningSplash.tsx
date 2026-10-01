import { useEffect, useRef, useState, type ReactNode } from "react";
import "./openingSplash.css";

const SPLASH_SESSION_KEY = "jhilik-opening-seen";
const SPLASH_FALLBACK_MS = 5_500;
const SPLASH_EXIT_MS = 360;

type OpeningSplashProps = {
  children: ReactNode;
};

function hasSeenSplash() {
  try {
    return window.sessionStorage.getItem(SPLASH_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export default function OpeningSplash({ children }: OpeningSplashProps) {
  const [showSplash, setShowSplash] = useState(() => !hasSeenSplash());
  const [isExiting, setIsExiting] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const completedRef = useRef(false);

  const complete = () => {
    if (completedRef.current || !showSplash) return;
    completedRef.current = true;

    try {
      window.sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
    } catch {
      // The splash still completes if storage is unavailable or blocked.
    }

    setIsExiting(true);
    window.setTimeout(() => setShowSplash(false), SPLASH_EXIT_MS);
  };

  useEffect(() => {
    if (!showSplash) return;
    const fallbackTimer = window.setTimeout(complete, SPLASH_FALLBACK_MS);
    return () => window.clearTimeout(fallbackTimer);
  }, [showSplash]);

  if (!showSplash) return <>{children}</>;

  return (
    <div
      className={`opening-splash${isExiting ? " opening-splash--exiting" : ""}`}
      role="status"
      aria-label="Loading JHILIK"
    >
      <video
        className={`opening-splash__video${videoReady ? " opening-splash__video--ready" : ""}`}
        src="/jhilik-opening.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        onCanPlay={() => setVideoReady(true)}
        onEnded={complete}
        onError={() => window.setTimeout(complete, 700)}
      />
      {!videoReady && <div className="opening-splash__fallback">JHILIK</div>}
    </div>
  );
}

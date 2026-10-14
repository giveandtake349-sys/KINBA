import { useEffect, useRef, useState } from "react";
import { ExternalLink, ShoppingBag, Volume2, VolumeX } from "lucide-react";
import { resolveMediaUrl } from "@/lib/runtimeConfig";
import type { ServedAd } from "./usePreRoll";
import "./preroll.css";

const SKIP_AFTER_SECS = 5;

/**
 * YouTube-style pre-roll overlay: "Ad" badge, brand name, 5-sec countdown
 * → Skip button, progress bar, shoppable Drop card when the ad carries one.
 * After skip/complete the parent plays the main video.
 */
export function PreRollOverlay({
  ad,
  muted,
  onMutedChange,
  onFinish,
}: {
  ad: ServedAd;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onFinish: (watchedSecs: number, skipped: boolean) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [canSkip, setCanSkip] = useState(false);
  const finishedRef = useRef(false);

  const finish = (watchedSecs: number, skipped: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish(watchedSecs, skipped);
  };

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
    void el.play().catch(() => {
      /* Autoplay blocked — viewer taps to play. */
    });
  }, [muted]);

  const remain = Math.max(0, SKIP_AFTER_SECS - Math.floor(elapsed));
  const progress = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

  return (
    <div
      className="preroll-overlay"
      role="region"
      aria-label={`Advertisement: ${ad.title}`}
      data-preroll-no-swipe
    >
      <video
        ref={videoRef}
        className="preroll-video"
        src={resolveMediaUrl(ad.videoUrl) ?? ""}
        playsInline
        muted={muted}
        preload="auto"
        onTimeUpdate={e => {
          const t = e.currentTarget.currentTime;
          setElapsed(t);
          if (t >= SKIP_AFTER_SECS) setCanSkip(true);
        }}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)}
        onEnded={() => finish(videoRef.current?.currentTime ?? duration, false)}
      />
      <span className="preroll-badge">Ad</span>
      <span className="preroll-brand">Sponsored · {ad.brandName}</span>
      <button
        type="button"
        className="preroll-mute"
        aria-label={muted ? "Unmute ad" : "Mute ad"}
        onClick={() => onMutedChange(!muted)}
      >
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>

      <div className="preroll-title">{ad.title}</div>

      {canSkip ? (
        <button
          type="button"
          className="preroll-skip ready"
          onClick={() => finish(videoRef.current?.currentTime ?? elapsed, true)}
        >
          Skip Ad
        </button>
      ) : (
        <span className="preroll-skip" aria-live="polite">
          Skip in {remain}s
        </span>
      )}

      {ad.drop ? (
        <div className="preroll-drop">
          <ShoppingBag size={16} aria-hidden="true" />
          <span className="preroll-drop-title">{ad.drop.title}</span>
          <span className="preroll-drop-price">
            {ad.drop.currency === "BDT" ? "৳" : "$"}
            {ad.drop.price}
          </span>
          <a
            className="preroll-drop-cta"
            href={`/drops/${ad.drop.id}`}
            onClick={e => e.stopPropagation()}
          >
            View Drop <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      ) : null}

      <div
        className="preroll-progress"
        role="progressbar"
        aria-label="Ad progress"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

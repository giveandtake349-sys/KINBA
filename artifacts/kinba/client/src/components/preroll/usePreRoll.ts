import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

export type ServedAd = {
  id: number;
  title: string;
  videoUrl: string;
  brandName: string;
  drop: {
    id: number;
    title: string;
    price: string;
    currency: string;
    mediaUrl: string;
  } | null;
};

/**
 * Session-level frequency counter: 1 ad per 3 videos watched.
 * Module-scoped so every ShortVideoCard shares one counter.
 */
let sessionVideoCount = 0;
const AD_EVERY_N_VIDEOS = 3;

type PreRollState = {
  /** The ad to show (null = no ad for this video). */
  ad: ServedAd | null;
  /** True while the ad overlay blocks the main video. */
  blocking: boolean;
  /** Dismiss the overlay after skip/complete and report the play. */
  finish: (watchedSecs: number, skipped: boolean) => void;
};

/**
 * Pre-roll gate for the shorts player. When a card becomes active, the
 * session counter increments; every 3rd video tries to fetch an ad.
 * While `blocking` is true the caller must pause the main video.
 */
export function usePreRoll(videoId: number, active: boolean): PreRollState {
  const [ad, setAd] = useState<ServedAd | null>(null);
  const [blocking, setBlocking] = useState(false);
  const fetchedRef = useRef(false);
  const reportedRef = useRef(false);
  const utils = trpc.useUtils();

  const reportMutation = trpc.preroll.reportPlay.useMutation();

  // Lazy query — only fired for every 3rd video.
  const adQuery = trpc.preroll.getAdForVideo.useQuery(
    { videoId },
    {
      enabled: false,
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    }
  );

  useEffect(() => {
    if (!active || fetchedRef.current) return;
    fetchedRef.current = true;
    sessionVideoCount += 1;
    if (sessionVideoCount % AD_EVERY_N_VIDEOS !== 0) return;
    sessionVideoCount = 0;
    void adQuery.refetch().then(res => {
      const served = (res.data ?? null) as ServedAd | null;
      if (served) {
        setAd(served);
        setBlocking(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, videoId]);

  const finish = useCallback(
    (watchedSecs: number, skipped: boolean) => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      setBlocking(false);
      setAd(null);
      if (ad) {
        void reportMutation
          .mutateAsync({
            adId: ad.id,
            videoId,
            watchedSecs: Math.max(0, Math.round(watchedSecs)),
            skipped,
          })
          .catch(() => {
            /* Play reporting must never break playback. */
          })
          .finally(() => {
            void utils.preroll.myAds.invalidate().catch(() => {});
          });
      }
    },
    [ad, videoId, reportMutation, utils]
  );

  return { ad, blocking, finish };
}

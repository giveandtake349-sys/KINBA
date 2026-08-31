import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";

type UseScrollDirectionOptions = {
  threshold?: number;
  stopDelay?: number;
};

/**
 * Tracks the direction of a scrollable feed surface. Navigation hides only
 * after a meaningful downward scroll and is restored for upward scrolls,
 * at the top of the feed, or after scrolling stops.
 */
export function useScrollDirection({
  threshold = 8,
  stopDelay = 180,
}: UseScrollDirectionOptions = {}) {
  const [isScrollingDown, setIsScrollingDown] = useState(false);
  const lastScrollTop = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStopTimer = useCallback(() => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
  }, []);

  const onFeedScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const scrollSurface = event.target;
      if (!(scrollSurface instanceof HTMLElement)) return;

      const currentScrollTop = Math.max(0, scrollSurface.scrollTop);
      const scrollDelta = currentScrollTop - lastScrollTop.current;

      if (currentScrollTop <= threshold || scrollDelta < -threshold) {
        setIsScrollingDown(false);
      } else if (scrollDelta > threshold) {
        setIsScrollingDown(true);
      }

      lastScrollTop.current = currentScrollTop;
      clearStopTimer();
      stopTimer.current = setTimeout(() => {
        setIsScrollingDown(false);
      }, stopDelay);
    },
    [clearStopTimer, stopDelay, threshold]
  );

  useEffect(() => {
    return clearStopTimer;
  }, [clearStopTimer]);

  return { isScrollingDown, onFeedScroll };
}

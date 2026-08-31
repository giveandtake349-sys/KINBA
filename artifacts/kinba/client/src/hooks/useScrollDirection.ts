import { useCallback, useEffect, useRef, useState } from "react";

type UseScrollDirectionOptions = {
  threshold?: number;
  stopDelay?: number;
};

const FEED_SCROLL_SELECTOR = "[data-feed-scroll], .media-feed-scroll, .shorts-viewport";

/**
 * Observes the document and KINBA's nested feed surfaces in capture phase.
 * Chrome is hidden only after a meaningful downward movement and is restored
 * when the feed moves upward, returns to its origin, or becomes idle.
 */
export function useScrollDirection({
  threshold = 5,
  stopDelay = 180,
}: UseScrollDirectionOptions = {}) {
  const [isScrollingDown, setIsScrollingDown] = useState(false);
  const lastScrollTop = useRef(0);
  const stopTimer = useRef<number | null>(null);

  const clearStopTimer = useCallback(() => {
    if (stopTimer.current !== null) {
      window.clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
  }, []);

  const handleScroll = useCallback(
    (event: Event) => {
      const target = event.target;
      const isFeedSurface =
        target instanceof HTMLElement && target.matches(FEED_SCROLL_SELECTOR);
      const isDocumentSurface =
        target === document ||
        target === document.documentElement ||
        target === document.body;

      if (!isFeedSurface && !isDocumentSurface) return;

      const scrollSurface = isFeedSurface
        ? (target as HTMLElement)
        : document.scrollingElement;
      if (!scrollSurface) return;

      const currentScrollTop = Math.max(0, scrollSurface.scrollTop);
      const scrollDelta = currentScrollTop - lastScrollTop.current;

      if (currentScrollTop <= threshold || scrollDelta < -threshold) {
        setIsScrollingDown(false);
      } else if (scrollDelta > threshold) {
        setIsScrollingDown(true);
      }

      lastScrollTop.current = currentScrollTop;
      clearStopTimer();
      stopTimer.current = window.setTimeout(() => {
        setIsScrollingDown(false);
      }, stopDelay);
    },
    [clearStopTimer, stopDelay, threshold]
  );

  useEffect(() => {
    document.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener("scroll", handleScroll, true);
      clearStopTimer();
    };
  }, [clearStopTimer, handleScroll]);

  return { isScrollingDown };
}

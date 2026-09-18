import { useCallback, useEffect, useRef, useState } from "react";

type UseScrollDirectionOptions = {
  threshold?: number;
};

const FEED_SCROLL_SELECTOR = "[data-feed-scroll], .media-feed-scroll, .shorts-viewport";
const SHORTS_VIEWER_SELECTOR = ".shorts-viewer-layer";

/**
 * Observes the document and KINBA's nested feed surfaces in capture phase.
 * Chrome is hidden after a meaningful downward movement and is restored
 * only when the feed scrolls upward or returns to the top.
 */
export function useScrollDirection({
  threshold = 5,
}: UseScrollDirectionOptions = {}) {
  const [isScrollingDown, setIsScrollingDown] = useState(false);
  const lastScrollTop = useRef(0);

  const handleScroll = useCallback(
    (event: Event) => {
      const target = event.target;
      const isShortsViewer =
        target instanceof HTMLElement &&
        (target.matches(SHORTS_VIEWER_SELECTOR) ||
          target.closest(SHORTS_VIEWER_SELECTOR));
      if (isShortsViewer) return;
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
    },
    [threshold]
  );

  useEffect(() => {
    document.addEventListener("scroll", handleScroll, {
      capture: true,
      passive: true,
    });

    return () => {
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [handleScroll]);

  return { isScrollingDown };
}

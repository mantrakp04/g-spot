import { useCallback, useEffect, useRef, useState } from "react";

type UseAutoScrollOptions = {
  /** Distance-from-bottom (px) past which an upward user scroll disables auto-scroll. */
  disableThreshold?: number;
  /** Distance-from-bottom (px) under which auto-scroll re-engages. */
  enableThreshold?: number;
};

/**
 * Intent-aware auto-scroll. While auto-scroll is enabled, the scroll container
 * is pinned to the bottom whenever the inner content container resizes. The
 * moment the user scrolls up past `disableThreshold`, auto-scroll disengages
 * until they scroll back within `enableThreshold` of the bottom.
 *
 * Observing only the *inner* content node (not the scroll container itself)
 * avoids resize feedback loops and lets streaming token updates drive scroll
 * without racing with `scroll` events.
 */
export function useAutoScroll(options: UseAutoScrollOptions = {}) {
  const { disableThreshold = 50, enableThreshold = 10 } = options;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    autoScrollRef.current = true;
    setIsAtBottom(true);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distance = scrollHeight - scrollTop - clientHeight;

      // Ignore synthetic scrolls at the top (scrollTop === 0) during initial
      // mount; without this, mounting with content already present looks like
      // "user scrolled up".
      if (
        scrollTop !== 0 &&
        scrollTop < lastScrollTopRef.current &&
        distance > disableThreshold
      ) {
        autoScrollRef.current = false;
      } else if (distance < enableThreshold) {
        autoScrollRef.current = true;
      }

      lastScrollTopRef.current = scrollTop;
      setIsAtBottom(distance < enableThreshold);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      if (autoScrollRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      // Recompute at-bottom flag after layout changes so the scroll-button
      // hides/shows in sync with content growth.
      const { scrollTop, scrollHeight, clientHeight } = container;
      setIsAtBottom(scrollHeight - scrollTop - clientHeight < enableThreshold);
    });

    resizeObserver.observe(content);

    // Snap to bottom on first mount *without* animation — `scroll-smooth`
    // on the container would otherwise animate from the top on page load.
    container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
    lastScrollTopRef.current = container.scrollTop;

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [disableThreshold, enableThreshold]);

  return { scrollRef, contentRef, scrollToBottom, isAtBottom };
}

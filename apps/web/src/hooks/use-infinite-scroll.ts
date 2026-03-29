import { useEffect, useRef } from "react";

type UseInfiniteScrollOptions = {
  /** Whether there are more pages to fetch */
  hasNextPage: boolean | undefined;
  /** Whether a page fetch is currently in progress */
  isFetchingNextPage: boolean;
  /** Function to fetch the next page */
  fetchNextPage: () => void;
  /** Scrollable container element — if null, uses the viewport */
  root?: HTMLElement | null;
  /** How far before the sentinel triggers (default: "200px") */
  rootMargin?: string;
};

/**
 * Reusable infinite scroll hook using IntersectionObserver.
 * Returns a ref to attach to a sentinel element at the bottom of a scrollable list.
 * When the sentinel enters the scroll container's viewport, fetchNextPage() fires.
 *
 * Usage:
 * ```tsx
 * const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
 * const sentinelRef = useInfiniteScroll({ hasNextPage, isFetchingNextPage, fetchNextPage, root: scrollEl });
 *
 * <div ref={setScrollEl} className="overflow-y-auto max-h-64">
 *   {items.map(...)}
 *   <div ref={sentinelRef} />
 * </div>
 * ```
 */
export function useInfiniteScroll({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  root,
  rootMargin = "200px",
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          fetchNextPage();
        }
      },
      { root: root ?? undefined, rootMargin },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, root, rootMargin]);

  return sentinelRef;
}

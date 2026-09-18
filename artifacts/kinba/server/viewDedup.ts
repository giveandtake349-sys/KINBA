const DEFAULT_WINDOW_MS = 60_000;

const recentViews = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of recentViews) {
    if (now - timestamp >= DEFAULT_WINDOW_MS) recentViews.delete(key);
  }
}, 60_000);

export function wasRecentlyViewed(ip: string, videoId: number): boolean {
  const key = `${ip}:${videoId}`;
  const now = Date.now();
  const lastView = recentViews.get(key);
  if (lastView !== undefined && now - lastView < DEFAULT_WINDOW_MS) {
    return true;
  }
  recentViews.set(key, now);
  return false;
}

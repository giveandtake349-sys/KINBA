/**
 * Public profile route parsing.
 *
 * The profile screen must always be keyed by the id in the URL: the moment a
 * member taps another account in Followers/Following the route becomes
 * `/profile/:id`, and nothing on that route is allowed to fall back to the
 * viewer's own profile snapshot (not while loading, not on a malformed id).
 *
 * Kept free of React/DOM imports so it can be unit-tested from the existing
 * server-side vitest suite.
 */

/** `/profile/123`, `/profile/123/`, `/profile/123?tab=x#y` → 123. */
export function parsePublicProfileRoute(location: string): number | undefined {
  const path = location.split(/[?#]/)[0] ?? location;
  const match = /^\/profile\/(\d+)\/?$/.exec(path);
  if (!match) return undefined;
  const userId = Number(match[1]);
  return Number.isInteger(userId) && userId > 0 ? userId : undefined;
}

/** `/@username` or `/@username/` → "username". */
export function parseUsernameProfileRoute(location: string): string | undefined {
  const path = location.split(/[?#]/)[0] ?? location;
  const match = /^\/@([A-Za-z0-9_]{3,64})\/?$/.exec(path);
  if (!match) return undefined;
  return match[1].toLowerCase();
}

/** True for any `/profile/<something>` or `/@username` route. */
export function isPublicProfileRoute(location: string): boolean {
  const path = location.split(/[?#]/)[0] ?? location;
  return (
    path !== "/profile/" && path.startsWith("/profile/") ||
    path.startsWith("/@") && path.length > 2
  );
}

/**
 * A cached `profile.byId` snapshot may only be rendered when its own
 * `user.id` matches the id in the route — otherwise it is treated as loading.
 */
export function matchesRouteProfile<T extends { user: { id: number } }>(
  snapshot: T | undefined,
  routeUserId: number | undefined
): snapshot is T {
  if (!snapshot || routeUserId === undefined) return false;
  return snapshot.user.id === routeUserId;
}

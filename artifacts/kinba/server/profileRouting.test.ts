import { describe, expect, it } from "vitest";
import {
  isPublicProfileRoute,
  matchesRouteProfile,
  parsePublicProfileRoute,
} from "../client/src/lib/profileRoute";

/**
 * Regression coverage for public profile routing (JHILIK UX-2).
 *
 * Tapping a row in Followers/Following navigates to `/profile/:id`, and the
 * profile screen may only render a snapshot whose own user.id is that id —
 * the viewer's own `profile.me` snapshot must never be able to substitute
 * for another account's page.
 */
describe("public profile route", () => {
  it("parses the selected user id out of the URL", () => {
    expect(parsePublicProfileRoute("/profile/123")).toBe(123);
    expect(parsePublicProfileRoute("/profile/123/")).toBe(123);
    expect(parsePublicProfileRoute("/profile/7?tab=posts")).toBe(7);
    expect(parsePublicProfileRoute("/profile/7#videos")).toBe(7);
  });

  it("never reports an id for non-public-profile routes", () => {
    expect(parsePublicProfileRoute("/profile")).toBeUndefined();
    expect(parsePublicProfileRoute("/profile/")).toBeUndefined();
    expect(parsePublicProfileRoute("/")).toBeUndefined();
    expect(parsePublicProfileRoute("/profile/abc")).toBeUndefined();
    expect(parsePublicProfileRoute("/profile/12abc")).toBeUndefined();
    expect(parsePublicProfileRoute("/videos")).toBeUndefined();
  });

  it("flags every /profile/:id location, even a malformed one", () => {
    expect(isPublicProfileRoute("/profile/123")).toBe(true);
    expect(isPublicProfileRoute("/profile/abc")).toBe(true);
    expect(isPublicProfileRoute("/profile")).toBe(false);
    expect(isPublicProfileRoute("/profile/")).toBe(false);
    expect(isPublicProfileRoute("/")).toBe(false);
  });

  it("only accepts a snapshot that belongs to the route id", () => {
    const ownProfile = { user: { id: 41 }, stats: { followersCount: 3 } };
    const otherProfile = { user: { id: 123 }, stats: { followersCount: 9 } };

    expect(matchesRouteProfile(otherProfile, 123)).toBe(true);
    expect(matchesRouteProfile(ownProfile, 123)).toBe(false);
    expect(matchesRouteProfile(ownProfile, undefined)).toBe(false);
    expect(matchesRouteProfile(undefined, 123)).toBe(false);
    expect(matchesRouteProfile(undefined, undefined)).toBe(false);
  });
});

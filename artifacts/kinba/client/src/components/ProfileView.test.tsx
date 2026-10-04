/**
 * Profile shell tests: the redesigned profile must show only real profile
 * data, expose every preserved action, and never advertise a section it
 * cannot load (Saved is owner-only). Every trpc call is stubbed.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  pending: {} as Record<string, boolean>,
  errors: {} as Record<string, boolean>,
  refetched: [] as string[],
}));

vi.mock("@/lib/trpc", () => {
  const makeProxy = (path: string[]): unknown => {
    const target = function () {};
    return new Proxy(target, {
      get: (_receiver, prop) => {
        if (typeof prop !== "symbol") {
          // The key is the procedure path, not the hook name.
          const key = prop === "useQuery" ? path.join(".") : [...path, prop].join(".");
          if (prop === "useQuery") {
            return () => ({
              data:
                state.pending[key] || state.errors[key]
                  ? undefined
                  : state.data[key],
              isPending: Boolean(state.pending[key]),
              isLoading: Boolean(state.pending[key]),
              isSuccess:
                !state.pending[key] &&
                !state.errors[key] &&
                state.data[key] !== undefined,
              isError: Boolean(state.errors[key]),
              error: state.errors[key] ? new Error("shelf failed") : null,
              refetch: () => {
                state.refetched.push(key);
              },
            });
          }
          if (prop === "useMutation") {
            return () => ({
              mutate: () => {},
              mutateAsync: async () => ({}),
              reset: () => {},
              isPending: false,
              isSuccess: false,
              error: null,
            });
          }
          if (prop === "useUtils") {
            return () => ({
              profile: {
                me: { invalidate: async () => {} },
                byId: { invalidate: async () => {} },
              },
              directMessages: {
                listConversations: { fetch: async () => [] },
              },
            });
          }
        }
        return makeProxy([...path, String(prop)]);
      },
    });
  };

  return {
    trpc: new Proxy({} as Record<string, unknown>, {
      get: (_receiver, prop) => makeProxy([String(prop)]),
    }),
  };
});

import ProfileView, { type ProfileSnapshot } from "./ProfileView";

// FollowListModal (always mounted, closed) reads the auth hook on render.
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user_1", username: "ava" },
    loading: false,
    error: null,
    isAuthenticated: true,
    session: { access_token: "x" },
    authDialogOpen: false,
    openAuth: () => {},
    closeAuth: () => {},
    refresh: () => {},
    logout: async () => {},
    unauthenticatedError: false,
  }),
}));

type ProfileProps = ComponentProps<typeof ProfileView>;

function snapshot(overrides: {
  verified?: boolean;
  verificationStatus?: string;
  createdAt?: string;
  accountType?: "member" | "creator" | "company";
} = {}): ProfileSnapshot {
  return {
    user: { id: 7, name: "Ava Rahman", createdAt: overrides.createdAt ?? "2024-03-14T00:00:00.000Z" },
    profile: {
      username: "ava",
      photoUrl: null,
      isVerified: overrides.verified ?? false,
      verificationStatus: overrides.verificationStatus ?? null,
      accountType: overrides.accountType ?? "member",
      about: "Filmmaker in Dhaka.\nWeekly shorts.",
    },
    stats: {
      reactionsReceived: 1284,
      iconsCount: 42,
      followingCount: 18,
      followersCount: 309,
    },
  };
}

function video(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 11,
    title: "Rooftop light study",
    description: "",
    videoUrl: "/media/11.m3u8",
    thumbnailUrl: "/media/11.jpg",
    mediaType: "IMAGE",
    kind: "LONG",
    processingStatus: "READY",
    durationSeconds: 0,
    width: 1080,
    height: 1080,
    sources: [],
    createdAt: "2025-01-02T00:00:00.000Z",
    viewCount: 204,
    reactionCount: 12,
    commentCount: 3,
    shareCount: 1,
    viewerReacted: false,
    viewerShared: false,
    bookmarkCount: 0,
    viewerBookmarked: false,
    owner: {
      id: 7,
      name: "Ava Rahman",
      username: "ava",
      photoUrl: null,
      accountType: "member",
      isVerified: false,
    },
    ...overrides,
  };
}

function renderProfile(props: Partial<ProfileProps> = {}) {
  const base: ProfileProps = {
    profile: snapshot(),
    isOwner: true,
    isAuthenticated: true,
    isAdmin: false,
    userId: undefined,
    onBack: () => {},
  };
  return render(<ProfileView {...base} {...props} />);
}

beforeAll(() => {
  // jsdom ships neither matchMedia nor element scrolling, all of which the
  // tab strip touches.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  window.Element.prototype.scrollTo ??= function scrollTo() {};
  window.Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

afterEach(() => {
  cleanup();
  state.data = {};
  state.pending = {};
  state.errors = {};
  state.refetched = [];
});

describe("ProfileView", () => {
  it("renders the owner header from real profile data", () => {
    state.data = {
      "profile.videos": [video()],
      "profile.videosById": [],
      "videos.bookmarked": [video({ id: 12, title: "Saved clip" })],
    };
    const { container } = renderProfile();

    const heading = screen.getByRole("heading", { name: /Ava Rahman/ });
    expect(heading.textContent).toContain("Ava Rahman");
    expect(screen.getByText("@ava")).toBeTruthy();
    expect(screen.getByText(/Filmmaker in Dhaka\./)).toBeTruthy();
    expect(screen.getByText("Joined March 2024")).toBeTruthy();

    for (const label of ["Icons", "Followers", "Following", "Pookies"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("309")).toBeTruthy();

    expect(screen.getByRole("button", { name: "Edit Profile" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    // No verification badge unless the profile really carries one.
    expect(container.querySelector(".pr-verified-badge")).toBeNull();
  });

  it("shows the verification badge only for a genuinely verified profile", () => {
    state.data = { "profile.videos": [], "videos.bookmarked": [] };
    const { container, rerender } = renderProfile({
      profile: snapshot({ verificationStatus: "verified" }),
    });
    expect(container.querySelector(".pr-verified-badge")).toBeTruthy();

    const base: ProfileProps = {
      isOwner: true,
      isAuthenticated: true,
      isAdmin: false,
      onBack: () => {},
    };
    rerender(
      <ProfileView {...base} profile={snapshot({ verificationStatus: "pending" })} />
    );
    expect(container.querySelector(".pr-verified-badge")).toBeNull();

    rerender(<ProfileView {...base} profile={snapshot({ verified: true })} />);
    expect(container.querySelector(".pr-verified-badge")).toBeTruthy();
  });

  it("keeps Saved owner-only and shows the visitor action set", () => {
    state.data = { "profile.videosById": [], "profile.followState": { following: false } };
    renderProfile({ isOwner: false, userId: 42 });

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map(tab => tab.textContent)).toEqual(["Posts", "Videos", "Shorts"]);

    expect(screen.getByRole("button", { name: "Follow" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Message/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();
    expect(screen.getByRole("button", { name: "Share profile" })).toBeTruthy();
  });

  it("gives a signed-out visitor only the share and overflow controls", () => {
    state.data = { "profile.videosById": [] };
    renderProfile({ isOwner: false, isAuthenticated: false, userId: 42 });

    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Message/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();
    expect(screen.getByRole("button", { name: "Share profile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More options" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("wires each tab to its panel with accessible ids", () => {
    state.data = { "profile.videos": [], "videos.bookmarked": [] };
    const { container } = renderProfile();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    const selected = tabs.filter(tab => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);

    for (const tab of tabs) {
      const controlled = tab.getAttribute("aria-controls");
      expect(controlled).toBeTruthy();
      const panel = document.getElementById(controlled as string);
      expect(panel).toBeTruthy();
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
      expect(controlled).toBe(`profile-panel-${tab.id.replace(/^profile-tab-/, "")}`);
    }

    // Roving tabindex: exactly one tab sits in the tab order, the selected one.
    const focusable = tabs.filter(tab => tab.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);
    expect(focusable[0]).toBe(selected[0]);
    expect(
      tabs.filter(tab => tab.getAttribute("tabindex") === "-1")
    ).toHaveLength(tabs.length - 1);
  });

  it("never claims content the viewer cannot see", () => {
    state.data = { "profile.videosById": [], "profile.followState": { following: false } };
    const { container } = renderProfile({ isOwner: false, userId: 42 });

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/pookied content/i);
    expect(text).not.toMatch(/haven't posted any (posts|videos|shorts|saved) yet/i);
    expect(screen.getAllByText("No posts to show yet.")).toBeTruthy();
    expect(screen.queryByText(/Saved/)).toBeNull();
  });

  it("renders real content tiles for the owner", () => {
    state.data = { "profile.videos": [video()], "videos.bookmarked": [] };
    const { container } = renderProfile();

    const tiles = container.querySelectorAll(".pr-tile");
    expect(tiles).toHaveLength(1);
    expect(tiles[0].textContent).toContain("Rooftop light study");
  });

  it("keeps a post at its real aspect ratio instead of forcing a square", () => {
    state.data = {
      "profile.videos": [video({ width: 1200, height: 1600, title: "Portrait study" })],
      "videos.bookmarked": [],
    };
    const { container } = renderProfile();

    const posts = container.querySelector("#profile-panel-posts");
    expect(posts?.querySelector(".pr-tile")?.classList.contains("pr-tile--post")).toBe(true);
    const media = posts?.querySelector(".pr-tile-media");
    expect(media?.getAttribute("style")).toContain("aspect-ratio: 1200 / 1600");
    // The photo keeps its own frame; nothing rewrites it to 1:1.
    expect(posts?.querySelector(".pr-tile-media")?.getAttribute("style")).not.toContain("1 / 1");
  });

  it("shows only eligible READY videos in the Videos shelf", () => {
    state.data = {
      "profile.videos": [
        video({
          id: 21,
          mediaType: "VIDEO",
          kind: "LONG",
          processingStatus: "READY",
          title: "Ready clip",
          width: 1920,
          height: 1080,
        }),
        video({
          id: 22,
          mediaType: "VIDEO",
          kind: "LONG",
          processingStatus: "PROCESSING",
          title: "Still encoding",
        }),
        video({
          id: 23,
          mediaType: "VIDEO",
          kind: "LONG",
          processingStatus: "FAILED",
          title: "Broken upload",
        }),
      ],
      "videos.bookmarked": [],
    };
    const { container } = renderProfile();

    const videos = container.querySelector("#profile-panel-videos");
    expect(videos?.querySelectorAll(".pr-tile")).toHaveLength(1);
    expect(videos?.textContent).toContain("Ready clip");
    // Processing or failed media never appears as playable content anywhere.
    expect(container.textContent).not.toContain("Still encoding");
    expect(container.textContent).not.toContain("Broken upload");
  });

  it("keeps Shorts on their own shelf without repeating them", () => {
    state.data = {
      "profile.videos": [
        video({
          id: 31,
          mediaType: "VIDEO",
          kind: "SHORT",
          processingStatus: "READY",
          title: "Short one",
          width: 1080,
          height: 1920,
        }),
        video({
          id: 32,
          mediaType: "VIDEO",
          kind: "SHORT",
          processingStatus: "READY",
          title: "Short two",
          width: 1080,
          height: 1920,
        }),
        video({
          id: 33,
          mediaType: "VIDEO",
          kind: "LONG",
          processingStatus: "READY",
          title: "Long one",
          width: 1920,
          height: 1080,
        }),
        video({ id: 34, mediaType: "IMAGE", title: "Photo one", width: 1000, height: 750 }),
      ],
      "videos.bookmarked": [],
    };
    // Home always hands the shelf its openers; without them a tile stays static.
    const { container } = renderProfile({
      onOpenPhoto: vi.fn(),
      onOpenVideo: vi.fn(),
      onOpenShort: vi.fn(),
    });

    const shorts = container.querySelector("#profile-panel-shorts");
    const shortTiles = shorts ? [...shorts.querySelectorAll(".pr-tile")] : [];
    expect(shortTiles).toHaveLength(2);
    expect(new Set(shortTiles.map(tile => tile.getAttribute("aria-label"))).size).toBe(2);
    // Every Short keeps its 9:16 frame and its own variant class.
    for (const tile of shortTiles) {
      expect(tile.classList.contains("pr-tile--short")).toBe(true);
      const style = tile.querySelector(".pr-tile-media")?.getAttribute("style") ?? "";
      expect(style).toContain("1080 / 1920");
    }

    const videos = container.querySelector("#profile-panel-videos");
    expect(videos?.querySelectorAll(".pr-tile")).toHaveLength(1);
    expect(videos?.textContent).toContain("Long one");
    expect(videos?.textContent).not.toContain("Short one");

    const posts = container.querySelector("#profile-panel-posts");
    expect(posts?.querySelectorAll(".pr-tile")).toHaveLength(1);
    expect(posts?.textContent).toContain("Photo one");
  });

  it("never exposes the owner's Saved shelf to a visitor", () => {
    state.data = {
      "profile.videosById": [],
      "profile.followState": { following: false },
      "videos.bookmarked": [video({ id: 41, title: "Private bookmark" })],
    };
    renderProfile({ isOwner: false, userId: 42 });

    expect(document.getElementById("profile-panel-saved")).toBeNull();
    expect(screen.queryByText("Private bookmark")).toBeNull();
    expect(
      screen.getAllByRole("tab").map(tab => tab.textContent)
    ).not.toContain("Saved");
  });

  it("keeps every empty shelf honest and free of invented content", () => {
    state.data = { "profile.videos": [], "videos.bookmarked": [] };
    const { container } = renderProfile();

    expect(container.querySelectorAll(".pr-tile")).toHaveLength(0);
    for (const title of ["No posts yet", "No videos yet", "No shorts yet", "Nothing saved yet"]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/lorem ipsum|placeholder|sample post|coming soon/i);
  });

  it("shapes the loading state like the shelf it stands in for", () => {
    state.pending = { "profile.videos": true };
    state.data = { "videos.bookmarked": [] };
    const { container } = renderProfile();

    const posts = container.querySelector("#profile-panel-posts");
    expect(posts?.getAttribute("aria-busy")).toBe("true");
    expect((posts?.querySelectorAll(".pr-skeleton-tile") ?? []).length).toBeGreaterThan(0);
    expect(container.querySelector("#profile-panel-shorts")?.getAttribute("aria-busy")).toBe("true");
    // Saved resolves from its own query, so it is already showing real state.
    expect(container.querySelector("#profile-panel-saved")?.getAttribute("aria-busy")).toBe("false");
  });

  it("offers a real retry when a shelf fails to load", () => {
    state.errors = { "profile.videos": true };
    state.data = { "videos.bookmarked": [] };
    const { container } = renderProfile();

    expect(container.querySelector(".pr-grid--posts")).toBeNull();
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].textContent).toMatch(/try again/i);

    fireEvent.click(screen.getAllByRole("button", { name: /try again/i })[0]);
    expect(state.refetched).toContain("profile.videos");
  });
});

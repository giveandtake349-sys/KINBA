/**
 * Profile shell tests: the redesigned profile must show only real profile
 * data, expose every preserved action, and never advertise a section it
 * cannot load (Saved is owner-only). Every trpc call is stubbed.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
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
              data: state.data[key],
              isPending: false,
              isLoading: false,
              isSuccess: state.data[key] !== undefined,
              isError: false,
              error: null,
              refetch: () => {},
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
});

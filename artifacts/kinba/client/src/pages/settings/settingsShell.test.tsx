/**
 * Shell smoke tests: the Account Center must mount, list its categories and
 * honour a deep-linked section without throwing. Every trpc call is stubbed,
 * so these tests only prove wiring (routing, providers, pane selection).
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SupabaseAuthProvider } from "@/contexts/SupabaseAuthContext";

vi.mock("@/lib/trpc", () => {
  const hookResult = {
    data: undefined,
    isPending: false,
    isLoading: false,
    isSuccess: false,
    error: null,
    refetch: () => {},
  };
  const callable = function proc(): unknown {
    return callable;
  };
  const procedure = new Proxy(callable, {
    get: (_target, prop) => {
      if (prop === "useQuery" || prop === "useSuspenseQuery") {
        return () => hookResult;
      }
      if (prop === "useMutation") {
        return () => ({
          mutate: () => {},
          mutateAsync: async () => ({}),
          isPending: false,
          isSuccess: false,
          error: null,
        });
      }
      return procedure;
    },
  });
  return {
    trpc: new Proxy({} as Record<string, unknown>, {
      get: () => procedure,
    }),
  };
});

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user_1", username: "tester" },
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

import Settings from "./Settings";

function renderSettings(path: string) {
  window.history.pushState({}, "", path);
  return render(
    <ThemeProvider defaultTheme="dark" switchable>
      <SupabaseAuthProvider>
        <Settings />
      </SupabaseAuthProvider>
    </ThemeProvider>
  );
}

beforeAll(() => {
  // jsdom does not implement matchMedia, which the theme provider probes.
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

  // This jsdom config exposes no Storage; the theme provider reads it on
  // mount, so hand it an in-memory implementation.
  if (!window.localStorage) {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() {
          return store.size;
        },
      },
    });
  }
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("Settings shell", () => {
  it("lists every Account Center category on the index view", () => {
    renderSettings("/settings");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    const nav = screen.getByRole("navigation", {
      name: "Settings categories",
    });
    expect(nav.querySelectorAll("button")).toHaveLength(9);
    for (const label of [
      "Account",
      "Privacy",
      "Security",
      "Notifications",
      "Messaging",
      "Content",
      "Appearance",
      "Data",
      "Help",
    ]) {
      expect(nav.textContent).toContain(label);
    }
  });

  it("deep-links a category and marks it current", () => {
    renderSettings("/settings/notifications");
    expect(screen.getByRole("region", { name: "Notifications" })).toBeTruthy();
    const nav = screen.getByRole("navigation", {
      name: "Settings categories",
    });
    const current = Array.from(nav.querySelectorAll("button")).filter(
      button => button.getAttribute("aria-current") === "page"
    );
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Notifications");
    expect(screen.getByRole("button", { name: /All settings/ })).toBeTruthy();
  });

  it("falls back to the account pane for an unknown section", () => {
    renderSettings("/settings/definitely-not-a-section");
    expect(screen.getByRole("region", { name: "Account" })).toBeTruthy();
  });
});

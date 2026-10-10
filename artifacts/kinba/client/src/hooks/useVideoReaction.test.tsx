import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoReaction } from "@/hooks/useVideoReaction";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  isAuthenticated: true,
  openAuth: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 7 },
    isAuthenticated: mocks.isAuthenticated,
    loading: false,
    error: null,
    openAuth: mocks.openAuth,
  }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      home: { feed: { invalidate: mocks.invalidate } },
      videos: { list: { invalidate: mocks.invalidate } },
    }),
    videos: {
      react: {
        useMutation: () => ({
          mutateAsync: mocks.mutateAsync,
          isPending: false,
        }),
      },
    },
  },
}));

const target = {
  id: 99,
  reactionCount: 10,
  viewerReacted: false,
  viewerReaction: null,
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useVideoReaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthenticated = true;
    mocks.mutateAsync.mockResolvedValue({ viewerReacted: true });
  });

  it("sends the single Pookie/Love reaction on a tap when nothing is active", async () => {
    const { result } = renderHook(() => useVideoReaction(target));
    act(() => {
      result.current.react();
    });
    await flush();

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      videoId: 99,
      reaction: "love",
    });
    expect(result.current.state).toEqual({
      reactionCount: 11,
      viewerReacted: true,
      viewerReaction: "love",
    });
    expect(result.current.pending).toBe(false);
  });

  it("sends the active reaction on a tap so the server removes it", async () => {
    mocks.mutateAsync.mockResolvedValue({ viewerReacted: false });
    const { result } = renderHook(() =>
      useVideoReaction({
        ...target,
        viewerReacted: true,
        viewerReaction: "love",
      })
    );

    act(() => {
      result.current.react();
    });
    await flush();

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      videoId: 99,
      reaction: "love",
    });
    expect(result.current.state).toEqual({
      reactionCount: 9,
      viewerReacted: false,
      viewerReaction: null,
    });
  });

  it("selecting the single reaction type sends it", async () => {
    const { result } = renderHook(() => useVideoReaction(target));
    act(() => {
      result.current.select("love");
    });
    await flush();

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      videoId: 99,
      reaction: "love",
    });
  });

  it("normalizes a legacy active row to the single reaction without moving the total", async () => {
    const { result } = renderHook(() =>
      useVideoReaction({
        ...target,
        viewerReacted: true,
        viewerReaction: "like",
      })
    );

    act(() => {
      result.current.select("love");
    });
    await flush();

    expect(result.current.state).toEqual({
      reactionCount: 10,
      viewerReacted: true,
      viewerReaction: "love",
    });
  });

  it("asks for sign-in instead of mutating for a signed-out viewer", async () => {
    mocks.isAuthenticated = false;
    const { result } = renderHook(() => useVideoReaction(target));
    act(() => {
      result.current.react();
    });
    await flush();

    expect(mocks.openAuth).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(result.current.state.viewerReacted).toBe(false);
  });

  it("reverts the optimistic state and reports a failed mutation", async () => {
    const onError = vi.fn();
    mocks.mutateAsync.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() =>
      useVideoReaction(target, { onError })
    );

    act(() => {
      result.current.react();
    });
    await flush();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(result.current.state).toEqual({
      reactionCount: 10,
      viewerReacted: false,
      viewerReaction: null,
    });
    expect(result.current.pending).toBe(false);
  });

  it("invalidates the feeds once the server answers", async () => {
    const { result } = renderHook(() => useVideoReaction(target));
    act(() => {
      result.current.react();
    });
    await flush();

    expect(mocks.invalidate).toHaveBeenCalled();
  });
});

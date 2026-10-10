import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_THRESHOLD_MS } from "@/hooks/useLongPress";
import type { MemberRow, MessageRow } from "./shared";
import { MessageCard } from "./MessageCard";

const mocks = vi.hoisted(() => ({
  reactors: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      hypeRooms: { messageReactors: { fetch: mocks.reactors } },
    }),
  },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    loading: false,
    error: null,
    openAuth: vi.fn(),
  }),
}));

const row: MessageRow = {
  message: {
    id: 31,
    roomId: 5,
    userId: 7,
    body: "hello room",
    parentId: null,
    pinned: false,
    createdAt: new Date("2026-01-01T10:00:00Z"),
  },
  user: {
    id: 7,
    name: "Asha",
    openId: "ash",
    photoUrl: null,
    username: "asha",
  },
  reactions: [
    { reaction: "fire", count: 4, reactedByMe: true },
    { reaction: "clap", count: 2, reactedByMe: false },
  ],
};

const members: MemberRow[] = [];

function renderCard(overrides: Partial<Parameters<typeof MessageCard>[0]> = {}) {
  const onReact = vi.fn();
  render(
    <MessageCard
      row={row}
      members={members}
      hostId={9}
      viewerId={7}
      isHostViewer={false}
      isActiveMember
      canReply
      isPinned={false}
      replyCount={0}
      selected={false}
      busy={false}
      onSelect={vi.fn()}
      onReply={vi.fn()}
      onReact={onReact}
      {...overrides}
    />
  );
  return { onReact };
}

describe("MessageCard reactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reactors.mockResolvedValue({
      reactors: [],
      hasMore: false,
      offset: 0,
      limit: 50,
      viewerReactions: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes every stored row to the single Pookie reaction", () => {
    renderCard();
    // Legacy fire/clap rows still count toward the one reaction (6 total).
    const pill = screen.getByRole("button", { name: "6 reactions" });
    expect(pill.textContent).toBe("❤️6");
    const chip = screen.getByRole("button", { name: "Remove Pookie reaction" });
    expect(chip.textContent).toBe("❤️6");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.queryByRole("button", { name: "React with Fire" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "React with Clap" })
    ).toBeNull();
    expect(screen.queryByRole("menu", { name: "Reaction tray" })).toBeNull();
  });

  it("tapping the pill opens the reactor list instead of reacting", () => {
    const { onReact } = renderCard({ roomId: 5 });
    fireEvent.click(screen.getByRole("button", { name: "See who reacted" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onReact).not.toHaveBeenCalled();
  });

  it("the chip toggles the single reaction directly", () => {
    const { onReact } = renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Pookie reaction" })
    );
    expect(onReact).toHaveBeenCalledWith("love");
  });

  it("long-pressing the reaction zone opens the reactor list without tapping", () => {
    vi.useFakeTimers();
    const { onReact } = renderCard({ roomId: 5 });
    const zone = document.querySelector(".hype-room-reactions")!;

    fireEvent.pointerDown(zone, {
      pointerId: 3,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 30,
      clientY: 40,
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS + 10);
    });

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onReact).not.toHaveBeenCalled();

    fireEvent.pointerUp(zone, {
      pointerId: 3,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: 30,
      clientY: 40,
    });
    fireEvent.click(zone);
    expect(onReact).not.toHaveBeenCalled();
  });

  it("loads the reactors for this message when the list opens", async () => {
    renderCard({ roomId: 5 });
    fireEvent.click(screen.getByRole("button", { name: "See who reacted" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    await waitFor(() =>
      expect(mocks.reactors).toHaveBeenCalledWith({
        roomId: 5,
        messageId: 31,
        limit: 50,
        offset: 0,
      })
    );
  });

  it("offers no reactor entry point without a room", () => {
    const { onReact } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "6 reactions" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onReact).not.toHaveBeenCalled();
  });

  it("disables the pill and the chip for a viewer who cannot react", () => {
    renderCard({ isActiveMember: false });
    expect(
      (screen.getByRole("button", { name: "6 reactions" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    const chip = screen.getByRole("button", {
      name: "Remove Pookie reaction",
    }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
  });
});

describe("MessageCard host moderation", () => {
  function openMenu(overrides: Partial<Parameters<typeof MessageCard>[0]> = {}) {
    renderCard({ isHostViewer: true, viewerId: 9, ...overrides });
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
  }

  it("offers Hide message to the host on someone else's message", () => {
    const onHide = vi.fn();
    openMenu({ onHide });

    const item = screen.getByRole("menuitem", { name: "Hide message" });
    fireEvent.click(item);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("never offers Hide message on the host's own message", () => {
    openMenu({ viewerId: 7, onHide: vi.fn() });
    expect(
      screen.queryByRole("menuitem", { name: "Hide message" })
    ).toBeNull();
  });

  it("never offers Hide message to a viewer who is not the host", () => {
    openMenu({ isHostViewer: false, onHide: vi.fn() });
    expect(
      screen.queryByRole("menuitem", { name: "Hide message" })
    ).toBeNull();
  });
});

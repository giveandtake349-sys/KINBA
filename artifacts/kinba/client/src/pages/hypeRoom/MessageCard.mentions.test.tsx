import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberRow, MessageRow } from "./shared";
import { MessageCard } from "./MessageCard";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  reactors: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/rooms/5", mocks.navigate],
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

function buildRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    message: {
      id: 41,
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
    reactions: [],
    ...overrides,
  };
}

const members: MemberRow[] = [
  {
    membership: {
      id: 210,
      roomId: 5,
      userId: 21,
      role: "audience",
      joinedAt: new Date("2026-01-01T00:00:00Z"),
      leftAt: null,
      bannedAt: null,
      removedBy: null,
    },
    user: {
      id: 21,
      name: "Alice Wonder",
      openId: "open-21",
      photoUrl: null,
      username: "alice",
    },
  },
];

function renderCard(row: MessageRow) {
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
      onReact={vi.fn()}
    />
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("MessageCard mentions", () => {
  it("renders @mentions in the body as profile links", () => {
    renderCard(buildRow({ message: { ...buildRow().message, body: "hey @alice" } }));
    const link = screen.getByRole("link", { name: "@alice" });
    expect(link.getAttribute("href")).toBe("/@alice");
  });

  it("navigates SPA-style when a body mention is tapped", () => {
    renderCard(buildRow({ message: { ...buildRow().message, body: "hey @alice" } }));
    fireEvent.click(screen.getByRole("link", { name: "@alice" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/@alice");
  });

  it("does not linkify emails in the body", () => {
    renderCard(
      buildRow({
        message: { ...buildRow().message, body: "mail foo@example.com" },
      })
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders mention chips as links to the member's real profile id", () => {
    renderCard(
      buildRow({
        message: { ...buildRow().message, body: "for you" },
        mentionUserIds: [21],
      })
    );
    const link = screen.getByRole("link", { name: "@alice" });
    expect(link.getAttribute("href")).toBe("/profile/21");
  });

  it("navigates SPA-style when a mention chip is tapped", () => {
    renderCard(
      buildRow({
        message: { ...buildRow().message, body: "for you" },
        mentionUserIds: [21],
      })
    );
    fireEvent.click(screen.getByRole("link", { name: "@alice" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/profile/21");
  });

  it("keeps the single Pookie reaction chip intact", () => {
    renderCard(buildRow());
    expect(
      screen.getByRole("button", { name: "React with Pookie" })
    ).toBeTruthy();
  });
});

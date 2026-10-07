/**
 * DM per-message actions (v1) — copy / reply / edit / delete wiring.
 *
 * Drives the real MessageDetail page: long-press/right-click opens the
 * contextual menu, each entry runs its action, the inline editor saves through
 * the trpc mutation, a reply attaches replyToId to the send payload, and a
 * soft-deleted row renders a tombstone with no actions at all.
 *
 * The client only hides options — ownership, the 30-minute edit window and the
 * soft-delete guard are enforced by the server (see server/directMessages.test.ts).
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(async () => undefined),
  listMessagesData: [] as unknown[],
  markReadMutate: vi.fn(async () => ({})),
  sendMessageMutate: vi.fn(async (input: Record<string, unknown>) => ({
    id: 940,
    ...input,
  })),
  editMutate: vi.fn(async () => ({})),
  deleteMutate: vi.fn(async () => ({})),
  writeText: vi.fn(async (_text: string) => undefined),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/messages/12", vi.fn()],
  useParams: () => ({ id: "12" }),
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: 1 },
    session: { access_token: "test-token" },
    loading: false,
    error: null,
    openAuth: vi.fn(),
  }),
}));

vi.mock("@/components/MediaHub", () => ({
  FeedPhotoLightbox: () => null,
}));

vi.mock("@/lib/trpc", () => {
  const mutation = <T,>(run: (input?: unknown) => Promise<T>) => ({
    mutate: (input?: unknown) => run(input),
    mutateAsync: run,
    isPending: false,
  });
  return {
    trpc: {
      useUtils: () => ({
        directMessages: {
          listMessages: { invalidate: mocks.invalidate },
          listConversations: { invalidate: mocks.invalidate },
          getUnreadMessageCount: { invalidate: mocks.invalidate },
        },
      }),
      directMessages: {
        listMessages: {
          useQuery: () => ({
            data: mocks.listMessagesData,
            isPending: false,
            isError: false,
          }),
        },
        markConversationRead: {
          useMutation: () => mutation(mocks.markReadMutate),
        },
        sendMessage: {
          useMutation: () => mutation(mocks.sendMessageMutate),
        },
        blockConversation: {
          useMutation: () => mutation(async () => ({})),
        },
        editMessage: {
          useMutation: () => mutation(mocks.editMutate),
        },
        deleteMessage: {
          useMutation: () => mutation(mocks.deleteMutate),
        },
      },
    },
  };
});

import MessageDetail from "./MessageDetail";

type Over = Partial<Record<string, unknown>>;

function makeMessage(
  id: number,
  senderId: number,
  body: string,
  over: Over = {}
) {
  return {
    id,
    conversationId: 12,
    senderId,
    body,
    mediaUrl: null,
    mediaType: null,
    mediaWidth: null,
    mediaHeight: null,
    mediaDuration: null,
    idempotencyKey: `key-${id}`,
    createdAt: new Date(Date.now() - 60 * 1000),
    readAt: null,
    editedAt: null,
    deletedAt: null,
    replyToId: null,
    sender: {
      id: senderId,
      name: `User ${senderId}`,
      username: `user${senderId}`,
      photoUrl: null,
    },
    replyTo: null,
    ...over,
  };
}

function bubbleOf(id: number): HTMLElement {
  const element = document.querySelector(`[data-message-id="${id}"]`);
  expect(element, `message ${id} should be rendered`).toBeTruthy();
  return element as HTMLElement;
}

function openMenu(id: number): void {
  fireEvent.contextMenu(bubbleOf(id));
  expect(screen.getByRole("menu")).toBeTruthy();
}

function menuItemNames(): string[] {
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map(item => item.textContent ?? "");
}

/** Elements that scrollIntoView was invoked on (records the `this` binding). */
const jumpTargets: Element[] = [];
const scrollIntoView = vi.fn(function (this: Element) {
  jumpTargets.push(this);
});

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: scrollIntoView,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mocks.writeText },
    writable: true,
    configurable: true,
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  jumpTargets.length = 0;
  mocks.listMessagesData = [
    makeMessage(930, 1, "Mine"),
    makeMessage(929, 2, "Theirs"),
  ];
});

describe("DM message actions", () => {
  it("offers copy/reply/edit/delete on own messages and only copy/reply on others", async () => {
    render(<MessageDetail />);
    expect(await screen.findByText("Mine")).toBeTruthy();

    openMenu(930);
    expect(menuItemNames()).toEqual(["Copy", "Reply", "Edit", "Delete"]);

    // Any interaction outside the menu dismisses it.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    openMenu(929);
    expect(menuItemNames()).toEqual(["Copy", "Reply"]);
  });

  it("copies the message body to the clipboard", async () => {
    render(<MessageDetail />);
    await screen.findByText("Mine");

    openMenu(930);
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Copy" })
    );

    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith("Mine"));
    expect(mocks.deleteMutate).not.toHaveBeenCalled();
    expect(mocks.editMutate).not.toHaveBeenCalled();
  });

  it("deletes an own message only after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm");
    confirm.mockReturnValueOnce(false);
    render(<MessageDetail />);
    await screen.findByText("Mine");

    openMenu(930);
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete" })
    );
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(mocks.deleteMutate).not.toHaveBeenCalled();

    openMenu(930);
    confirm.mockReturnValueOnce(true);
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete" })
    );
    await waitFor(() =>
      expect(mocks.deleteMutate).toHaveBeenCalledWith({ messageId: 930 })
    );
  });

  it("edits an own message through the inline editor", async () => {
    render(<MessageDetail />);
    await screen.findByText("Mine");

    openMenu(930);
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Edit" })
    );

    const editor = screen.getByLabelText("Edit message") as HTMLTextAreaElement;
    expect(editor.value).toBe("Mine");

    fireEvent.change(editor, { target: { value: "  Edited copy  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.editMutate).toHaveBeenCalledWith({
        messageId: 930,
        body: "Edited copy",
      })
    );
    expect(mocks.deleteMutate).not.toHaveBeenCalled();
  });

  it("cancels an edit without calling the server", async () => {
    render(<MessageDetail />);
    await screen.findByText("Mine");

    openMenu(930);
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Edit" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Edit message")).toBeNull();
    expect(mocks.editMutate).not.toHaveBeenCalled();
  });

  it("replies with a quote strip and sends replyToId", async () => {
    render(<MessageDetail />);
    await screen.findByText("Theirs");

    openMenu(929);
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Reply" })
    );

    expect(screen.getByText("Replying to")).toBeTruthy();
    expect(screen.getByText(/User 2: Theirs/)).toBeTruthy();

    const input = screen.getByLabelText("Message input");
    fireEvent.change(input, { target: { value: "Answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(mocks.sendMessageMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 12,
          body: "Answer",
          replyToId: 929,
        })
      )
    );
  });

  it("clears the reply strip without sending", async () => {
    render(<MessageDetail />);
    await screen.findByText("Theirs");

    openMenu(929);
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", { name: "Reply" })
    );
    expect(screen.getByText("Replying to")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Cancel reply"));
    expect(screen.queryByText("Replying to")).toBeNull();
    expect(mocks.sendMessageMutate).not.toHaveBeenCalled();
  });

  it("jumps to the quoted parent when its reply is tapped", async () => {
    mocks.listMessagesData = [
      makeMessage(930, 1, "Answer", {
        replyToId: 929,
        replyTo: {
          id: 929,
          conversationId: 12,
          senderId: 2,
          sender: { id: 2, name: "User 2", username: "user2", photoUrl: null },
          body: "Original message",
          mediaType: null,
          createdAt: new Date(Date.now() - 60 * 1000),
          deletedAt: null,
        },
      }),
      makeMessage(929, 2, "Original message"),
    ];
    render(<MessageDetail />);
    await screen.findByText("Answer");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Jump to the message being replied to",
      })
    );

    expect(scrollIntoView).toHaveBeenCalled();
    // The thread auto-scroll also records a call — pick the message element.
    expect(
      jumpTargets.find(
        (element: Element) =>
          element instanceof HTMLElement && element.dataset.messageId === "929"
      )
    ).toBe(bubbleOf(929));
  });

  it("marks an edited message and hides a soft-deleted one behind a tombstone", async () => {
    mocks.listMessagesData = [
      makeMessage(930, 1, "Rewritten", { editedAt: new Date() }),
      makeMessage(928, 2, "Secret", { deletedAt: new Date() }),
    ];
    render(<MessageDetail />);

    expect(await screen.findByText("Rewritten")).toBeTruthy();
    expect(screen.getByText("edited")).toBeTruthy();
    expect(screen.getByText("Message deleted")).toBeTruthy();
    expect(screen.queryByText("Secret")).toBeNull();

    const deleted = bubbleOf(928);
    expect(deleted.querySelector('[aria-label="Message actions"]')).toBeNull();
    fireEvent.contextMenu(deleted);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows a deleted parent as deleted inside the quote", async () => {
    mocks.listMessagesData = [
      makeMessage(930, 1, "Answer", {
        replyToId: 928,
        replyTo: {
          id: 928,
          conversationId: 12,
          senderId: 2,
          sender: { id: 2, name: "User 2", username: "user2", photoUrl: null },
          body: null,
          mediaType: null,
          createdAt: new Date(Date.now() - 60 * 1000),
          deletedAt: new Date(),
        },
      }),
    ];
    render(<MessageDetail />);

    expect(await screen.findByText("Answer")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Jump to the message being replied to",
      })
    ).toBeTruthy();
    expect(screen.getByText("Message deleted")).toBeTruthy();
  });
});

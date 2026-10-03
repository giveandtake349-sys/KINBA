/**
 * DM attachment picker wiring — runtime regression tests.
 *
 * Locks the real click path on a rendered page (not the menu component in
 * isolation):
 *
 *   Photos / Video / Document → the matching always-mounted
 *   `<input type="file">` gets a programmatic click → the chooser opens →
 *   `onChange` → pending chip → upload → ready.
 *
 * Two production bugs are pinned here:
 *  1. the inputs used to carry the `hidden` attribute (`display:none`), which
 *     mobile browsers / WebView ignore for programmatic `.click()`, so the OS
 *     chooser never opened;
 *  2. `input.value` used to be cleared before the files were snapshotted,
 *     which empties the input's live FileList and silently drops the
 *     selection (no chip, no upload).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(async () => undefined),
  sendMessageMutate: vi.fn(async (input: Record<string, unknown>) => ({
    id: 42,
    ...input,
  })),
  mutationMutate: vi.fn(async () => ({})),
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

vi.mock("@/lib/trpc", () => ({
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
        useQuery: () => ({ data: [], isPending: false, isError: false }),
      },
      markConversationRead: {
        useMutation: () => ({ mutateAsync: mocks.mutationMutate }),
      },
      sendMessage: {
        useMutation: () => ({ mutateAsync: mocks.sendMessageMutate }),
      },
      blockConversation: {
        useMutation: () => ({ mutateAsync: mocks.mutationMutate }),
      },
    },
  },
}));

vi.mock("@/lib/dmAttachment", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/dmAttachment")>();
  return {
    ...actual,
    probeDmMedia: vi.fn(async () => ({ width: 800, height: 600 })),
    startDmUpload: vi.fn(
      (options: { kind: "image" | "video" | "document"; file: File }) => ({
        promise: Promise.resolve({
          key: `dm/1/abcd1234-123-${options.file.name}`,
          url: `https://cdn.test/dm/1/abcd1234-123-${options.file.name}`,
          mediaType: options.kind === "image" ? "image/png" : "video/mp4",
          name: options.file.name,
          size: options.file.size,
          kind: options.kind,
        }),
        abort: vi.fn(),
      })
    ),
  };
});

import { startDmUpload } from "@/lib/dmAttachment";
import MessageDetail from "./MessageDetail";

const PHOTO_ACCEPT = "image/*";
const VIDEO_ACCEPT = "video/*";

function fileInputs(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="file"]')
  );
}

function inputFor(acceptFragment: string): HTMLInputElement {
  // `accept` is a comma list for documents, so match by containment.
  const input = document.querySelector<HTMLInputElement>(
    `input[type="file"][accept*="${acceptFragment}"]`
  );
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function trackClicks(input: HTMLInputElement) {
  const handler = vi.fn();
  input.addEventListener("click", handler);
  return handler;
}

/** Opens the "＋" menu. */
function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  expect(screen.getByRole("menu", { name: "Send attachment" })).toBeTruthy();
}

describe("DM attachment picker wiring", () => {
  beforeAll(() => {
    // jsdom has neither object URLs nor layout scrolling.
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:preview"),
      writable: true,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    vi.mocked(startDmUpload).mockClear();
  });

  it("keeps all three pickers mounted and laid out (never display:none)", () => {
    render(<MessageDetail />);

    const [photo, video, document] = [
      inputFor(PHOTO_ACCEPT),
      inputFor(VIDEO_ACCEPT),
      inputFor(".pdf"),
    ];
    expect(fileInputs()).toHaveLength(3);

    for (const input of [photo, video, document]) {
      expect(input.isConnected).toBe(true);
      // `hidden` / display:none is what mobile browsers and the WebView ignore
      // for programmatic .click() on a file input.
      expect(input.hasAttribute("hidden")).toBe(false);
      expect(window.getComputedStyle(input).display).not.toBe("none");
      expect(input.className).toContain("sr-only");
    }
    expect(photo.multiple).toBe(true);
    expect(video.multiple).toBe(false);
    expect(document.multiple).toBe(false);
  });

  it("keeps the pickers mounted while the menu is open and closed", () => {
    render(<MessageDetail />);
    expect(fileInputs()).toHaveLength(3);

    openMenu();
    expect(fileInputs()).toHaveLength(3);
    fireEvent.click(screen.getByRole("menuitem", { name: "Photos" }));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(fileInputs()).toHaveLength(3);
    expect(fileInputs().every(input => input.isConnected)).toBe(true);
  });

  it("routes each menu action to its own picker and closes the menu", () => {
    render(<MessageDetail />);

    const photo = inputFor(PHOTO_ACCEPT);
    const video = inputFor(VIDEO_ACCEPT);
    const document = inputFor(".pdf");
    const photoClicks = trackClicks(photo);
    const videoClicks = trackClicks(video);
    const documentClicks = trackClicks(document);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Photos" }));
    expect(photoClicks).toHaveBeenCalledTimes(1);
    expect(videoClicks).not.toHaveBeenCalled();
    expect(documentClicks).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Video" }));
    expect(videoClicks).toHaveBeenCalledTimes(1);
    expect(photoClicks).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Document" }));
    expect(documentClicks).toHaveBeenCalledTimes(1);
    expect(photoClicks).toHaveBeenCalledTimes(1);
    expect(videoClicks).toHaveBeenCalledTimes(1);
  });

  it("turns a selection into a pending chip, uploads it, and enables send", async () => {
    render(<MessageDetail />);
    const photo = inputFor(PHOTO_ACCEPT);

    const file = new File([new Uint8Array(2048)], "beach.png", {
      type: "image/png",
    });

    // A live FileList: clearing the input's value empties the very object the
    // handler reads. Capturing the reference and consuming it after the clear
    // (the old order) dropped the selection silently.
    let liveFile: File | null = file;
    const list = {
      get length() {
        return liveFile ? 1 : 0;
      },
      item: (index: number) => (index === 0 ? liveFile : null),
      *[Symbol.iterator]() {
        if (liveFile) yield liveFile;
      },
    } as unknown as FileList;

    let value = "beach.png";
    Object.defineProperty(photo, "value", {
      configurable: true,
      get: () => value,
      set: (next: string) => {
        value = next;
        if (next === "") liveFile = null;
      },
    });
    Object.defineProperty(photo, "files", {
      configurable: true,
      get: () => list,
    });

    fireEvent.change(photo);

    // Preview appears immediately (image chip carries the file name as alt).
    expect(await screen.findByAltText("beach.png")).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "Pending attachments" })
    ).toBeTruthy();
    expect(vi.mocked(startDmUpload)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startDmUpload).mock.calls[0][0].kind).toBe("image");

    // Upload finishes → chip is ready → the send button unlocks.
    await waitFor(() => {
      const send = screen.getByRole("button", {
        name: "Send message",
      }) as HTMLButtonElement;
      expect(send.disabled).toBe(false);
    });
    expect(screen.queryByText(/Retry/)).toBeNull();
  });

  it("still works when the same file is chosen a second time", async () => {
    render(<MessageDetail />);
    const photo = inputFor(PHOTO_ACCEPT);

    const file = new File([new Uint8Array(64)], "again.png", {
      type: "image/png",
    });
    const armSelection = () =>
      Object.defineProperty(photo, "files", {
        configurable: true,
        value: [file],
        writable: true,
      });

    armSelection();
    fireEvent.change(photo);
    expect(await screen.findByAltText("again.png")).toBeTruthy();

    // A second selection of the same file repopulates `input.files` and must
    // fire `change` again (the handler resets `value` so it is not filtered).
    armSelection();
    fireEvent.change(photo);
    expect(await screen.findAllByAltText("again.png")).toHaveLength(2);
  });
});

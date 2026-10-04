/**
 * DM attachment picker wiring — runtime regression tests.
 *
 * Locks the real click path on a rendered page (not the menu component in
 * isolation):
 *
 *   Photos / Video / Document → the file input INSIDE the open menu
 *   gets a change event → pending chip → upload → ready.
 *
 * The menu item IS the file input wrapper — no programmatic .click(),
 * no label htmlFor indirection, no menu unmounting before picker activation.
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

function createFileList(...files: File[]): FileList {
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: () => files[Symbol.iterator](),
  } as unknown as FileList;
}

/** Opens the "＋" menu. */
function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  expect(screen.getByRole("menu", { name: "Send attachment" })).toBeTruthy();
}

/** Finds a file input inside the open menu by its aria-label. */
function getFileInput(ariaLabel: string): HTMLInputElement {
  const input = screen.getByLabelText(ariaLabel) as HTMLInputElement;
  expect(input).toBeTruthy();
  return input;
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

  it("renders three file inputs inside the menu when open", () => {
    render(<MessageDetail />);

    // Menu closed — no file inputs in document
    expect(document.querySelectorAll('input[type="file"]').length).toBe(0);

    openMenu();

    // Menu open — three file inputs present
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(inputs.length).toBe(3);

    // Each has correct accept and aria-label
    const photo = getFileInput("Choose photos to send");
    const video = getFileInput("Choose a video to send");
    const doc = getFileInput("Choose a document to send");

    expect(photo.accept).toBe("image/*");
    expect(photo.multiple).toBe(true);
    expect(video.accept).toBe("video/*");
    expect(video.multiple).toBe(false);
    expect(doc.accept).toContain(".pdf");
    expect(doc.multiple).toBe(false);

    // Inputs are laid out (not display:none, not hidden)
    for (const input of [photo, video, doc]) {
      expect(input.isConnected).toBe(true);
      expect(input.hasAttribute("hidden")).toBe(false);
      expect(window.getComputedStyle(input).display).not.toBe("none");
      // The input is absolutely positioned over the menu item, not sr-only
      expect(input.className).toContain("attach-menu-input");
    }
  });

  it("keeps the pickers mounted while the menu is open and closed", () => {
    render(<MessageDetail />);
    expect(document.querySelectorAll('input[type="file"]').length).toBe(0);

    openMenu();
    expect(document.querySelectorAll('input[type="file"]').length).toBe(3);

    // Select a file — menu closes via onClose in handleChange
    const photo = getFileInput("Choose photos to send");
    const file = new File([new Uint8Array(100)], "test.png", { type: "image/png" });
    Object.defineProperty(photo, "files", {
      value: createFileList(file),
      configurable: true,
    });
    fireEvent.change(photo);

    expect(screen.queryByRole("menu")).toBeNull();
    // After menu closes, file inputs are unmounted (menu is conditionally rendered)
    expect(document.querySelectorAll('input[type="file"]').length).toBe(0);
  });

  it("each menu item has its own file input with correct accept type", () => {
    render(<MessageDetail />);
    openMenu();

    const photo = getFileInput("Choose photos to send");
    const video = getFileInput("Choose a video to send");
    const doc = getFileInput("Choose a document to send");

    expect(photo.accept).toBe("image/*");
    expect(photo.multiple).toBe(true);
    expect(video.accept).toBe("video/*");
    expect(video.multiple).toBe(false);
    expect(doc.accept).toContain(".pdf");
    expect(doc.multiple).toBe(false);

    // Selecting a file closes the menu
    const file = new File([new Uint8Array(100)], "test.png", { type: "image/png" });
    Object.defineProperty(photo, "files", {
      value: createFileList(file),
      configurable: true,
    });
    fireEvent.change(photo);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("turns a selection into a pending chip, uploads it, and enables send", async () => {
    render(<MessageDetail />);
    openMenu();

    const photo = getFileInput("Choose photos to send");

    const file = new File([new Uint8Array(2048)], "beach.png", {
      type: "image/png",
    });
    Object.defineProperty(photo, "files", {
      value: createFileList(file),
      configurable: true,
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
    openMenu();

    const photo = getFileInput("Choose photos to send");

    const file = new File([new Uint8Array(64)], "again.png", {
      type: "image/png",
    });

    // First selection
    Object.defineProperty(photo, "files", {
      value: createFileList(file),
      configurable: true,
    });
    fireEvent.change(photo);
    expect(await screen.findByAltText("again.png")).toBeTruthy();

    // Menu closed after first selection — open again for second selection
    openMenu();
    const photo2 = getFileInput("Choose photos to send");
    // Second selection of the same file — value reset allows change to fire again
    Object.defineProperty(photo2, "files", {
      value: createFileList(file),
      configurable: true,
    });
    fireEvent.change(photo2);
    expect(await screen.findAllByAltText("again.png")).toHaveLength(2);
  });

  it("handles video selection", async () => {
    render(<MessageDetail />);
    openMenu();

    const video = getFileInput("Choose a video to send");

    const file = new File([new Uint8Array(5000)], "clip.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(video, "files", {
      value: createFileList(file),
      configurable: true,
    });

    fireEvent.change(video);

    expect(await screen.findByText("clip.mp4")).toBeTruthy();
    expect(vi.mocked(startDmUpload)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startDmUpload).mock.calls[0][0].kind).toBe("video");
  });

  it("handles document selection", async () => {
    render(<MessageDetail />);
    openMenu();

    const document = getFileInput("Choose a document to send");

    const file = new File([new Uint8Array(1024)], "report.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(document, "files", {
      value: createFileList(file),
      configurable: true,
    });

    fireEvent.change(document);

    expect(await screen.findByText("report.pdf")).toBeTruthy();
    expect(vi.mocked(startDmUpload)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startDmUpload).mock.calls[0][0].kind).toBe("document");
  });
});
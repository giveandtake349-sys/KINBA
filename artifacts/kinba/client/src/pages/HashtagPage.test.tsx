import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import HashtagPage from "./HashtagPage";

// Mock wouter
vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  useParams: () => ({ tag: "test" }),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  X: () => <svg data-testid="x-icon" />,
  Clock: () => <svg data-testid="clock-icon" />,
  Megaphone: () => <svg data-testid="megaphone-icon" />,
  Users: () => <svg data-testid="users-icon" />,
  Radio: () => <svg data-testid="radio-icon" />,
  Package: () => <svg data-testid="package-icon" />,
  MessageCircle: () => <svg data-testid="message-circle-icon" />,
}));

// Mock trpc
const createMockTagQuery = (overrides = {}) => ({
  data: { id: 1, tag: "test", displayTag: "test", createdAt: new Date() },
  isPending: false,
  isError: false,
  isSuccess: true,
  refetch: vi.fn(),
  ...overrides,
});

const createMockContentQuery = (overrides = {}) => ({
  data: [
    { type: "video", id: 1, title: "Test Video", body: "Check #test out", createdAt: new Date(), authorId: 1, authorName: "User1" },
    { type: "announcement", id: 2, title: null, body: "Announcement with #test", createdAt: new Date(), authorId: 2, authorName: "User2" },
    { type: "hype_room", id: 3, title: "Test Room", body: "Room #test", createdAt: new Date(), authorId: 3, authorName: "User3" },
    { type: "hype_room_message", id: 4, title: null, body: "Message #test", createdAt: new Date(), authorId: 4, authorName: "User4" },
    { type: "drop", id: 5, title: "Test Drop", body: "Drop #test", createdAt: new Date(), authorId: 5, authorName: "User5" },
  ],
  isPending: false,
  isError: false,
  isSuccess: true,
  refetch: vi.fn(),
  ...overrides,
});

let mockTagQuery = createMockTagQuery();
let mockContentQuery = createMockContentQuery();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    hashtag: {
      byTag: {
        useQuery: vi.fn(() => mockTagQuery),
      },
      content: {
        useQuery: vi.fn(() => mockContentQuery),
      },
    },
    useUtils: vi.fn(() => ({
      hashtag: {
        byTag: { invalidate: vi.fn() },
        content: { invalidate: vi.fn() },
      },
    })),
  },
}));

// Mock MediaHub utilities
vi.mock("@/components/MediaHub", () => ({
  formatCount: (n: number) => n.toString(),
  relativeTime: () => "just now",
  displayName: (name: string | null) => name ?? "Unknown",
  ownerHandle: (name: string | null) => name ? `@${name}` : "@unknown",
}));

// Mock runtimeConfig
vi.mock("@/lib/runtimeConfig", () => ({
  resolveMediaUrl: (url: string | null) => url,
  isAbsoluteHttpUrl: () => false,
}));

// Mock Caption
vi.mock("@/components/Caption", () => ({
  Caption: ({ text }: { text: string }) => <span data-testid="caption">{text}</span>,
}));

// Mock HashtagText
vi.mock("@/components/HashtagText", () => ({
  HashtagText: ({ text }: { text: string }) => <span data-testid="hashtag-text">{text}</span>,
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  X: () => <svg data-testid="x-icon" />,
  Clock: () => <svg data-testid="clock-icon" />,
  Megaphone: () => <svg data-testid="megaphone-icon" />,
  Users: () => <svg data-testid="users-icon" />,
  Radio: () => <svg data-testid="radio-icon" />,
  Package: () => <svg data-testid="package-icon" />,
  MessageCircle: () => <svg data-testid="message-circle-icon" />,
}));

describe("HashtagPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTagQuery = createMockTagQuery();
    mockContentQuery = createMockContentQuery();
  });

  it("renders hashtag title with displayTag", async () => {
    render(<HashtagPage />);
    await waitFor(() => {
      const header = screen.getByTestId("hashtag-title");
      const element = header.querySelector(".hashtag-display");
      expect(element).toBeTruthy();
      expect(element.textContent).toBe("test");
    });
  });

  it("shows back button", async () => {
    render(<HashtagPage />);
    await waitFor(() => {
      const backBtn = screen.getByRole("button", { name: /back/i });
      expect(backBtn).toBeTruthy();
    });
  });

  it("groups content by type and shows section headers", async () => {
    render(<HashtagPage />);
    await waitFor(() => {
      expect(screen.getByText("Videos")).toBeTruthy();
      expect(screen.getByText("Announcements")).toBeTruthy();
      expect(screen.getByText("Hype Rooms")).toBeTruthy();
      expect(screen.getByText("Room Messages")).toBeTruthy();
      expect(screen.getByText("Drops")).toBeTruthy();
    });
  });

  it("renders video items with title and body", async () => {
    render(<HashtagPage />);
    await waitFor(() => {
      expect(screen.getByText("Test Video")).toBeTruthy();
      expect(screen.getByText("Check #test out")).toBeTruthy();
    });
  });

  it("renders announcement items with body", async () => {
    render(<HashtagPage />);
    await waitFor(() => {
      expect(screen.getByText("Announcement with #test")).toBeTruthy();
    });
  });

  it("renders hype room items with title", async () => {
    render(<HashtagPage />);
    await waitFor(() => {
      expect(screen.getByText("Test Room")).toBeTruthy();
    });
  });

  it("renders hype room message items", async () => {
    render(<HashtagPage />);
    await waitFor(() => {
      expect(screen.getByText("Message #test")).toBeTruthy();
    });
  });

  it("renders drop items with title", async () => {
    render(<HashtagPage />);
    await waitFor(() => {
      expect(screen.getByText("Test Drop")).toBeTruthy();
    });
  });

  it("shows total post count", async () => {
    render(<HashtagPage />);
    await waitFor(() => {
      const element = screen.getByText((content) => content.includes("5 posts"));
      expect(element).toBeTruthy();
    });
  });

  it("shows loading/empty state when no tag data", async () => {
    // The component shows empty state when no tag data is available
    mockTagQuery.data = null;
    mockContentQuery.data = [];

    render(<HashtagPage />);
    await waitFor(() => {
      const empty = screen.queryByText((content) => content.includes("No content for"));
      expect(empty).toBeTruthy();
    });
  });

  it("shows empty state on failure", async () => {
    // The component shows empty state when both tag and content queries fail
    mockTagQuery.isError = true;
    mockTagQuery.isPending = false;
    mockContentQuery.isError = true;
    mockContentQuery.isPending = false;
    mockTagQuery.data = null;
    mockContentQuery.data = [];

    render(<HashtagPage />);
    await waitFor(() => {
      const element = screen.getByText((content) => content.includes("No content for"));
      expect(element).toBeTruthy();
    });
  });

  it("shows empty state when no content", async () => {
    mockTagQuery.data = { id: 1, tag: "empty", displayTag: "empty", createdAt: new Date() };
    mockContentQuery.data = [];

    render(<HashtagPage />);
    await waitFor(() => {
      expect(screen.getByText((content) => content.includes("No content for #empty"))).toBeTruthy();
    });
  });

  it("shows not found state for unknown hashtag", async () => {
    mockTagQuery.data = null;
    mockContentQuery.data = [];

    render(<HashtagPage />);
    await waitFor(() => {
      expect(screen.getByText((content) => content.includes("No content for #test"))).toBeTruthy();
    });
  });

  it("preserves display casing from server", async () => {
    // The displayTag is used in the header, check for the displayTag "Test" in the header
    mockTagQuery.data = { id: 1, tag: "test", displayTag: "Test", createdAt: new Date() };
    render(<HashtagPage />);
    await waitFor(() => {
      // Look for the displayTag in the header specifically
      const header = document.querySelector(".hashtag-page-header");
      const displayElement = header?.querySelector(".hashtag-display");
      expect(displayElement?.textContent).toBe("Test");
    });
  });
});
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReactorList, type ReactorSource } from "./ReactorList";

const mocks = vi.hoisted(() => ({
  video: vi.fn(),
  comment: vi.fn(),
  community: vi.fn(),
  hype: vi.fn(),
}));

const page = {
  reactors: [],
  hasMore: false,
  offset: 0,
  limit: 50,
  viewerReactions: [],
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      videos: {
        reactors: { fetch: mocks.video },
        comments: { reactors: { fetch: mocks.comment } },
      },
      community: { reactors: { fetch: mocks.community } },
      hypeRooms: { messageReactors: { fetch: mocks.hype } },
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

function renderSource(source: ReactorSource, title: string) {
  mocks.video.mockResolvedValue(page);
  mocks.comment.mockResolvedValue(page);
  mocks.community.mockResolvedValue(page);
  mocks.hype.mockResolvedValue(page);
  render(
    <ReactorList open title={title} source={source} onClose={vi.fn()} />
  );
}

describe("ReactorList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads videos through videos.reactors", async () => {
    renderSource({ kind: "video", videoId: 11 }, "Video reactions");
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await waitFor(() =>
      expect(mocks.video).toHaveBeenCalledWith({
        videoId: 11,
        limit: 50,
        offset: 0,
      })
    );
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe(
      "Video reactions"
    );
  });

  it("reads comments through videos.comments.reactors", async () => {
    renderSource({ kind: "comment", commentId: 22 }, "Comment reactions");
    await waitFor(() =>
      expect(mocks.comment).toHaveBeenCalledWith({
        commentId: 22,
        limit: 50,
        offset: 0,
      })
    );
  });

  it("reads announcements through community.reactors", async () => {
    renderSource(
      { kind: "community", announcementId: 33 },
      "Announcement reactions"
    );
    await waitFor(() =>
      expect(mocks.community).toHaveBeenCalledWith({
        announcementId: 33,
        limit: 50,
        offset: 0,
      })
    );
  });

  it("reads hype messages through hypeRooms.messageReactors", async () => {
    renderSource(
      { kind: "hypeMessage", roomId: 4, messageId: 55 },
      "Message reactions"
    );
    await waitFor(() =>
      expect(mocks.hype).toHaveBeenCalledWith({
        roomId: 4,
        messageId: 55,
        limit: 50,
        offset: 0,
      })
    );
  });

  it("fetches nothing while the sheet is closed", async () => {
    render(
      <ReactorList
        open={false}
        title="Video reactions"
        source={{ kind: "video", videoId: 11 }}
        onClose={vi.fn()}
      />
    );
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mocks.video).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

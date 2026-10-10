import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactionType } from "@shared/reactions";
import {
  REACTOR_PAGE_SIZE,
  ReactorListSheet,
  type ReactorSheetEntry,
} from "./ReactorListSheet";

const auth = vi.hoisted(() => ({
  user: { id: 42 } as { id: number } | null,
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: auth.user,
    isAuthenticated: auth.user != null,
    loading: false,
    error: null,
    openAuth: vi.fn(),
  }),
}));

function reactor(
  userId: number,
  name: string,
  reactions: ReactionType[]
): ReactorSheetEntry {
  return {
    userId,
    name,
    username: name.toLowerCase().replace(/\s+/g, "_"),
    photoUrl: null,
    reactions,
  };
}

describe("ReactorListSheet", () => {
  it("renders the first page of reactors with the viewer's own reaction", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      reactors: [
        reactor(1, "Asha", ["fire"]),
        reactor(2, "Bela", ["like", "clap"]),
      ],
      hasMore: false,
      offset: 0,
      limit: REACTOR_PAGE_SIZE,
      viewerReactions: ["fire"],
    });

    render(
      <ReactorListSheet
        open
        title="Video reactions"
        fetchPage={fetchPage}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText("Asha")).toBeTruthy();
    expect(screen.getByText("Bela")).toBeTruthy();
    expect(fetchPage).toHaveBeenCalledWith(0);
    expect(document.querySelector(".reaction-reactor-viewer")).toBeTruthy();
    // Legacy types normalize to the single Pookie reaction, merged per row.
    expect(screen.getByRole("img", { name: "Pookie" })).toBeTruthy();
    const labels = screen.getAllByRole("img", {
      name: "Reacted with Pookie",
    });
    expect(labels).toHaveLength(2);
  });

  it("pages with the backend batch offset and dedupes repeated rows", async () => {
    const fetchPage = vi.fn(async (offset: number) => ({
      reactors:
        offset === 0
          ? [reactor(1, "Asha", ["fire"]), reactor(2, "Bela", ["like"])]
          : [reactor(2, "Bela", ["like"]), reactor(3, "Chetan", ["clap"])],
      hasMore: offset === 0,
      offset,
      limit: REACTOR_PAGE_SIZE,
      viewerReactions: [],
    }));

    render(
      <ReactorListSheet
        open
        title="Comment reactions"
        fetchPage={fetchPage}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText("Asha")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Chetan")).toBeTruthy();
    expect(fetchPage).toHaveBeenLastCalledWith(2);
    expect(screen.getAllByText("Bela")).toHaveLength(1);
  });

  it("says so when nobody has reacted", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      reactors: [],
      hasMore: false,
      offset: 0,
      limit: REACTOR_PAGE_SIZE,
      viewerReactions: [],
    });

    render(
      <ReactorListSheet
        open
        title="Announcement reactions"
        fetchPage={fetchPage}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText("No reactions yet.")).toBeTruthy();
  });

  it("offers a retry when the first page fails", async () => {
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({
        reactors: [reactor(1, "Asha", ["fire"])],
        hasMore: false,
        offset: 0,
        limit: REACTOR_PAGE_SIZE,
        viewerReactions: [],
      });

    render(
      <ReactorListSheet
        open
        title="Message reactions"
        fetchPage={fetchPage}
        onClose={vi.fn()}
      />
    );

    expect(
      await screen.findByText(/this list is unavailable right now/i)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Asha")).toBeTruthy();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape and restores the page scroll", async () => {
    const onClose = vi.fn();
    const fetchPage = vi.fn().mockResolvedValue({
      reactors: [],
      hasMore: false,
      offset: 0,
      limit: REACTOR_PAGE_SIZE,
      viewerReactions: [],
    });

    const { rerender } = render(
      <ReactorListSheet
        open
        title="Video reactions"
        fetchPage={fetchPage}
        onClose={onClose}
      />
    );
    await screen.findByText("No reactions yet.");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <ReactorListSheet
        open={false}
        title="Video reactions"
        fetchPage={fetchPage}
        onClose={onClose}
      />
    );
    expect(document.body.style.overflow).toBe("");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks the viewer's own row", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      reactors: [reactor(42, "Asha", ["fire"])],
      hasMore: false,
      offset: 0,
      limit: REACTOR_PAGE_SIZE,
      viewerReactions: [],
    });

    render(
      <ReactorListSheet
        open
        title="Video reactions"
        fetchPage={fetchPage}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText("You")).toBeTruthy();
  });
});

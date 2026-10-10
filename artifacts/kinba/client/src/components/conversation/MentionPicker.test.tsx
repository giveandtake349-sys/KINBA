import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MentionPicker, type MentionPickerHandle } from "./MentionPicker";

const mocks = vi.hoisted(() => ({
  users: [] as Array<{
    id: number;
    name: string | null;
    username: string | null;
    photoUrl?: string | null;
  }>,
  isPending: false,
  isError: false,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    home: {
      searchAll: {
        useQuery: () => ({
          data: { users: mocks.users },
          isPending: mocks.isPending,
          isError: mocks.isError,
        }),
      },
    },
  },
}));

beforeEach(() => {
  mocks.users = [
    { id: 11, name: "Alice Wonder", username: "alice" },
    { id: 12, name: "Bob Builder", username: "bob_1" },
  ];
  mocks.isPending = false;
  mocks.isError = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("conversation MentionPicker", () => {
  it("button mode renders the search input and autofocuses it", () => {
    render(<MentionPicker onPick={vi.fn()} />);
    const input = screen.getByRole("searchbox", {
      name: "Search people to mention",
    });
    expect(input).toBeTruthy();
  });

  it("typing mode hides the internal search box and uses the controlled query", () => {
    render(<MentionPicker onPick={vi.fn()} query="ali" />);
    expect(
      screen.queryByRole("searchbox", { name: "Search people to mention" })
    ).toBeNull();
    expect(screen.getByRole("option", { name: /Alice Wonder/ })).toBeTruthy();
  });

  it("shows the hint when the controlled query is empty", () => {
    render(<MentionPicker onPick={vi.fn()} query="" />);
    expect(screen.getByText("Type a name or @username.")).toBeTruthy();
  });

  it("picks the user's real id and username (identity preservation)", () => {
    const onPick = vi.fn();
    render(<MentionPicker onPick={onPick} query="bob" />);
    fireEvent.click(screen.getByRole("option", { name: /Bob Builder/ }));
    expect(onPick).toHaveBeenCalledWith({
      id: 12,
      name: "Bob Builder",
      username: "bob_1",
    });
  });

  it("excludes the viewer from results", () => {
    render(<MentionPicker onPick={vi.fn()} query="a" viewerId={11} />);
    expect(screen.queryByRole("option", { name: /Alice Wonder/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Bob Builder/ })).toBeTruthy();
  });

  it("forwardRef: selectHighlighted picks the first row by default", () => {
    const onPick = vi.fn();
    const ref = createRef<MentionPickerHandle>();
    render(<MentionPicker ref={ref} onPick={onPick} query="a" />);
    expect(ref.current?.selectHighlighted()).toBe(true);
    expect(onPick).toHaveBeenCalledWith({
      id: 11,
      name: "Alice Wonder",
      username: "alice",
    });
  });

  it("forwardRef: moveHighlight cycles through rows", () => {
    const onPick = vi.fn();
    const ref = createRef<MentionPickerHandle>();
    render(<MentionPicker ref={ref} onPick={onPick} query="a" />);
    act(() => {
      ref.current?.moveHighlight(1);
    });
    expect(ref.current?.selectHighlighted()).toBe(true);
    expect(onPick).toHaveBeenCalledWith({
      id: 12,
      name: "Bob Builder",
      username: "bob_1",
    });
  });

  it("forwardRef: selectHighlighted returns false on an empty list", () => {
    mocks.users = [];
    const ref = createRef<MentionPickerHandle>();
    render(<MentionPicker ref={ref} onPick={vi.fn()} query="zzz" />);
    expect(ref.current?.selectHighlighted()).toBe(false);
  });

  it("button mode: Enter in the search box picks the highlighted row", () => {
    const onPick = vi.fn();
    render(<MentionPicker onPick={onPick} />);
    const input = screen.getByRole("searchbox", {
      name: "Search people to mention",
    });
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({
      id: 11,
      name: "Alice Wonder",
      username: "alice",
    });
  });

  it("button mode: ArrowDown then Enter picks the second row", () => {
    const onPick = vi.fn();
    render(<MentionPicker onPick={onPick} />);
    const input = screen.getByRole("searchbox", {
      name: "Search people to mention",
    });
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({
      id: 12,
      name: "Bob Builder",
      username: "bob_1",
    });
  });

  it("marks the highlighted row with aria-selected", () => {
    render(<MentionPicker onPick={vi.fn()} query="a" />);
    const [first, second] = screen.getAllByRole("option");
    expect(first?.getAttribute("aria-selected")).toBe("true");
    expect(second?.getAttribute("aria-selected")).toBe("false");
  });

  it("shows a searching hint while the query is pending", () => {
    mocks.isPending = true;
    render(<MentionPicker onPick={vi.fn()} query="a" />);
    expect(screen.getByText("Searching…")).toBeTruthy();
  });
});

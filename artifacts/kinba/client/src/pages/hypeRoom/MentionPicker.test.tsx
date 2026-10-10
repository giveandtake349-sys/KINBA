import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MentionPicker, type HypeMentionPickerHandle } from "./MentionPicker";
import type { MemberRow } from "./shared";

function member(
  id: number,
  name: string,
  username: string | null,
  role = "audience"
): MemberRow {
  return {
    membership: {
      id: id * 10,
      roomId: 1,
      userId: id,
      role,
      joinedAt: new Date("2026-01-01T00:00:00Z"),
      leftAt: null,
      bannedAt: null,
      removedBy: null,
    },
    user: {
      id,
      name,
      openId: `open-${id}`,
      photoUrl: null,
      username,
    },
  };
}

const members: MemberRow[] = [
  member(21, "Alice Wonder", "alice"),
  member(22, "Bob Builder", "bob_1"),
  member(23, "Cara Lee", "cara"),
];

function renderPicker(
  overrides: Partial<Parameters<typeof MentionPicker>[0]> = {}
) {
  const onToggle = vi.fn();
  const ref = createRef<HypeMentionPickerHandle>();
  render(
    <MentionPicker
      ref={ref}
      members={members}
      viewerId={30}
      hostId={21}
      selectedIds={[]}
      onToggle={onToggle}
      {...overrides}
    />
  );
  return { onToggle, ref };
}

describe("hypeRoom MentionPicker", () => {
  it("button mode renders its own search box", () => {
    renderPicker();
    expect(screen.getByLabelText("Search members to mention")).toBeTruthy();
  });

  it("typing mode hides the search box and filters by the controlled query", () => {
    renderPicker({ query: "bob" });
    expect(screen.queryByLabelText("Search members to mention")).toBeNull();
    expect(screen.getByRole("option", { name: /bob_1/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /alice/ })).toBeNull();
  });

  it("toggles the picked member's real user id (ID preservation)", () => {
    const { onToggle } = renderPicker({ query: "alice" });
    fireEvent.click(screen.getByRole("option", { name: /alice/ }));
    expect(onToggle).toHaveBeenCalledWith(21);
  });

  it("excludes the viewer from options", () => {
    renderPicker({ viewerId: 21, query: "" });
    expect(screen.queryByRole("option", { name: /alice/ })).toBeNull();
    expect(screen.getByRole("option", { name: /bob_1/ })).toBeTruthy();
  });

  it("marks already-selected members", () => {
    renderPicker({ selectedIds: [22], query: "" });
    const bob = screen.getByRole("option", { name: /bob_1/ });
    expect(bob.getAttribute("aria-selected")).toBe("true");
    const alice = screen.getByRole("option", { name: /alice/ });
    expect(alice.getAttribute("aria-selected")).toBe("false");
  });

  it("forwardRef: selectHighlighted toggles the first member by default", () => {
    const { onToggle, ref } = renderPicker({ query: "" });
    expect(ref.current?.selectHighlighted()).toBe(true);
    expect(onToggle).toHaveBeenCalledWith(21);
  });

  it("forwardRef: moveHighlight then selectHighlighted picks the next", () => {
    const { onToggle, ref } = renderPicker({ query: "" });
    act(() => {
      ref.current?.moveHighlight(1);
    });
    expect(ref.current?.selectHighlighted()).toBe(true);
    expect(onToggle).toHaveBeenCalledWith(22);
  });

  it("forwardRef: selectHighlighted returns false on an empty list", () => {
    const { ref } = renderPicker({ query: "zzz" });
    expect(ref.current?.selectHighlighted()).toBe(false);
  });

  it("button mode: ArrowDown + Enter toggles the highlighted member", () => {
    const { onToggle } = renderPicker();
    const input = screen.getByLabelText("Search members to mention");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledWith(22);
  });

  it("shows an empty state when nothing matches", () => {
    renderPicker({ query: "zzz" });
    expect(screen.getByText("No matching members.")).toBeTruthy();
  });
});

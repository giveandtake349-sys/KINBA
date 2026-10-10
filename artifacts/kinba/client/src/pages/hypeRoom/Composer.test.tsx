import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import type { MemberRow } from "./shared";

function member(id: number, name: string, username: string | null): MemberRow {
  return {
    membership: {
      id: id * 10,
      roomId: 1,
      userId: id,
      role: "audience",
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
];

function renderComposer(
  overrides: Partial<Parameters<typeof Composer>[0]> = {}
) {
  const props: Parameters<typeof Composer>[0] = {
    draft: "",
    sending: false,
    replyTarget: null,
    mentionedIds: [],
    mentionPickerOpen: false,
    members,
    viewerId: 30,
    hostId: 21,
    onDraftChange: vi.fn(),
    onToggleMentionPicker: vi.fn(),
    onToggleMention: vi.fn(),
    onCancelReply: vi.fn(),
    onSubmit: vi.fn(),
    onMentionTokenChange: vi.fn(),
    onDismissMentionPicker: vi.fn(),
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
}

describe("hypeRoom Composer mention typing", () => {
  it("typing @ in the textarea reports the mention token", () => {
    const props = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "@ali" } });
    expect(props.onMentionTokenChange).toHaveBeenCalledWith({
      start: 0,
      end: 4,
      query: "ali",
    });
  });

  it("typing @ mid-sentence reports the token at the caret", () => {
    const props = renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    // Set the value through the prototype setter so React's value tracker
    // stays out of the way, place the caret, then dispatch the input event.
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    valueSetter?.call(textarea, "hey @bob!");
    textarea.setSelectionRange(7, 7);
    fireEvent.input(textarea);
    expect(props.onMentionTokenChange).toHaveBeenCalledWith({
      start: 4,
      end: 8,
      query: "bo",
    });
  });

  it("plain text reports a null token", () => {
    const props = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hello there" } });
    expect(props.onMentionTokenChange).toHaveBeenCalledWith(null);
  });

  it("typing mode hides the member search box and filters by query", () => {
    renderComposer({
      mentionPickerOpen: true,
      mentionQuery: "bob",
    });
    expect(screen.queryByLabelText("Search members to mention")).toBeNull();
    expect(screen.getByRole("option", { name: /bob_1/ })).toBeTruthy();
  });

  it("picking a member from typing mode toggles the real user id", () => {
    const props = renderComposer({
      mentionPickerOpen: true,
      mentionQuery: "alice",
    });
    fireEvent.click(screen.getByRole("option", { name: /alice/ }));
    expect(props.onToggleMention).toHaveBeenCalledWith(21);
  });

  it("Escape with the picker open dismisses it", () => {
    const props = renderComposer({ mentionPickerOpen: true });
    const textarea = screen.getByLabelText("Message");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(props.onDismissMentionPicker).toHaveBeenCalled();
  });

  it("ArrowDown + Enter in typing mode toggles the highlighted member", () => {
    const props = renderComposer({ mentionPickerOpen: true, mentionQuery: "" });
    const textarea = screen.getByLabelText("Message");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(props.onToggleMention).toHaveBeenCalledWith(22);
  });

  it("renders mention chips for already-picked members", () => {
    renderComposer({ mentionedIds: [21] });
    expect(screen.getByText(/@alice/)).toBeTruthy();
  });

  it("the @ button toggles the picker", () => {
    const props = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Mention members" }));
    expect(props.onToggleMentionPicker).toHaveBeenCalled();
  });
});

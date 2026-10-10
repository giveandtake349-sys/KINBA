import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LongPressHandlers } from "@/hooks/useLongPress";
import { ReactionBar } from "./ReactionBar";

const reactions = [{ reaction: "love" as const, count: 5, reactedByMe: true }];

function fakeLongPress(): LongPressHandlers {
  return {
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    onContextMenu: vi.fn(),
    onClickCapture: vi.fn(),
  };
}

describe("ReactionBar", () => {
  it("renders the single Pookie chip without a pill when the surface has no total", () => {
    render(<ReactionBar reactions={reactions} onReact={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "See who reacted" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove Pookie reaction" })
    ).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders the always-clickable pill beside the chip", () => {
    const onTotalClick = vi.fn();
    render(
      <ReactionBar
        reactions={reactions}
        onReact={vi.fn()}
        total={5}
        active="love"
        onTotalClick={onTotalClick}
      />
    );
    const pill = screen.getByRole("button", { name: "See who reacted" });
    expect(pill).toBeTruthy();
    fireEvent.click(pill);
    expect(onTotalClick).toHaveBeenCalledTimes(1);
  });

  it("keeps chip taps on the direct toggle path", () => {
    const onReact = vi.fn();
    const onTotalClick = vi.fn();
    render(
      <ReactionBar
        reactions={reactions}
        onReact={onReact}
        total={5}
        onTotalClick={onTotalClick}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Pookie reaction" })
    );
    expect(onReact).toHaveBeenCalledWith("love");
    expect(onTotalClick).not.toHaveBeenCalled();
  });

  it("marks the viewer's active chip", () => {
    render(<ReactionBar reactions={reactions} onReact={vi.fn()} />);
    const chip = screen.getByRole("button", {
      name: "Remove Pookie reaction",
    }) as HTMLButtonElement;
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("offers nothing when the surface allows no reaction options", () => {
    render(
      <ReactionBar reactions={reactions} onReact={vi.fn()} availableIds={[]} />
    );
    expect(
      screen.queryByRole("button", { name: "React with Pookie" })
    ).toBeNull();
    expect(screen.queryByRole("group", { name: "Reactions" })).toBeNull();
  });

  it("disables everything while a reaction is in flight", () => {
    const onReact = vi.fn();
    render(
      <ReactionBar
        reactions={reactions}
        onReact={onReact}
        disabled
        total={5}
        onTotalClick={vi.fn()}
      />
    );
    const chip = screen.getByRole("button", {
      name: "Remove Pookie reaction",
    }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(onReact).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "See who reacted" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("exposes the shared long-press gesture on the whole reaction zone", () => {
    const longPress = fakeLongPress();
    render(
      <ReactionBar
        reactions={reactions}
        onReact={vi.fn()}
        longPress={longPress}
      />
    );
    const group = screen.getByRole("group", { name: "Reactions" });
    fireEvent.pointerDown(group, { pointerId: 1, pointerType: "touch" });
    expect(longPress.onPointerDown).toHaveBeenCalledTimes(1);
  });

  it("never renders an expand tray for the single reaction", () => {
    render(<ReactionBar reactions={reactions} onReact={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "More reactions" })).toBeNull();
    expect(screen.queryByRole("menu", { name: "Reaction tray" })).toBeNull();
  });
});

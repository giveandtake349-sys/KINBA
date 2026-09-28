import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LongPressHandlers } from "@/hooks/useLongPress";
import { ReactionBar } from "./ReactionBar";

const reactions = [
  { reaction: "like" as const, count: 2, reactedByMe: false },
  { reaction: "fire" as const, count: 5, reactedByMe: true },
];

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
  it("renders chips without a pill when the surface has no total", () => {
    render(<ReactionBar reactions={reactions} onReact={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Choose a reaction" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove Fire reaction" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "React with Love" })).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("renders the always-clickable pill beside the chips", () => {
    const onTotalClick = vi.fn();
    render(
      <ReactionBar
        reactions={reactions}
        onReact={vi.fn()}
        total={7}
        active="fire"
        onTotalClick={onTotalClick}
      />
    );
    const pill = screen.getByRole("button", { name: "Choose a reaction" });
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
        total={7}
        onTotalClick={onTotalClick}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "React with Love" }));
    expect(onReact).toHaveBeenCalledWith("love");
    expect(onTotalClick).not.toHaveBeenCalled();
  });

  it("marks the viewer's active chip", () => {
    render(<ReactionBar reactions={reactions} onReact={vi.fn()} />);
    const fire = screen.getByRole("button", {
      name: "Remove Fire reaction",
    }) as HTMLButtonElement;
    expect(fire.getAttribute("aria-pressed")).toBe("true");
    const like = screen.getByRole("button", {
      name: "React with Like",
    }) as HTMLButtonElement;
    expect(like.getAttribute("aria-pressed")).toBe("false");
  });

  it("honours an explicit option subset", () => {
    render(
      <ReactionBar
        reactions={reactions}
        onReact={vi.fn()}
        availableIds={["like", "fire"]}
      />
    );
    expect(screen.queryByRole("button", { name: "React with Love" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "React with Clap" })
    ).toBeNull();
  });

  it("disables everything while a reaction is in flight", () => {
    const onReact = vi.fn();
    render(
      <ReactionBar
        reactions={reactions}
        onReact={onReact}
        disabled
        total={7}
        onTotalClick={vi.fn()}
      />
    );
    const like = screen.getByRole("button", {
      name: "React with Like",
    }) as HTMLButtonElement;
    expect(like.disabled).toBe(true);
    fireEvent.click(like);
    expect(onReact).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Choose a reaction" }) as HTMLButtonElement)
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

  it("keeps the expand tray as a fallback activation path", () => {
    const onReact = vi.fn();
    render(<ReactionBar reactions={reactions} onReact={onReact} />);
    fireEvent.click(screen.getByRole("button", { name: "More reactions" }));
    expect(screen.getByRole("menu", { name: "Reaction tray" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Clap" }));
    expect(onReact).toHaveBeenCalledWith("clap");
    expect(screen.queryByRole("menu", { name: "Reaction tray" })).toBeNull();
  });
});

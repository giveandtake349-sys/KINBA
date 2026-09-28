import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReactionPicker } from "./ReactionPicker";

const anchor = { x: 320, y: 480 };

function renderPicker(
  props: Partial<ComponentProps<typeof ReactionPicker>> = {}
) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <ReactionPicker
      open
      anchor={anchor}
      onSelect={onSelect}
      onClose={onClose}
      {...props}
    />
  );
  return { onSelect, onClose };
}

describe("ReactionPicker", () => {
  it("renders nothing until it is opened with an anchor", () => {
    render(
      <ReactionPicker
        open={false}
        anchor={anchor}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole("menu")).toBeNull();

    render(
      <ReactionPicker
        open
        anchor={null}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("exposes exactly the four shared reactions as radio items", () => {
    renderPicker();
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map(item => item.getAttribute("aria-label"))).toEqual([
      "Like",
      "Love",
      "Fire",
      "Clap",
    ]);
    expect(items.every(item => item.getAttribute("aria-checked") === "false")).toBe(
      true
    );
    expect(screen.getByRole("menu").getAttribute("aria-label")).toBe(
      "Choose a reaction"
    );
  });

  it("marks the active type as checked", () => {
    renderPicker({ active: "fire" });
    const checked = screen
      .getAllByRole("menuitemradio")
      .filter(item => item.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]?.getAttribute("aria-label")).toBe("Fire");
  });

  it("reports the chosen type and closes", () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Love" }));
    expect(onSelect).toHaveBeenCalledWith("love");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closing is up to the surface, so selecting the active type still reports it", () => {
    const { onSelect } = renderPicker({ active: "like" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Like" }));
    expect(onSelect).toHaveBeenCalledWith("like");
  });

  it("opens the reactor list from the footer and then closes", () => {
    const onOpenReactors = vi.fn();
    const { onClose } = renderPicker({ onOpenReactors });
    fireEvent.click(screen.getByRole("button", { name: /see who reacted/i }));
    expect(onOpenReactors).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits the reactor entry point when the surface has none", () => {
    renderPicker();
    expect(screen.queryByRole("button", { name: /see who reacted/i })).toBeNull();
  });

  it("closes on Escape", () => {
    const { onClose } = renderPicker();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on an outside click", () => {
    const { onClose } = renderPicker();
    fireEvent.click(document.querySelector(".reaction-picker-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables every option while the mutation is in flight", () => {
    const { onSelect } = renderPicker({ disabled: true });
    const items = screen.getAllByRole("menuitemradio") as HTMLButtonElement[];
    expect(items.every(item => item.disabled)).toBe(true);
    fireEvent.click(items[0]!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("anchors itself inside the viewport rather than off-screen", () => {
    renderPicker({ anchor: { x: -500, y: -500 } });
    const tray = document.querySelector(".reaction-picker") as HTMLElement;
    expect(tray.style.left).toBe("8px");
    expect(tray.style.top).toBe("8px");
    expect(tray.style.transform).toBe("none");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReactionSummaryPill } from "./ReactionSummaryPill";

describe("ReactionSummaryPill", () => {
  it("labels the total when it carries a count", () => {
    render(<ReactionSummaryPill count={7} />);
    expect(screen.getByRole("button", { name: "7 reactions" })).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("shows the viewer's own glyph next to the total", () => {
    render(<ReactionSummaryPill count={3} active="fire" />);
    expect(screen.getByText("🔥")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "3 reactions"
    );
  });

  it("falls back to the default glyph when there is no count to show", () => {
    render(<ReactionSummaryPill />);
    expect(screen.getByText("👍")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose a reaction" })).toBeTruthy();
  });

  it("prefers an explicit accessible label", () => {
    render(
      <ReactionSummaryPill count={2} ariaLabel="React to this announcement" />
    );
    expect(
      screen.getByRole("button", { name: "React to this announcement" })
    ).toBeTruthy();
  });

  it("reports the click so a tap can open the picker", () => {
    const onClick = vi.fn();
    render(<ReactionSummaryPill count={1} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("cannot fire while disabled", () => {
    const onClick = vi.fn();
    render(<ReactionSummaryPill count={1} disabled onClick={onClick} />);
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Caption } from "./Caption";

const LONG_TEXT = Array.from(
  { length: 8 },
  () => "A description that is long enough to overflow the collapsed area."
).join(" ");

/** jsdom has no layout, so the clamp overflow check is driven directly. */
function mockOverflow(scrollHeight: number, clientHeight: number) {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(
    scrollHeight
  );
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(
    clientHeight
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Caption", () => {
  it("keeps the full text in the DOM and offers no toggle when it fits", () => {
    mockOverflow(40, 40);
    render(<Caption text="Short description" maxLines={3} />);

    expect(screen.getByText("Short description")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for empty text", () => {
    mockOverflow(40, 40);
    const { container } = render(<Caption text="" maxLines={3} />);

    expect(container.firstChild).toBeNull();
  });

  it("shows See more while collapsed and toggles to See less", () => {
    mockOverflow(400, 60);
    render(<Caption text={LONG_TEXT} maxLines={3} />);

    // The collapsed view still carries the whole saved text — the clamp is a
    // style, not a truncation, so expanding only reveals what is already there.
    expect(screen.getByText(LONG_TEXT)).toBeTruthy();

    const toggle = screen.getByRole("button", { name: "See more" });
    fireEvent.click(toggle);

    const collapse = screen.getByRole("button", { name: "See less" });
    expect(collapse).toBeTruthy();
    expect(screen.getByText(LONG_TEXT)).toBeTruthy();

    fireEvent.click(collapse);
    expect(screen.getByRole("button", { name: "See more" })).toBeTruthy();
  });

  it("does not activate a clickable card container it sits inside", () => {
    mockOverflow(400, 60);
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <Caption text={LONG_TEXT} maxLines={3} />
      </div>
    );

    fireEvent.click(screen.getByRole("button", { name: "See more" }));

    expect(onCardClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "See less" })).toBeTruthy();
  });

  it("keeps a way back once expanded, even when the unclamped text stops overflowing", () => {
    // Collapsed, the clamp makes the box shorter than its content.
    mockOverflow(400, 60);
    render(<Caption text={LONG_TEXT} maxLines={3} />);
    const expand = screen.getByRole("button", { name: "See more" });

    // Expanding removes the clamp, so the box grows to its content and a naive
    // overflow probe now reports "nothing to reveal".
    mockOverflow(60, 60);
    fireEvent.click(expand);

    expect(screen.getByText(LONG_TEXT)).toBeTruthy();
    const collapse = screen.getByRole("button", { name: "See less" });
    expect(collapse).toBeTruthy();

    // Collapsing re-applies the clamp, so the overflow returns.
    mockOverflow(400, 60);
    fireEvent.click(collapse);
    expect(screen.getByRole("button", { name: "See more" })).toBeTruthy();
  });
});

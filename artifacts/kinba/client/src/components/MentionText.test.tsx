import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MentionText } from "./MentionText";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", mocks.navigate],
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("MentionText", () => {
  it("renders plain text without mentions", () => {
    render(<MentionText text="No mentions here" />);
    expect(screen.getByText("No mentions here")).toBeTruthy();
  });

  it("returns null for empty/undefined text", () => {
    const { container } = render(<MentionText text="" />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<MentionText text={null} />);
    expect(c2.firstChild).toBeNull();
    const { container: c3 } = render(<MentionText text={undefined} />);
    expect(c3.firstChild).toBeNull();
  });

  it("renders a single mention as a link to /@username", () => {
    render(<MentionText text="hey @alice" />);
    const link = screen.getByRole("link", { name: "@alice" });
    expect(link.getAttribute("href")).toBe("/@alice");
  });

  it("renders multiple mentions as links", () => {
    render(<MentionText text="@alice meet @bob_1" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/@alice");
    expect(links[1].getAttribute("href")).toBe("/@bob_1");
  });

  it("preserves surrounding text and punctuation", () => {
    render(<MentionText text="cc @alice, check this!" />);
    const root = screen.getByTestId("mention-text-root");
    expect(root.textContent).toBe("cc @alice, check this!");
    expect(screen.getByRole("link", { name: "@alice" })).toBeTruthy();
  });

  it("does not linkify emails", () => {
    render(<MentionText text="mail foo@example.com" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("does not linkify handles shorter than three characters", () => {
    render(<MentionText text="@ab @abc" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/@abc");
  });

  it("does not linkify a double @@", () => {
    render(<MentionText text="@@alice" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("navigates with SPA routing on mention click", () => {
    render(<MentionText text="hey @alice" />);
    fireEvent.click(screen.getByRole("link", { name: "@alice" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/@alice");
  });

  it("stops propagation so parent handlers do not fire", () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <MentionText text="@alice" />
      </div>
    );
    fireEvent.click(screen.getByRole("link", { name: "@alice" }));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("has accessible link attributes", () => {
    render(<MentionText text="@alice" />);
    expect(screen.getByRole("link").getAttribute("rel")).toBe(
      "noopener noreferrer"
    );
  });

  it("applies custom className", () => {
    render(<MentionText text="@alice" className="custom-class" />);
    const root = screen.getByTestId("mention-text-root");
    expect(root.classList.contains("mention-text")).toBe(true);
    expect(root.classList.contains("custom-class")).toBe(true);
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HashtagText } from "./HashtagText";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HashtagText", () => {
  it("renders plain text without hashtags", () => {
    render(<HashtagText text="No hashtags here" />);
    expect(screen.getByText("No hashtags here")).toBeTruthy();
  });

  it("renders null for empty/undefined text", () => {
    const { container } = render(<HashtagText text="" />);
    expect(container.firstChild).toBeNull();

    const { container: container2 } = render(<HashtagText text={null} />);
    expect(container2.firstChild).toBeNull();

    const { container: container3 } = render(<HashtagText text={undefined} />);
    expect(container3.firstChild).toBeNull();
  });

  it("renders a single hashtag as a link", () => {
    render(<HashtagText text="Hello #world" />);
    const link = screen.getByRole("link", { name: "#world" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/tag/world");
  });

  it("renders multiple hashtags as links", () => {
    render(<HashtagText text="#hello #world" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/tag/hello");
    expect(links[1].getAttribute("href")).toBe("/tag/world");
  });

  it("preserves display casing in link text", () => {
    render(<HashtagText text="#HELLO #Hello" />);
    const links = screen.getAllByRole("link");
    expect(links[0].textContent).toBe("#HELLO");
    expect(links[1].textContent).toBe("#Hello");
  });

  it("normalizes href to lowercase", () => {
    render(<HashtagText text="#HELLO" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/tag/hello");
  });

  it("handles Unicode hashtags", () => {
    render(<HashtagText text="#café" />);
    const link = screen.getByRole("link");
    expect(link.textContent).toBe("#café");
    // href attribute is URL-encoded by encodeURIComponent
    expect(link.getAttribute("href")).toBe("/tag/caf%C3%A9");
  });

  it("preserves surrounding text and punctuation", () => {
    render(<HashtagText text="Check #tag1 and #tag2 out!" />);
    const root = screen.getByTestId("hashtag-text-root");
    expect(root.textContent).toContain("Check ");
    expect(screen.getByRole("link", { name: "#tag1" })).toBeTruthy();
    expect(root.textContent).toContain(" and ");
    expect(screen.getByRole("link", { name: "#tag2" })).toBeTruthy();
    expect(root.textContent).toContain(" out!");
  });

  it("handles punctuation boundaries correctly", () => {
    render(<HashtagText text="#hello! #world?" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/tag/hello");
    expect(links[1].getAttribute("href")).toBe("/tag/world");
    const root = screen.getByTestId("hashtag-text-root");
    expect(root.textContent).toContain("! ");
    expect(root.textContent).toContain("?");
  });

  it("does not create links for invalid leading underscore", () => {
    render(<HashtagText text="#_invalid #valid" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/tag/valid");
  });

  it("matches hashtags inside URLs (server behavior - no URL detection)", () => {
    // Server parser extracts hashtags regardless of URL context
    // This is consistent with server/lib/hashtags.ts behavior
    render(<HashtagText text="Visit https://example.com/#section" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/tag/section");
  });

  it("does not create links for emails (no hashtag pattern)", () => {
    render(<HashtagText text="Email test@example.com" />);
    const links = screen.queryAllByRole("link");
    expect(links).toHaveLength(0);
    expect(screen.getByText("Email test@example.com")).toBeTruthy();
  });

  it("handles hashtag at start of string", () => {
    render(<HashtagText text="#start middle" />);
    expect(screen.getByRole("link", { name: "#start" })).toBeTruthy();
    const root = screen.getByTestId("hashtag-text-root");
    expect(root.textContent).toContain(" middle");
  });

  it("handles hashtag at end of string", () => {
    render(<HashtagText text="middle #end" />);
    const root = screen.getByTestId("hashtag-text-root");
    expect(root.textContent).toContain("middle ");
    expect(screen.getByRole("link", { name: "#end" })).toBeTruthy();
  });

  it("URL-encodes the normalized tag in href", () => {
    render(<HashtagText text="#café" />);
    const link = screen.getByRole("link");
    // href attribute is URL-encoded by encodeURIComponent
    expect(link.getAttribute("href")).toBe("/tag/caf%C3%A9");
  });

  it("has accessible link attributes", () => {
    render(<HashtagText text="#test" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("applies custom className", () => {
    render(<HashtagText text="#test" className="custom-class" />);
    const container = screen.getByText("#test").parentElement;
    expect(container?.classList.contains("hashtag-text")).toBe(true);
    expect(container?.classList.contains("custom-class")).toBe(true);
  });

  it("segmenter produces correct normalized tags", async () => {
    // Test the segmenter directly (imported from lib)
    const { segmentTextWithHashtags } = await import("@/lib/hashtagParser");
    const segments = segmentTextWithHashtags("#test #hello");
    expect(segments).toHaveLength(3); // hashtag, text, hashtag
    expect(segments[0].type).toBe("hashtag");
    expect(segments[0].normalized).toBe("test");
    expect(segments[2].type).toBe("hashtag");
    expect(segments[2].normalized).toBe("hello");
  });
});
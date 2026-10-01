import { describe, expect, it } from "vitest";
import { postCaption } from "./postCaption";

describe("postCaption", () => {
  it("shows the description the user typed, never the placeholder title", () => {
    expect(postCaption("Untitled photo", "Golden hour at the pier")).toBe(
      "Golden hour at the pier"
    );
    expect(postCaption("Untitled video", "Three tricks to learn today")).toBe(
      "Three tricks to learn today"
    );
  });

  it("keeps a description that is identical to the title", () => {
    expect(postCaption("Profile caption", "Profile caption")).toBe(
      "Profile caption"
    );
  });

  it("falls back to the title when the post has no caption", () => {
    expect(postCaption("Shared photo", "")).toBe("Shared photo");
    expect(postCaption("Shared photo", null)).toBe("Shared photo");
    expect(postCaption("Shared photo", "   ")).toBe("Shared photo");
  });

  it("returns an empty string when neither field carries text", () => {
    expect(postCaption("", "")).toBe("");
    expect(postCaption(null, undefined)).toBe("");
  });

  it("trims surrounding whitespace instead of showing it", () => {
    expect(postCaption("", "  caption  ")).toBe("caption");
    expect(postCaption("  Title  ", "")).toBe("Title");
  });
});

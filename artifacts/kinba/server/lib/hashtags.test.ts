import { describe, it, expect } from "vitest";
import {
  extractHashtags,
  extractVideoHashtags,
  extractTextHashtags,
  extractHypeRoomHashtags,
  extractDropHashtags,
  extractHashtagKeys,
  isValidHashtagFormat,
} from "./hashtags";

describe("hashtag parser — extractHashtags", () => {
  it("extracts a normal hashtag", () => {
    const result = extractHashtags("Hello #world");
    expect(result).toEqual([{ normalized: "world", display: "world" }]);
  });

  it("extracts multiple hashtags", () => {
    const result = extractHashtags("#hello #world #test");
    expect(result).toEqual([
      { normalized: "hello", display: "hello" },
      { normalized: "world", display: "world" },
      { normalized: "test", display: "test" },
    ]);
  });

  it("normalizes uppercase to lowercase for lookup key", () => {
    const result = extractHashtags("#HELLO #Hello #hello");
    expect(result).toEqual([{ normalized: "hello", display: "HELLO" }]);
  });

  it("preserves first-seen display casing", () => {
    const result = extractHashtags("#Hello #HELLO #hello");
    expect(result).toEqual([{ normalized: "hello", display: "Hello" }]);
  });

  it("handles Unicode letters", () => {
    const result = extractHashtags("#café #naïve #résumé");
    expect(result.map(r => r.normalized)).toEqual(["café", "naïve", "résumé"]);
  });

  it("handles underscores", () => {
    const result = extractHashtags("#hello_world #test_case");
    expect(result.map(r => r.normalized)).toEqual(["hello_world", "test_case"]);
  });

  it("handles hyphens", () => {
    const result = extractHashtags("#hello-world #test-case");
    expect(result.map(r => r.normalized)).toEqual(["hello-world", "test-case"]);
  });

  it("handles numbers", () => {
    const result = extractHashtags("#hello123 #test456");
    expect(result.map(r => r.normalized)).toEqual(["hello123", "test456"]);
  });

  it("rejects malformed leading underscore", () => {
    const result = extractHashtags("#_hello #valid");
    expect(result).toEqual([{ normalized: "valid", display: "valid" }]);
  });

  it("handles punctuation boundary", () => {
    const result = extractHashtags("#hello! #world? #test.");
    expect(result.map(r => r.normalized)).toEqual(["hello", "world", "test"]);
  });

  it("handles comma boundary", () => {
    const result = extractHashtags("#hello, #world");
    expect(result.map(r => r.normalized)).toEqual(["hello", "world"]);
  });

  it("handles parentheses boundary", () => {
    const result = extractHashtags("( #hello ) #world");
    expect(result.map(r => r.normalized)).toEqual(["hello", "world"]);
  });

  it("deduplicates hashtags in same content", () => {
    const result = extractHashtags("#hello #hello #world #world");
    expect(result).toEqual([
      { normalized: "hello", display: "hello" },
      { normalized: "world", display: "world" },
    ]);
  });

  it("handles NFC normalization", () => {
    // é can be represented as single code point (U+00E9) or e + combining acute (U+0301)
    const composed = "#café"; // NFC
    const decomposed = "cafe\u0301"; // NFD
    const resultComposed = extractHashtags(composed);
    const resultDecomposed = extractHashtags("#" + decomposed);
    expect(resultComposed[0].normalized).toBe(resultDecomposed[0].normalized);
  });

  it("returns empty array for null/undefined/empty", () => {
    expect(extractHashtags(null)).toEqual([]);
    expect(extractHashtags(undefined)).toEqual([]);
    expect(extractHashtags("")).toEqual([]);
    expect(extractHashtags("   ")).toEqual([]);
  });

  it("handles mixed content with text", () => {
    const result = extractHashtags("Check out #myVideo and #yourVideo too!");
    expect(result.map(r => r.normalized)).toEqual(["myvideo", "yourvideo"]);
  });

  it("handles hashtag at start of string", () => {
    const result = extractHashtags("#start middle #end");
    expect(result.map(r => r.normalized)).toEqual(["start", "end"]);
  });

  it("handles hashtag at end of string", () => {
    const result = extractHashtags("start #middle end#");
    expect(result.map(r => r.normalized)).toEqual(["middle"]);
  });

  it("rejects standalone #", () => {
    const result = extractHashtags("# #hello");
    expect(result).toEqual([{ normalized: "hello", display: "hello" }]);
  });

  it("handles complex Unicode", () => {
    const result = extractHashtags("#日本語 #한국어 #العربية");
    expect(result.length).toBe(3);
  });

  it("handles emoji-like sequences (not matched)", () => {
    const result = extractHashtags("#🎉 #valid");
    // Emoji alone don't match \p{L}\p{N} at start
    expect(result).toEqual([{ normalized: "valid", display: "valid" }]);
  });
});

describe("hashtag parser — helper extractors", () => {
  it("extractVideoHashtags combines title and description", () => {
    const result = extractVideoHashtags("My #Video", "Check #this out");
    expect(result.map(r => r.normalized).sort()).toEqual(["this", "video"]);
  });

  it("extractTextHashtags works on single field", () => {
    const result = extractTextHashtags("Just #one field");
    expect(result.map(r => r.normalized)).toEqual(["one"]);
  });

  it("extractHypeRoomHashtags combines title, topic, description", () => {
    const result = extractHypeRoomHashtags("#Title", "#Topic", "#Description");
    expect(result.map(r => r.normalized).sort()).toEqual(["description", "title", "topic"]);
  });

  it("extractDropHashtags combines title and description", () => {
    const result = extractDropHashtags("#Title", "#Description");
    expect(result.map(r => r.normalized).sort()).toEqual(["description", "title"]);
  });

  it("extractHashtagKeys returns only normalized keys", () => {
    const result = extractHashtagKeys("#Hello #WORLD");
    expect(result).toEqual(["hello", "world"]);
  });
});

describe("hashtag parser — isValidHashtagFormat", () => {
  it("returns true for valid formats", () => {
    expect(isValidHashtagFormat("hello")).toBe(true);
    expect(isValidHashtagFormat("hello_world")).toBe(true);
    expect(isValidHashtagFormat("hello-world")).toBe(true);
    expect(isValidHashtagFormat("hello123")).toBe(true);
    expect(isValidHashtagFormat("café")).toBe(true);
    expect(isValidHashtagFormat("日本語")).toBe(true);
  });

  it("returns false for invalid formats", () => {
    expect(isValidHashtagFormat("_hello")).toBe(false);
    expect(isValidHashtagFormat("-hello")).toBe(false);
    expect(isValidHashtagFormat("hello!")).toBe(false);
    expect(isValidHashtagFormat("hello.world")).toBe(false);
    expect(isValidHashtagFormat("")).toBe(false);
  });
});
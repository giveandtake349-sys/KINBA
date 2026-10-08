import { describe, it, expect } from "vitest";
import {
  extractHashtags,
  extractHashtagKeys,
  isValidHashtagFormat,
  segmentTextWithHashtags,
  type ExtractedHashtag,
  type HashtagSegment,
} from "./hashtagParser";

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
    const composed = "#café";
    const decomposed = "#cafe\u0301";
    const resultComposed = extractHashtags(composed);
    const resultDecomposed = extractHashtags(decomposed);
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
    expect(result).toEqual([{ normalized: "valid", display: "valid" }]);
  });

  it("rejects leading hyphen", () => {
    const result = extractHashtags("#-invalid #valid");
    expect(result).toEqual([{ normalized: "valid", display: "valid" }]);
  });

  it("rejects hash followed by punctuation", () => {
    const result = extractHashtags("#! #? #.");
    expect(result).toEqual([]);
  });

  it("allows underscore in middle/end", () => {
    const result = extractHashtags("#a_b #ab_ #_ab");
    expect(result.map(r => r.normalized)).toEqual(["a_b", "ab_"]);
  });

  it("allows hyphen in middle/end", () => {
    const result = extractHashtags("#a-b #ab- #_ab");
    expect(result.map(r => r.normalized)).toEqual(["a-b", "ab-"]);
  });

  it("allows mixed Unicode and ASCII", () => {
    const result = extractHashtags("#cafe123_world-test");
    expect(result[0].normalized).toBe("cafe123_world-test");
  });

  it("does not persist fallback #jhilik for empty content", () => {
    const result = extractHashtags("Just plain text");
    expect(result).toEqual([]);
    expect(result.some(h => h.normalized === "jhilik")).toBe(false);
  });
});

describe("hashtag parser — extractHashtagKeys", () => {
  it("returns only normalized keys", () => {
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

describe("hashtag parser — segmentTextWithHashtags", () => {
  it("segments plain text without hashtags", () => {
    const result = segmentTextWithHashtags("No hashtags here");
    expect(result).toEqual([{ type: 'text', content: "No hashtags here" }]);
  });

  it("segments text with a single hashtag", () => {
    const result = segmentTextWithHashtags("Hello #world");
    expect(result).toEqual([
      { type: 'text', content: "Hello " },
      { type: 'hashtag', content: "#world", normalized: "world" },
    ]);
  });

  it("segments text with multiple hashtags", () => {
    const result = segmentTextWithHashtags("#hello #world");
    expect(result).toEqual([
      { type: 'hashtag', content: "#hello", normalized: "hello" },
      { type: 'text', content: " " },
      { type: 'hashtag', content: "#world", normalized: "world" },
    ]);
  });

  it("preserves punctuation boundaries", () => {
    const result = segmentTextWithHashtags("#hello! #world?");
    expect(result).toEqual([
      { type: 'hashtag', content: "#hello", normalized: "hello" },
      { type: 'text', content: "! " },
      { type: 'hashtag', content: "#world", normalized: "world" },
      { type: 'text', content: "?" },
    ]);
  });

  it("handles hashtags beside normal text", () => {
    const result = segmentTextWithHashtags("Check #tag1 and #tag2 out");
    expect(result).toEqual([
      { type: 'text', content: "Check " },
      { type: 'hashtag', content: "#tag1", normalized: "tag1" },
      { type: 'text', content: " and " },
      { type: 'hashtag', content: "#tag2", normalized: "tag2" },
      { type: 'text', content: " out" },
    ]);
  });

  it("matches hashtags inside URLs (server behavior - no URL detection)", () => {
    // Server parser extracts hashtags regardless of URL context
    // This is consistent with server/lib/hashtags.ts behavior
    const result = segmentTextWithHashtags("Visit https://example.com/#section");
    expect(result).toEqual([
      { type: 'text', content: "Visit https://example.com/" },
      { type: 'hashtag', content: "#section", normalized: "section" },
    ]);
  });

  it("does not match hashtags inside emails", () => {
    const result = segmentTextWithHashtags("Email me at test@example.com");
    expect(result).toEqual([{ type: 'text', content: "Email me at test@example.com" }]);
  });

  it("preserves first-seen casing in display", () => {
    const result = segmentTextWithHashtags("#HELLO #hello");
    expect(result).toEqual([
      { type: 'hashtag', content: "#HELLO", normalized: "hello" },
      { type: 'text', content: " " },
      { type: 'hashtag', content: "#hello", normalized: "hello" },
    ]);
  });

  it("handles Unicode hashtags", () => {
    const result = segmentTextWithHashtags("Check #café out");
    expect(result).toEqual([
      { type: 'text', content: "Check " },
      { type: 'hashtag', content: "#café", normalized: "café" },
      { type: 'text', content: " out" },
    ]);
  });

  it("handles NFC normalization", () => {
    const composed = "Check #café out";
    const decomposed = "Check #cafe\u0301 out";
    const resultComposed = segmentTextWithHashtags(composed);
    const resultDecomposed = segmentTextWithHashtags(decomposed);
    
    const tagComposed = resultComposed.find(s => s.type === 'hashtag');
    const tagDecomposed = resultDecomposed.find(s => s.type === 'hashtag');
    expect(tagComposed?.normalized).toBe(tagDecomposed?.normalized);
  });

  it("returns empty segment for empty string", () => {
    const result = segmentTextWithHashtags("");
    expect(result).toEqual([{ type: 'text', content: "" }]);
  });

  it("rejects invalid leading underscore in segmentation", () => {
    // Server regex rejects #_invalid (must start with letter/number)
    // So it appears as plain text, then #valid is matched
    const result = segmentTextWithHashtags("#_invalid #valid");
    expect(result).toEqual([
      { type: 'text', content: "#_invalid " },
      { type: 'hashtag', content: "#valid", normalized: "valid" },
    ]);
  });

  it("handles hashtag at start of string", () => {
    const result = segmentTextWithHashtags("#start middle");
    expect(result).toEqual([
      { type: 'hashtag', content: "#start", normalized: "start" },
      { type: 'text', content: " middle" },
    ]);
  });

  it("handles hashtag at end of string", () => {
    const result = segmentTextWithHashtags("middle #end");
    expect(result).toEqual([
      { type: 'text', content: "middle " },
      { type: 'hashtag', content: "#end", normalized: "end" },
    ]);
  });
});
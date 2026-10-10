import { describe, expect, it } from "vitest";
import {
  applyMentionPick,
  findMentionToken,
  removeMentionToken,
  segmentTextWithMentions,
} from "./mentionParser";

describe("mention parser — findMentionToken", () => {
  it("detects a bare @ at the start of the text", () => {
    expect(findMentionToken("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("detects a typed query after whitespace", () => {
    expect(findMentionToken("hey @al", 7)).toEqual({
      start: 4,
      end: 7,
      query: "al",
    });
  });

  it("detects a token at the caret in the middle of a word", () => {
    expect(findMentionToken("hello @bob", 8)).toEqual({
      start: 6,
      end: 10,
      query: "b",
    });
  });

  it("keeps the full word range when the caret sits before trailing text", () => {
    expect(findMentionToken("@asha is here", 4)).toEqual({
      start: 0,
      end: 5,
      query: "ash",
    });
  });

  it("supports underscores in the typed query", () => {
    expect(findMentionToken("@user_name", 10)).toEqual({
      start: 0,
      end: 10,
      query: "user_name",
    });
  });

  it("returns null inside an email address", () => {
    expect(findMentionToken("foo@bar", 7)).toBeNull();
  });

  it("returns null when @ follows a non-space character", () => {
    expect(findMentionToken("hi.@there", 9)).toBeNull();
  });

  it("returns null at caret 0, and bare @ yields an empty query", () => {
    expect(findMentionToken("@ali", 0)).toBeNull();
    expect(findMentionToken("@ali", 1)).toEqual({ start: 0, end: 4, query: "" });
  });

  it("returns null for an out-of-range caret", () => {
    expect(findMentionToken("@ali", 99)).toBeNull();
    expect(findMentionToken("@ali", -1)).toBeNull();
  });

  it("survives backspaces without inventing a token", () => {
    expect(findMentionToken("hello ", 6)).toBeNull();
    expect(findMentionToken("hello @", 7)).toEqual({
      start: 6,
      end: 7,
      query: "",
    });
    expect(findMentionToken("hello ", 5)).toBeNull();
  });
});

describe("mention parser — applyMentionPick", () => {
  it("replaces the typed token with the picked handle", () => {
    const result = applyMentionPick(
      "hey @al",
      { start: 4, end: 7 },
      "@alice"
    );
    expect(result.text).toBe("hey @alice ");
    expect(result.cursor).toBe(11);
  });

  it("inserts at the start with no extra leading space", () => {
    const result = applyMentionPick("@al", { start: 0, end: 3 }, "@alice");
    expect(result.text).toBe("@alice ");
    expect(result.cursor).toBe(7);
  });

  it("does not double-space when text already follows the token", () => {
    const result = applyMentionPick("@al rest", { start: 0, end: 3 }, "@alice");
    expect(result.text).toBe("@alice rest");
    expect(result.cursor).toBe(6);
  });

  it("replaces the full token range so no residue remains", () => {
    const token = findMentionToken("@bob is", 4);
    expect(token).not.toBeNull();
    const result = applyMentionPick("@bob is", token!, "@bobby");
    expect(result.text).toBe("@bobby is");
  });

  it("clamps to the maximum length", () => {
    const result = applyMentionPick("@al", { start: 0, end: 3 }, "@alice", 5);
    expect(result.text).toBe("@alic");
    expect(result.cursor).toBe(5);
  });
});

describe("mention parser — removeMentionToken", () => {
  it("removes the token and collapses trailing whitespace", () => {
    const result = removeMentionToken("hello @al", { start: 6, end: 9 });
    expect(result.text).toBe("hello");
    expect(result.cursor).toBe(5);
  });

  it("removes the token and keeps following text spaced", () => {
    const result = removeMentionToken("@al rest", { start: 0, end: 3 });
    expect(result.text).toBe("rest");
    expect(result.cursor).toBe(0);
  });

  it("handles a mid-sentence token", () => {
    const result = removeMentionToken("hi @al there", { start: 3, end: 6 });
    expect(result.text).toBe("hi there");
    expect(result.cursor).toBe(2);
  });
});

describe("mention parser — segmentTextWithMentions", () => {
  it("returns a single text segment when there is no mention", () => {
    expect(segmentTextWithMentions("plain text")).toEqual([
      { type: "text", content: "plain text" },
    ]);
  });

  it("returns one empty text segment for empty/undefined input", () => {
    expect(segmentTextWithMentions("")).toEqual([
      { type: "text", content: "" },
    ]);
    expect(segmentTextWithMentions(null)).toEqual([
      { type: "text", content: "" },
    ]);
    expect(segmentTextWithMentions(undefined)).toEqual([
      { type: "text", content: "" },
    ]);
  });

  it("segments a single mention", () => {
    expect(segmentTextWithMentions("hey @alice!")).toEqual([
      { type: "text", content: "hey " },
      { type: "mention", content: "@alice", username: "alice" },
      { type: "text", content: "!" },
    ]);
  });

  it("segments multiple mentions", () => {
    const segments = segmentTextWithMentions("@alice meet @bob_1");
    expect(segments).toEqual([
      { type: "mention", content: "@alice", username: "alice" },
      { type: "text", content: " meet " },
      { type: "mention", content: "@bob_1", username: "bob_1" },
    ]);
  });

  it("keeps emails as plain text", () => {
    const segments = segmentTextWithMentions("mail foo@example.com now");
    expect(segments).toEqual([{ type: "text", content: "mail foo@example.com now" }]);
  });

  it("does not linkify handles shorter than three characters", () => {
    const segments = segmentTextWithMentions("@ab @abc");
    expect(segments).toEqual([
      { type: "text", content: "@ab " },
      { type: "mention", content: "@abc", username: "abc" },
    ]);
  });

  it("does not linkify a double @@ (mention after mention char)", () => {
    const segments = segmentTextWithMentions("@@alice");
    expect(segments).toEqual([{ type: "text", content: "@@alice" }]);
  });

  it("links a mention at the very start", () => {
    const segments = segmentTextWithMentions("@alice");
    expect(segments).toEqual([
      { type: "mention", content: "@alice", username: "alice" },
    ]);
  });

  it("caps the handle at the username max length", () => {
    const long = "a".repeat(65);
    const segments = segmentTextWithMentions(`@${long}`);
    expect(segments[0]?.type).toBe("text");
  });

  it("accepts a 64-character handle", () => {
    const handle = "a".repeat(64);
    const segments = segmentTextWithMentions(`@${handle}`);
    expect(segments[0]?.type).toBe("mention");
  });
});

import { describe, expect, it } from "vitest";
import {
  activeReactionEntry,
  adoptSingleReaction,
  applyReactionEntries,
  applySingleReaction,
  tappedReactionType,
  toReactionEntries,
  totalReactionCount,
} from "@/lib/reactionState";

describe("tappedReactionType", () => {
  it("activates the default like when nothing is active", () => {
    expect(tappedReactionType(null)).toBe("like");
    expect(tappedReactionType(undefined)).toBe("like");
  });

  it("removes whatever is already active", () => {
    expect(tappedReactionType("fire")).toBe("fire");
    expect(tappedReactionType("clap")).toBe("clap");
  });
});

describe("applySingleReaction", () => {
  const idle = { reactionCount: 4, viewerReacted: false, viewerReaction: null };

  it("inserts the first reaction", () => {
    expect(applySingleReaction(idle, "love")).toEqual({
      reactionCount: 5,
      viewerReacted: true,
      viewerReaction: "love",
    });
  });

  it("removes when the requested type is already active", () => {
    const state = {
      reactionCount: 5,
      viewerReacted: true,
      viewerReaction: "love" as const,
    };
    expect(applySingleReaction(state, "love")).toEqual({
      reactionCount: 4,
      viewerReacted: false,
      viewerReaction: null,
    });
  });

  it("replaces in place so the total does not move", () => {
    const state = {
      reactionCount: 5,
      viewerReacted: true,
      viewerReaction: "love" as const,
    };
    expect(applySingleReaction(state, "fire")).toEqual({
      reactionCount: 5,
      viewerReacted: true,
      viewerReaction: "fire",
    });
  });

  it("never reports a negative count", () => {
    expect(
      applySingleReaction(
        { reactionCount: 0, viewerReacted: true, viewerReaction: "like" },
        "like"
      ).reactionCount
    ).toBe(0);
  });
});

describe("adoptSingleReaction", () => {
  it("uses the server count when it answers with one", () => {
    expect(
      adoptSingleReaction(
        { reactionCount: 5, viewerReacted: false, viewerReaction: null },
        "fire",
        { reactionCount: 6, viewerReacted: true }
      )
    ).toEqual({
      reactionCount: 6,
      viewerReacted: true,
      viewerReaction: "fire",
    });
  });

  it("derives the count when the endpoint only reports viewerReacted", () => {
    const previous = {
      reactionCount: 5,
      viewerReacted: false,
      viewerReaction: null,
    };
    expect(adoptSingleReaction(previous, "fire", { viewerReacted: true })).toEqual({
      reactionCount: 6,
      viewerReacted: true,
      viewerReaction: "fire",
    });
    expect(
      adoptSingleReaction(
        { reactionCount: 6, viewerReacted: true, viewerReaction: "fire" },
        "fire",
        { viewerReacted: false }
      )
    ).toEqual({
      reactionCount: 5,
      viewerReacted: false,
      viewerReaction: null,
    });
  });

  it("keeps the total stable when the server replaced the type", () => {
    const previous = {
      reactionCount: 6,
      viewerReacted: true,
      viewerReaction: "like" as const,
    };
    expect(adoptSingleReaction(previous, "clap", { viewerReacted: true })).toEqual({
      reactionCount: 6,
      viewerReacted: true,
      viewerReaction: "clap",
    });
  });
});

describe("chip entries", () => {
  const entries = [
    { reaction: "like" as const, count: 3, reactedByMe: false },
    { reaction: "fire" as const, count: 1, reactedByMe: true },
    { reaction: "clap" as const, count: 4, reactedByMe: false },
  ];

  it("finds the viewer's active chip", () => {
    expect(activeReactionEntry(entries)).toBe("fire");
    expect(activeReactionEntry([])).toBeNull();
    expect(activeReactionEntry(null)).toBeNull();
    expect(activeReactionEntry(undefined)).toBeNull();
  });

  it("sums every chip", () => {
    expect(totalReactionCount(entries)).toBe(8);
    expect(totalReactionCount(null)).toBe(0);
  });

  it("adds the first chip", () => {
    expect(applyReactionEntries([], "like")).toEqual([
      { reaction: "like", count: 1, reactedByMe: true },
    ]);
  });

  it("toggles the active chip off and drops it at zero", () => {
    const only = [{ reaction: "fire" as const, count: 1, reactedByMe: true }];
    expect(applyReactionEntries(only, "fire")).toEqual([]);
  });

  it("keeps a shared active chip at a lower count when toggled off", () => {
    const shared = [
      { reaction: "fire" as const, count: 3, reactedByMe: true },
      { reaction: "like" as const, count: 1, reactedByMe: false },
    ];
    expect(applyReactionEntries(shared, "fire")).toEqual([
      { reaction: "fire", count: 2, reactedByMe: false },
      { reaction: "like", count: 1, reactedByMe: false },
    ]);
  });

  it("replaces the held chip, keeping the total unchanged", () => {
    const next = applyReactionEntries(entries, "clap");
    expect(activeReactionEntry(next)).toBe("clap");
    expect(totalReactionCount(next)).toBe(8);
    expect(next.find(entry => entry.reaction === "fire")).toBeUndefined();
    expect(next.find(entry => entry.reaction === "clap")).toEqual({
      reaction: "clap",
      count: 5,
      reactedByMe: true,
    });
    expect(next.some(entry => entry.count === 0)).toBe(false);
  });
});

describe("toReactionEntries", () => {
  it("narrows raw backend strings to the shared vocabulary", () => {
    expect(
      toReactionEntries([
        { reaction: "like", count: 2, reactedByMe: false },
        { reaction: "haha", count: 9, reactedByMe: true },
        { reaction: "fire", count: 1, reactedByMe: true },
      ])
    ).toEqual([
      { reaction: "like", count: 2, reactedByMe: false },
      { reaction: "fire", count: 1, reactedByMe: true },
    ]);
  });

  it("tolerates a missing row", () => {
    expect(toReactionEntries(null)).toEqual([]);
    expect(toReactionEntries(undefined)).toEqual([]);
  });
});

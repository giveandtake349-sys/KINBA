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
  it("activates the single Pookie/Love reaction when nothing is active", () => {
    expect(tappedReactionType(null)).toBe("love");
    expect(tappedReactionType(undefined)).toBe("love");
  });

  it("reports the active reaction so the tap removes it", () => {
    expect(tappedReactionType("love")).toBe("love");
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

  it("removes when the single reaction is already active", () => {
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

  it("never reports a negative count", () => {
    expect(
      applySingleReaction(
        { reactionCount: 0, viewerReacted: true, viewerReaction: "love" },
        "love"
      ).reactionCount
    ).toBe(0);
  });
});

describe("adoptSingleReaction", () => {
  it("uses the server count when it answers with one", () => {
    expect(
      adoptSingleReaction(
        { reactionCount: 5, viewerReacted: false, viewerReaction: null },
        "love",
        { reactionCount: 6, viewerReacted: true }
      )
    ).toEqual({
      reactionCount: 6,
      viewerReacted: true,
      viewerReaction: "love",
    });
  });

  it("derives the count when the endpoint only reports viewerReacted", () => {
    const previous = {
      reactionCount: 5,
      viewerReacted: false,
      viewerReaction: null,
    };
    expect(adoptSingleReaction(previous, "love", { viewerReacted: true })).toEqual({
      reactionCount: 6,
      viewerReacted: true,
      viewerReaction: "love",
    });
    expect(
      adoptSingleReaction(
        { reactionCount: 6, viewerReacted: true, viewerReaction: "love" },
        "love",
        { viewerReacted: false }
      )
    ).toEqual({
      reactionCount: 5,
      viewerReacted: false,
      viewerReaction: null,
    });
  });

  it("keeps the total stable when the server confirms the active reaction", () => {
    const previous = {
      reactionCount: 6,
      viewerReacted: true,
      viewerReaction: "love" as const,
    };
    expect(adoptSingleReaction(previous, "love", { viewerReacted: true })).toEqual({
      reactionCount: 6,
      viewerReacted: true,
      viewerReaction: "love",
    });
  });
});

describe("chip entries", () => {
  const entries = [{ reaction: "love" as const, count: 8, reactedByMe: true }];

  it("finds the viewer's active chip", () => {
    expect(activeReactionEntry(entries)).toBe("love");
    expect(activeReactionEntry([])).toBeNull();
    expect(activeReactionEntry(null)).toBeNull();
    expect(activeReactionEntry(undefined)).toBeNull();
  });

  it("sums the chips", () => {
    expect(totalReactionCount(entries)).toBe(8);
    expect(totalReactionCount(null)).toBe(0);
  });

  it("adds the first chip", () => {
    expect(applyReactionEntries([], "love")).toEqual([
      { reaction: "love", count: 1, reactedByMe: true },
    ]);
  });

  it("toggles the active chip off and drops it at zero", () => {
    const only = [{ reaction: "love" as const, count: 1, reactedByMe: true }];
    expect(applyReactionEntries(only, "love")).toEqual([]);
  });

  it("keeps the active chip at a lower count when toggled off", () => {
    const shared = [{ reaction: "love" as const, count: 3, reactedByMe: true }];
    expect(applyReactionEntries(shared, "love")).toEqual([
      { reaction: "love", count: 2, reactedByMe: false },
    ]);
  });
});

describe("toReactionEntries", () => {
  it("normalizes historical multi-reaction values to the single reaction", () => {
    expect(
      toReactionEntries([
        { reaction: "like", count: 2, reactedByMe: false },
        { reaction: "haha", count: 9, reactedByMe: true },
        { reaction: "fire", count: 1, reactedByMe: true },
        { reaction: "clap", count: 4, reactedByMe: false },
      ])
    ).toEqual([{ reaction: "love", count: 7, reactedByMe: true }]);
  });

  it("keeps a lone legacy row active for its owner", () => {
    expect(
      toReactionEntries([{ reaction: "like", count: 5, reactedByMe: true }])
    ).toEqual([{ reaction: "love", count: 5, reactedByMe: true }]);
  });

  it("drops unknown values", () => {
    expect(
      toReactionEntries([{ reaction: "haha", count: 9, reactedByMe: true }])
    ).toEqual([]);
  });

  it("tolerates a missing row", () => {
    expect(toReactionEntries(null)).toEqual([]);
    expect(toReactionEntries(undefined)).toEqual([]);
  });
});

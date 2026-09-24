/**
 * M-A1/M-A2 — pure validators + service authorization decisions (no DB).
 */
import { describe, expect, it } from "vitest";
import {
  HYPE_ROOM_REACTIONS,
  canUpdateRoomSettings,
  isValidHypeRoomReaction,
  normalizeMentionUserIds,
  validateReplyParent,
} from "./hypeRooms";

describe("M-A1 reaction set", () => {
  it("exposes a small explicit reaction set", () => {
    expect([...HYPE_ROOM_REACTIONS]).toEqual(["like", "love", "fire", "clap"]);
  });

  it("accepts only explicit reaction types", () => {
    for (const r of HYPE_ROOM_REACTIONS) {
      expect(isValidHypeRoomReaction(r)).toBe(true);
    }
    for (const bad of ["", "ok", "LIKE", "thumbsup", "x", "repost"]) {
      expect(isValidHypeRoomReaction(bad)).toBe(false);
    }
  });
});

describe("M-A1 reply parent validation", () => {
  const room = 11;
  const topLevel = {
    id: 3,
    roomId: room,
    parentId: null as number | null,
    hiddenAt: null as Date | null,
  };
  const nested = {
    id: 4,
    roomId: room,
    parentId: 3,
    hiddenAt: null as Date | null,
  };
  const otherRoom = {
    id: 5,
    roomId: 99,
    parentId: null as number | null,
    hiddenAt: null as Date | null,
  };
  const hidden = {
    id: 6,
    roomId: room,
    parentId: null as number | null,
    hiddenAt: new Date(),
  };

  it("allows null/undefined parent (top-level message)", () => {
    expect(validateReplyParent(null, null, room)).toBeNull();
    expect(validateReplyParent(undefined, null, room)).toBeNull();
  });

  it("accepts a same-room top-level parent", () => {
    expect(validateReplyParent(3, topLevel, room)).toBe(3);
  });

  it("rejects nonexistent parent", () => {
    expect(() => validateReplyParent(9, null, room)).toThrow(
      "Message not found."
    );
  });

  it("rejects hidden parent", () => {
    expect(() => validateReplyParent(6, hidden, room)).toThrow(
      "Message not found."
    );
  });

  it("rejects cross-room parent", () => {
    expect(() => validateReplyParent(5, otherRoom, room)).toThrow(
      "Reply target is not in this room."
    );
  });

  it("rejects self-parenting (parent id equals parent.parentId)", () => {
    const self = {
      id: 7,
      roomId: room,
      parentId: 7,
      hiddenAt: null as Date | null,
    };
    expect(() => validateReplyParent(7, self, room)).toThrow(
      "Cannot reply to itself."
    );
  });

  it("rejects nested reply targets (one-level only)", () => {
    expect(() => validateReplyParent(4, nested, room)).toThrow(
      "You can only reply to top-level messages."
    );
  });
});

describe("M-A1 mention normalization", () => {
  it("deduplicates mention ids while preserving order", () => {
    expect(normalizeMentionUserIds([41, 42, 41, 43, 42])).toEqual([
      41, 42, 43,
    ]);
  });

  it("accepts empty mention list", () => {
    expect(normalizeMentionUserIds([])).toEqual([]);
  });

  it("rejects non-positive or non-integer ids", () => {
    expect(() => normalizeMentionUserIds([0])).toThrow("Invalid mention target.");
    expect(() => normalizeMentionUserIds([-1])).toThrow("Invalid mention target.");
    expect(() => normalizeMentionUserIds([1.5])).toThrow(
      "Invalid mention target."
    );
  });
});

describe("M-A2 settings lifecycle gate", () => {
  it("allows scheduled and live rooms only", () => {
    expect(canUpdateRoomSettings("scheduled")).toBe(true);
    expect(canUpdateRoomSettings("live")).toBe(true);
    expect(canUpdateRoomSettings("expired")).toBe(false);
    expect(canUpdateRoomSettings("archived")).toBe(false);
  });
});

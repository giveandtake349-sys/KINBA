import { describe, expect, it } from "vitest";
import {
  ROOM_DESCRIPTION_MAX,
  ROOM_TITLE_MAX,
  ROOM_TITLE_MIN,
  validateRoomDescription,
  validateRoomTitle,
} from "./roomText";

describe("Hype Room text limits", () => {
  it("uses the documented 100 / 500 limits", () => {
    expect(ROOM_TITLE_MIN).toBe(3);
    expect(ROOM_TITLE_MAX).toBe(100);
    expect(ROOM_DESCRIPTION_MAX).toBe(500);
  });

  it("accepts titles inside the 3–100 window", () => {
    expect(validateRoomTitle("Room")).toBeNull();
    expect(validateRoomTitle("x".repeat(ROOM_TITLE_MAX))).toBeNull();
    expect(validateRoomTitle(`  ${"x".repeat(ROOM_TITLE_MAX)}  `)).toBeNull();
  });

  it("rejects titles that are too short or longer than 100 characters", () => {
    expect(validateRoomTitle("")).toBe(
      "Room title must be 3–100 characters."
    );
    expect(validateRoomTitle("ab")).toBe(
      "Room title must be 3–100 characters."
    );
    expect(validateRoomTitle("x".repeat(ROOM_TITLE_MAX + 1))).toBe(
      "Room title must be 3–100 characters."
    );
  });

  it("accepts an empty or exactly 500 character description", () => {
    expect(validateRoomDescription("")).toBeNull();
    expect(validateRoomDescription("   ")).toBeNull();
    expect(validateRoomDescription("x".repeat(ROOM_DESCRIPTION_MAX))).toBeNull();
  });

  it("rejects a description longer than 500 characters", () => {
    expect(validateRoomDescription("x".repeat(ROOM_DESCRIPTION_MAX + 1))).toBe(
      "Room description must be at most 500 characters."
    );
  });

  it("matches the messages the server returns for the same limits", () => {
    // server/hypeRooms.ts throws these exact strings at the service boundary.
    expect(validateRoomTitle("x".repeat(101))).toBe(
      "Room title must be 3–100 characters."
    );
    expect(validateRoomDescription("x".repeat(501))).toBe(
      "Room description must be at most 500 characters."
    );
  });
});

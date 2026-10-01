/**
 * Hype Room title/description limits shared by every client entry point
 * (create form, settings sheet, settings submit).
 *
 * These mirror the server boundary in server/routers.ts + server/hypeRooms.ts;
 * the server stays authoritative and returns the same message text.
 */
export const ROOM_TITLE_MIN = 3;
export const ROOM_TITLE_MAX = 100;
export const ROOM_DESCRIPTION_MAX = 500;

/** Returns the error message for a room title, or null when it is valid. */
export function validateRoomTitle(title: string): string | null {
  const length = title.trim().length;
  if (length < ROOM_TITLE_MIN || length > ROOM_TITLE_MAX) {
    return `Room title must be ${ROOM_TITLE_MIN}–${ROOM_TITLE_MAX} characters.`;
  }
  return null;
}

/** Returns the error message for a room description, or null when it is valid. */
export function validateRoomDescription(description: string): string | null {
  if (description.trim().length > ROOM_DESCRIPTION_MAX) {
    return `Room description must be at most ${ROOM_DESCRIPTION_MAX} characters.`;
  }
  return null;
}

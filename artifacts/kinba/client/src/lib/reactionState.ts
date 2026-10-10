/**
 * Pure reaction state transitions shared by every reaction surface.
 *
 * The server is the single authority for mutation semantics (M2): sending a
 * type inserts it when the viewer has none, removes it when it is already the
 * active type, and replaces any other active type in place. These helpers only
 * mirror that contract so the UI can paint optimistically and then adopt the
 * server's answer — never inventing state the backend would disagree with.
 */
import {
  PRIMARY_REACTION,
  normalizeReaction,
  type ReactionType,
} from "@shared/reactions";

/** Per-type chips (comments, Hype Room messages). */
export type ReactionEntry = {
  reaction: ReactionType;
  count: number;
  reactedByMe: boolean;
};

/** Single-count surfaces (videos, community announcements). */
export type SingleReactionState = {
  reactionCount: number;
  viewerReacted: boolean;
  viewerReaction: ReactionType | null;
};

export type VideoReactionEngagement = {
  reactionCount: number;
  viewerReacted: boolean;
};

function clampCount(value: number): number {
  return value < 0 ? 0 : value;
}

/**
 * The type a tap on the default control should send: remove whatever is
 * already active, otherwise activate the single Pookie/Love reaction.
 */
export function tappedReactionType(
  active: ReactionType | null | undefined
): ReactionType {
  return active ?? PRIMARY_REACTION;
}

/** Optimistic single-count state after requesting `type`. */
export function applySingleReaction(
  state: SingleReactionState,
  type: ReactionType
): SingleReactionState {
  if (!state.viewerReacted) {
    return {
      reactionCount: state.reactionCount + 1,
      viewerReacted: true,
      viewerReaction: type,
    };
  }
  if (state.viewerReaction === type) {
    return {
      reactionCount: clampCount(state.reactionCount - 1),
      viewerReacted: false,
      viewerReaction: null,
    };
  }
  // Replace in place — one reaction per viewer, so the total does not move.
  return { ...state, viewerReacted: true, viewerReaction: type };
}

/**
 * Adopt the server's answer for a single-count surface. `viewerReacted` is the
 * authority; `type` is the row the request just wrote (or removed).
 */
export function adoptSingleReaction(
  previous: SingleReactionState,
  type: ReactionType,
  response: { reactionCount?: number; viewerReacted: boolean }
): SingleReactionState {
  const reacted = Boolean(response.viewerReacted);
  const wasReacted = previous.viewerReacted;
  return {
    reactionCount:
      typeof response.reactionCount === "number"
        ? response.reactionCount
        : clampCount(
            previous.reactionCount + (reacted === wasReacted ? 0 : reacted ? 1 : -1)
          ),
    viewerReacted: reacted,
    viewerReaction: reacted ? type : null,
  };
}

/** Viewer's chip rows typed by the backend as a plain string. */
export function toReactionEntries(
  rows:
    | ReadonlyArray<{ reaction: string; count: number; reactedByMe: boolean }>
    | null
    | undefined
): ReactionEntry[] {
  if (!rows) return [];
  const byReaction = new Map<ReactionType, ReactionEntry>();
  for (const row of rows) {
    // Historical multi-reaction values normalize to the single reaction and
    // merge, so a legacy row still paints as an active Pookie/Love.
    const reaction = normalizeReaction(row.reaction);
    if (!reaction) continue;
    const existing = byReaction.get(reaction);
    if (existing) {
      existing.count += row.count;
      existing.reactedByMe = existing.reactedByMe || row.reactedByMe;
    } else {
      byReaction.set(reaction, {
        reaction,
        count: row.count,
        reactedByMe: row.reactedByMe,
      });
    }
  }
  return [...byReaction.values()];
}

/** The viewer's active chip, or null when they have not reacted. */
export function activeReactionEntry(
  entries: readonly ReactionEntry[] | null | undefined
): ReactionType | null {
  if (!entries) return null;
  return entries.find(entry => entry.reactedByMe)?.reaction ?? null;
}

/** Total reactions across all chips. */
export function totalReactionCount(
  entries: readonly ReactionEntry[] | null | undefined
): number {
  if (!entries) return 0;
  return entries.reduce((total, entry) => total + entry.count, 0);
}

/**
 * Optimistic chip list after requesting `type`: toggling the active chip off,
 * swapping to another type (decrement the old one), or adding the first chip.
 */
export function applyReactionEntries(
  entries: readonly ReactionEntry[],
  type: ReactionType
): ReactionEntry[] {
  const active = activeReactionEntry(entries);
  const next = entries.map(entry => ({
    ...entry,
    reactedByMe: false,
  }));

  if (active === type) {
    return next
      .map(entry =>
        entry.reaction === type
          ? { ...entry, count: clampCount(entry.count - 1) }
          : entry
      )
      .filter(entry => entry.count > 0);
  }

  if (active) {
    const decremented = next
      .map(entry =>
        entry.reaction === active
          ? { ...entry, count: clampCount(entry.count - 1) }
          : entry
      )
      .filter(entry => entry.count > 0);
    const index = decremented.findIndex(entry => entry.reaction === type);
    if (index >= 0) {
      decremented[index] = {
        ...decremented[index],
        count: decremented[index].count + 1,
        reactedByMe: true,
      };
      return decremented;
    }
    return [...decremented, { reaction: type, count: 1, reactedByMe: true }];
  }

  const index = next.findIndex(entry => entry.reaction === type);
  if (index >= 0) {
    next[index] = { ...next[index], count: next[index].count + 1, reactedByMe: true };
    return next;
  }
  return [...next, { reaction: type, count: 1, reactedByMe: true }];
}

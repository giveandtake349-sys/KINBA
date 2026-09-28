import type { MouseEvent } from "react";
import { REACTION_OPTIONS, type ReactionType } from "@shared/reactions";
import "./reactions.css";

const GLYPH_BY_TYPE = new Map(
  REACTION_OPTIONS.map(option => [option.id, option.glyph])
);

/** Neutral glyph used when the pill carries no count to communicate. */
const FALLBACK_GLYPH = REACTION_OPTIONS[0]?.glyph ?? "👍";

export type ReactionSummaryPillProps = {
  /** Total reactions; omit on surfaces that already render the count. */
  count?: number | null;
  /** The viewer's active type — surfaces their glyph in the pill. */
  active?: ReactionType | null;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
};

/**
 * The always-clickable entry point for reaction surfaces (M5): long-press must
 * never be the only way to reach a picker or a reactor list, so every surface
 * renders this small pill next to its reaction zone.
 */
export function ReactionSummaryPill({
  count,
  active,
  onClick,
  disabled = false,
  ariaLabel,
  title,
}: ReactionSummaryPillProps) {
  const hasCount = typeof count === "number";
  // A glyph only adds information when it is the viewer's own reaction, or when
  // the pill is icon-only and the glyph *is* its label.
  const glyph = active
    ? GLYPH_BY_TYPE.get(active)
    : hasCount
      ? null
      : FALLBACK_GLYPH;
  const label =
    ariaLabel ??
    (hasCount
      ? `${count} reaction${count === 1 ? "" : "s"}`
      : "Choose a reaction");

  return (
    <button
      type="button"
      className="reaction-count-pill"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
    >
      {glyph ? (
        <span className="reaction-count-pill__glyph" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      {hasCount ? (
        <span className="reaction-count-pill__value">{count}</span>
      ) : null}
    </button>
  );
}

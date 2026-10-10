import { useState, type MouseEvent } from "react";
import { X } from "lucide-react";
import {
  CONVERSATION_REACTIONS,
  type ConversationReactionEntry,
  type ConversationReactionId,
} from "./shared";
import { ReactionSummaryPill } from "../reactions/ReactionSummaryPill";
import type { LongPressHandlers } from "@/hooks/useLongPress";

/**
 * Shared reaction chips (single Pookie/Love reaction) + optional count pill.
 * Pass `reactions` from backend; `available` filters which options are offered.
 * The expand tray only appears when more than one option exists, so with the
 * single reaction it never renders. Does not invent types the backend rejects.
 *
 * When `longPress` is supplied the whole zone becomes a long-press target
 * (surfaces open the reactor list with it), and `onTotalClick` renders the
 * always-clickable pill that keeps long-press from being the only path to
 * "see who reacted".
 */
export function ReactionBar({
  reactions,
  availableIds,
  onReact,
  disabled,
  busy,
  ariaLabel = "Reactions",
  total,
  active,
  longPress,
  onTotalClick,
}: {
  reactions: ConversationReactionEntry[];
  availableIds?: ReadonlyArray<ConversationReactionId>;
  onReact: (reaction: ConversationReactionId) => void;
  disabled?: boolean;
  busy?: boolean;
  ariaLabel?: string;
  /** Total across all chips — omitted when the surface renders no pill. */
  total?: number;
  active?: ConversationReactionId | null;
  longPress?: LongPressHandlers;
  onTotalClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const [trayOpen, setTrayOpen] = useState(false);
  const options = availableIds
    ? CONVERSATION_REACTIONS.filter(option => availableIds.includes(option.id))
    : CONVERSATION_REACTIONS;
  const canOpenTray = options.length > 1 && !disabled;

  if (options.length === 0) return null;

  return (
    <div
      className="conv-reactions"
      role="group"
      aria-label={ariaLabel}
      {...(longPress ?? {})}
    >
      {onTotalClick ? (
        <ReactionSummaryPill
          count={total ?? 0}
          active={active}
          disabled={disabled}
          ariaLabel="See who reacted"
          title="See who reacted"
          onClick={onTotalClick}
        />
      ) : null}
      {options.map(option => {
        const entry = reactions.find(row => row.reaction === option.id);
        const count = entry?.count ?? 0;
        const mine = entry?.reactedByMe ?? false;
        const visible = count > 0 || mine;
        return (
          <button
            key={option.id}
            type="button"
            className={
              mine ? "conv-reaction conv-reaction--on" : "conv-reaction"
            }
            aria-label={
              mine
                ? `Remove ${option.label} reaction`
                : `React with ${option.label}`
            }
            aria-pressed={mine}
            title={option.label}
            disabled={disabled || busy}
            onClick={event => {
              event.stopPropagation();
              onReact(option.id);
            }}
          >
            <span aria-hidden="true">{option.glyph}</span>
            {visible ? (
              <span className="conv-reaction-count">{count}</span>
            ) : null}
          </button>
        );
      })}
      {canOpenTray ? (
        <button
          type="button"
          className="conv-reaction conv-reaction--add"
          aria-label="More reactions"
          aria-expanded={trayOpen}
          disabled={busy}
          onClick={event => {
            event.stopPropagation();
            setTrayOpen(open => !open);
          }}
        >
          +
        </button>
      ) : null}
      {trayOpen ? (
        <div
          className="conv-reaction-tray"
          role="menu"
          aria-label="Reaction tray"
        >
          {options.map(option => (
            <button
              key={`tray-${option.id}`}
              type="button"
              role="menuitem"
              aria-label={option.label}
              title={option.label}
              disabled={disabled || busy}
              onClick={event => {
                event.stopPropagation();
                setTrayOpen(false);
                onReact(option.id);
              }}
            >
              {option.glyph}
            </button>
          ))}
          <button
            type="button"
            className="conv-reaction-tray-close"
            aria-label="Close reaction tray"
            onClick={event => {
              event.stopPropagation();
              setTrayOpen(false);
            }}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

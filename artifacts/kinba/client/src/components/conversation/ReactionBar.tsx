import { useState } from "react";
import { X } from "lucide-react";
import {
  CONVERSATION_REACTIONS,
  type ConversationReactionEntry,
  type ConversationReactionId,
} from "./shared";

/**
 * Shared reaction chips + expand tray — Hype Room UX reference.
 * Pass `reactions` from backend; `available` filters which options are offered
 * (e.g. single-type surfaces). Does not invent types the backend rejects.
 */
export function ReactionBar({
  reactions,
  availableIds,
  onReact,
  disabled,
  busy,
  ariaLabel = "Reactions",
}: {
  reactions: ConversationReactionEntry[];
  availableIds?: ReadonlyArray<ConversationReactionId>;
  onReact: (reaction: ConversationReactionId) => void;
  disabled?: boolean;
  busy?: boolean;
  ariaLabel?: string;
}) {
  const [trayOpen, setTrayOpen] = useState(false);
  const options = availableIds
    ? CONVERSATION_REACTIONS.filter(option => availableIds.includes(option.id))
    : CONVERSATION_REACTIONS;
  const canOpenTray = options.length > 1 && !disabled;

  if (options.length === 0) return null;

  return (
    <div className="conv-reactions" role="group" aria-label={ariaLabel}>
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
            <X size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

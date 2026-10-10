import { useRef, type FormEvent, type KeyboardEvent } from "react";
import { AtSign, X } from "lucide-react";
import { MentionPicker, type HypeMentionPickerHandle } from "./MentionPicker";
import { findMentionToken, type MentionToken } from "@/lib/mentionParser";
import {
  displayMessageName,
  displayMemberName,
  type MemberRow,
  type MessageRow,
} from "./shared";

export const ROOM_MESSAGE_MAX = 5000;

/**
 * Message composer — normal, reply, mention. Keyboard/safe-area friendly
 * layout; disabled/loading states; no backend model changes.
 * Typing "@" in the textarea opens the member picker in typing mode (the
 * token query filters); the @ button keeps the classic search-box mode.
 */
export function Composer({
  draft,
  sending,
  replyTarget,
  mentionedIds,
  mentionPickerOpen,
  members,
  viewerId,
  hostId,
  mentionQuery,
  onDraftChange,
  onToggleMentionPicker,
  onToggleMention,
  onCancelReply,
  onSubmit,
  onMentionTokenChange,
  onDismissMentionPicker,
}: {
  draft: string;
  sending: boolean;
  replyTarget: MessageRow | null;
  mentionedIds: number[];
  mentionPickerOpen: boolean;
  members: MemberRow[];
  viewerId: number | null;
  hostId: number | null;
  /** Controlled typing-mode filter; undefined renders the search box. */
  mentionQuery?: string;
  onDraftChange: (value: string) => void;
  onToggleMentionPicker: () => void;
  onToggleMention: (userId: number) => void;
  onCancelReply: () => void;
  onSubmit: (event: FormEvent) => void;
  /** Reports the active "@query" token (or null) as the member types. */
  onMentionTokenChange?: (token: MentionToken | null) => void;
  onDismissMentionPicker?: () => void;
}) {
  const pickerRef = useRef<HypeMentionPickerHandle | null>(null);

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      if (mentionPickerOpen) {
        event.preventDefault();
        onDismissMentionPicker?.();
      }
      return;
    }
    if (!mentionPickerOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      pickerRef.current?.moveHighlight(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      pickerRef.current?.moveHighlight(-1);
    } else if (event.key === "Enter") {
      // Enter picks the highlighted member instead of inserting a newline;
      // with an empty list it falls through so the message still sends.
      if (pickerRef.current?.selectHighlighted()) {
        event.preventDefault();
      }
    }
  };

  return (
    <form
      className="hype-room-composer"
      onSubmit={onSubmit}
      noValidate={false}
    >
      {replyTarget ? (
        <div className="hype-room-reply-banner">
          <span>
            Replying to <strong>{displayMessageName(replyTarget)}</strong>
          </span>
          <button
            type="button"
            className="hype-room-icon-btn"
            aria-label="Cancel reply"
            title="Cancel reply"
            onClick={onCancelReply}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {mentionedIds.length > 0 ? (
        <div className="hype-room-mention-chips">
          {mentionedIds.map(id => {
            const member = members.find(row => row.user.id === id);
            return (
              <span key={id} className="hype-room-mention-chip">
                @{member ? displayMemberName(member) : `user${id}`}
                <button
                  type="button"
                  aria-label={`Remove mention ${
                    member ? displayMemberName(member) : id
                  }`}
                  onClick={() => onToggleMention(id)}
                >
                  <X size={14} />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {mentionPickerOpen ? (
        <MentionPicker
          ref={pickerRef}
          members={members}
          viewerId={viewerId}
          hostId={hostId}
          selectedIds={mentionedIds}
          onToggle={onToggleMention}
          query={mentionQuery}
        />
      ) : null}

      <label className="sr-only" htmlFor="hype-room-message">
        Message
      </label>
      <textarea
        id="hype-room-message"
        value={draft}
        onChange={event => {
          onDraftChange(event.target.value);
          const target = event.target;
          onMentionTokenChange?.(
            findMentionToken(
              target.value,
              target.selectionStart ?? target.value.length
            )
          );
        }}
        onKeyDown={handleTextareaKeyDown}
        maxLength={ROOM_MESSAGE_MAX}
        rows={2}
        enterKeyHint="send"
        placeholder={
          replyTarget ? "Write a reply…" : "Send a message to the room…"
        }
      />
      <div className="hype-room-composer-actions">
        <span className="hype-room-composer-count" aria-hidden="true">
          {draft.length}/{ROOM_MESSAGE_MAX}
        </span>
        <button
          type="button"
          className={
            mentionPickerOpen
              ? "hype-room-icon-btn hype-room-icon-btn--on"
              : "hype-room-icon-btn"
          }
          aria-label="Mention members"
          aria-pressed={mentionPickerOpen}
          title="Mention"
          onClick={onToggleMentionPicker}
        >
          <AtSign size={14} />
        </button>
        <button
          type="submit"
          className="primary-btn"
          disabled={sending || draft.trim().length === 0}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}

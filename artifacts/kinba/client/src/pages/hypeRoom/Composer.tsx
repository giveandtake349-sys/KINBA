import type { FormEvent } from "react";
import { AtSign, X } from "lucide-react";
import { MentionPicker } from "./MentionPicker";
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
  onDraftChange,
  onToggleMentionPicker,
  onToggleMention,
  onCancelReply,
  onSubmit,
}: {
  draft: string;
  sending: boolean;
  replyTarget: MessageRow | null;
  mentionedIds: number[];
  mentionPickerOpen: boolean;
  members: MemberRow[];
  viewerId: number | null;
  hostId: number | null;
  onDraftChange: (value: string) => void;
  onToggleMentionPicker: () => void;
  onToggleMention: (userId: number) => void;
  onCancelReply: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
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
            <X size={13} />
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
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {mentionPickerOpen ? (
        <MentionPicker
          members={members}
          viewerId={viewerId}
          hostId={hostId}
          selectedIds={mentionedIds}
          onToggle={onToggleMention}
        />
      ) : null}

      <label className="sr-only" htmlFor="hype-room-message">
        Message
      </label>
      <textarea
        id="hype-room-message"
        value={draft}
        onChange={event => onDraftChange(event.target.value)}
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

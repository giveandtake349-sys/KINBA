import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { MessageCard, type HypeReactionId } from "./MessageCard";
import {
  displayMessageName,
  type MemberRow,
  type MessageRow,
} from "./shared";

/**
 * Mobile-friendly thread bottom sheet for one-level replies (parentId).
 * Uses existing message list data — no extra network requests.
 */
export function ThreadSheet({
  root,
  messages,
  members,
  hostId,
  viewerId,
  isHostViewer,
  isActiveMember,
  canReply,
  replyTarget,
  draft,
  sending,
  busy,
  replyCounts,
  onDraftChange,
  onSend,
  onCancelReply,
  onReact,
  onPin,
  onReport,
  onClose,
}: {
  root: MessageRow;
  messages: MessageRow[];
  members: MemberRow[];
  hostId: number | null;
  viewerId?: number | null;
  isHostViewer: boolean;
  isActiveMember: boolean;
  canReply: boolean;
  replyTarget: MessageRow | null;
  draft: string;
  sending: boolean;
  busy: boolean;
  replyCounts: Map<number, number>;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onCancelReply: () => void;
  onReact: (messageId: number, reaction: HypeReactionId) => void;
  onPin?: (messageId: number) => void;
  onReport?: (messageId: number) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const replies = useMemo(
    () =>
      messages.filter(row => row.message.parentId === root.message.id),
    [messages, root.message.id]
  );

  return (
    <div className="action-modal-layer hype-room-thread-layer" role="presentation">
      <button
        type="button"
        className="action-modal-backdrop"
        aria-label="Close thread"
        onClick={onClose}
      />
      <section
        className="action-modal hype-room-thread-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Thread for message by ${displayMessageName(root)}`}
      >
        <div className="action-modal-head">
          <h2>Thread</h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close thread"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="hype-room-thread-body">
          <ul className="hype-room-message-list">
            <MessageCard
              row={root}
              members={members}
              hostId={hostId}
              viewerId={viewerId ?? null}
              isHostViewer={isHostViewer}
              isActiveMember={isActiveMember}
              canReply={false}
              isPinned={false}
              replyCount={replyCounts.get(root.message.id) ?? 0}
              selected={false}
              busy={busy}
              onSelect={() => {}}
              onReply={() => {}}
              onReact={reaction => onReact(root.message.id, reaction)}
              onPin={onPin ? () => onPin(root.message.id) : undefined}
              onReport={onReport ? () => onReport(root.message.id) : undefined}
            />
            {replies.map(row => (
              <MessageCard
                key={row.message.id}
                row={row}
                members={members}
                hostId={hostId}
                viewerId={viewerId ?? null}
                isHostViewer={isHostViewer}
                isActiveMember={isActiveMember}
                canReply={false}
                isPinned={false}
                replyCount={0}
                selected={false}
                busy={busy}
                onSelect={() => {}}
                onReply={() => {}}
                onReact={reaction => onReact(row.message.id, reaction)}
                onReport={
                  onReport ? () => onReport(row.message.id) : undefined
                }
              />
            ))}
            {replies.length === 0 ? (
              <li className="hype-room-panel-empty">
                No replies yet. Start the conversation.
              </li>
            ) : null}
          </ul>
        </div>

        {canReply ? (
          <form
            className="hype-room-composer hype-room-thread-composer"
            onSubmit={event => {
              event.preventDefault();
              onSend();
            }}
          >
            {replyTarget ? (
              <div className="hype-room-reply-banner">
                <span>
                  Replying to{" "}
                  <strong>{displayMessageName(replyTarget)}</strong>
                </span>
                <button
                  type="button"
                  className="hype-room-icon-btn"
                  aria-label="Cancel reply"
                  onClick={onCancelReply}
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className="hype-room-reply-banner hype-room-reply-banner--thread">
                <span>
                  Replying in thread · <strong>{displayMessageName(root)}</strong>
                </span>
              </div>
            )}
            <label className="sr-only" htmlFor="hype-room-thread-message">
              Reply
            </label>
            <textarea
              id="hype-room-thread-message"
              value={draft}
              onChange={event => onDraftChange(event.target.value)}
              maxLength={5000}
              rows={2}
              placeholder="Write a reply…"
            />
            <div className="hype-room-composer-actions">
              <button
                type="submit"
                className="primary-btn"
                disabled={sending || draft.trim().length === 0}
              >
                {sending ? "Sending…" : "Reply"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}

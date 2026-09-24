import { MessageSquare, Package, Users } from "lucide-react";

/**
 * Compact activity summary — real counts only from already-loaded room data.
 * No extra queries, no fabricated metrics.
 */
export function ActivityBar({
  participantCount,
  messageCount,
  hasDrop,
  dropLabel,
}: {
  participantCount: number | null;
  messageCount: number | null;
  hasDrop: boolean;
  dropLabel?: string;
}) {
  return (
    <section
      className="hype-room-activity"
      aria-label="Room activity"
    >
      <h2 className="hype-room-activity-title">Activity</h2>
      <ul className="hype-room-activity-list">
        <li>
          <Users size={14} aria-hidden="true" />
          <span className="hype-room-activity-value">
            {participantCount != null ? participantCount : "…"}
          </span>
          <span className="hype-room-activity-label">
            {participantCount === 1 ? "participant" : "participants"}
          </span>
        </li>
        <li>
          <MessageSquare size={14} aria-hidden="true" />
          <span className="hype-room-activity-value">
            {messageCount != null ? messageCount : "…"}
          </span>
          <span className="hype-room-activity-label">
            {messageCount === 1 ? "message" : "messages"}
          </span>
        </li>
        {hasDrop ? (
          <li className="hype-room-activity-drop">
            <Package size={14} aria-hidden="true" />
            <span className="hype-room-activity-value">Drop</span>
            <span className="hype-room-activity-label">
              {dropLabel ?? "available"}
            </span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/** Host note — only when room.pinnedMessageId resolves to a real message. */
export function PinnedHostNote({
  authorName,
  body,
  onUnpin,
  canUnpin,
  busy,
}: {
  authorName: string;
  body: string;
  onUnpin?: () => void;
  canUnpin: boolean;
  busy?: boolean;
}) {
  return (
    <aside
      className="hype-room-host-note"
      aria-label="Pinned host note"
    >
      <div className="hype-room-host-note-label">
        <span aria-hidden="true">📌</span> HOST NOTE
        {canUnpin && onUnpin ? (
          <button
            type="button"
            className="hype-room-icon-btn"
            aria-label="Unpin host note"
            title="Unpin"
            disabled={busy}
            onClick={onUnpin}
          >
            ×
          </button>
        ) : null}
      </div>
      <p className="hype-room-host-note-body">
        <strong>{authorName}:</strong> {body}
      </p>
    </aside>
  );
}

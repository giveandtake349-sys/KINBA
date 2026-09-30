/**
 * Host note — only when room.pinnedMessageId resolves to a real message.
 *
 * Compact strip: label row + one body line. Renders nothing on its own when
 * there is no note, so the detail page never shows an empty block.
 */
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

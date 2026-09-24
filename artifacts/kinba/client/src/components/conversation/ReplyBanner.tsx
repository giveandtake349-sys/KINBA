import { X } from "lucide-react";

/** Reply target banner above composer (Hype Room / CommentDrawer pattern). */
export function ReplyBanner({
  label,
  onCancel,
}: {
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="conv-reply-banner" role="status">
      <span>
        Replying to <strong>{label}</strong>
      </span>
      <button
        type="button"
        className="conv-reply-banner-cancel"
        aria-label="Cancel reply"
        onClick={onCancel}
      >
        <X size={14} />
      </button>
    </div>
  );
}

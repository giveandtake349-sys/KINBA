import { FileText, Image as ImageIcon, RotateCcw, Video, X } from "lucide-react";
import { dmDocumentLabel, formatDmFileSize, DM_DOCUMENT_ACCEPT } from "@shared/dmMedia";
import type { DmPendingAttachment } from "@/lib/dmAttachment";
import "./messages.css";

interface AttachmentMenuProps {
  open: boolean;
  onFileSelected: (kind: "image" | "video" | "document", files: FileList) => void;
  onClose: () => void;
}

/**
 * Compact WhatsApp-style "＋" attachment picker.
 *
 * Each menu item IS a <label> with htmlFor pointing to a native
 * <input type="file"> that exactly covers the label (absolute, inset:0,
 * opacity:0, full size, NOT clipped). The user's tap on the label
 * activates the OS file picker natively. The input stays mounted while
 * the menu is open (conditionally rendered with it).
 */
export function AttachmentMenu({
  open,
  onFileSelected,
  onClose,
}: AttachmentMenuProps) {
  if (!open) return null;

  const handleChange = (kind: "image" | "video" | "document", event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      onFileSelected(kind, files);
      onClose();
    }
    // Reset value so the same file can be picked again
    event.target.value = "";
  };

  return (
    <>
      <div className="attach-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="attach-menu" role="menu" aria-label="Send attachment">
        <label
          htmlFor="dm-photo-input"
          className="attach-menu-item"
          role="menuitem"
        >
          <input
            id="dm-photo-input"
            type="file"
            accept="image/*"
            multiple
            className="attach-menu-input"
            onChange={(e) => handleChange("image", e)}
            aria-label="Choose photos to send"
          />
          <span className="attach-menu-icon" aria-hidden="true">
            <ImageIcon size={20} strokeWidth={1.9} />
          </span>
          <span>Photos</span>
        </label>
        <label
          htmlFor="dm-video-input"
          className="attach-menu-item"
          role="menuitem"
        >
          <input
            id="dm-video-input"
            type="file"
            accept="video/*"
            className="attach-menu-input"
            onChange={(e) => handleChange("video", e)}
            aria-label="Choose a video to send"
          />
          <span className="attach-menu-icon" aria-hidden="true">
            <Video size={20} strokeWidth={1.9} />
          </span>
          <span>Video</span>
        </label>
        <label
          htmlFor="dm-document-input"
          className="attach-menu-item"
          role="menuitem"
        >
          <input
            id="dm-document-input"
            type="file"
            accept={DM_DOCUMENT_ACCEPT}
            className="attach-menu-input"
            onChange={(e) => handleChange("document", e)}
            aria-label="Choose a document to send"
          />
          <span className="attach-menu-icon" aria-hidden="true">
            <FileText size={20} strokeWidth={1.9} />
          </span>
          <span>Document</span>
        </label>
      </div>
    </>
  );
}

function AttachmentChip({
  item,
  onRemove,
  onRetry,
}: {
  item: DmPendingAttachment;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const removeLabel = `Remove ${item.name}`;
  const status =
    item.status === "uploading" ? (
      <div className="attach-status" aria-live="polite">
        <div className="attach-progress">
          <span style={{ width: `${item.progress}%` }} />
        </div>
        <span className="attach-percent">{item.progress}%</span>
      </div>
    ) : item.status === "error" ? (
      <div className="attach-status">
        <span className="attach-error" title={item.error}>
          {item.error || "Upload failed"}
        </span>
        <button
          type="button"
          className="attach-retry"
          onClick={() => onRetry(item.id)}
          aria-label={`Retry uploading ${item.name}`}
        >
          <RotateCcw size={14} />
          Retry
        </button>
      </div>
    ) : null;

  const removeButton = (
    <button
      type="button"
      className="attach-remove"
      onClick={() => onRemove(item.id)}
      aria-label={removeLabel}
    >
      <X size={14} strokeWidth={2.5} />
    </button>
  );

  if (item.kind === "image") {
    return (
      <div className="attach-item attach-item--image" role="listitem">
        <div className="attach-preview">
          <img src={item.previewUrl} alt={item.name} />
          {removeButton}
          {item.status === "uploading" && (
            <div className="attach-progress attach-progress--overlay">
              <span style={{ width: `${item.progress}%` }} />
            </div>
          )}
        </div>
        {status}
      </div>
    );
  }

  if (item.kind === "video") {
    return (
      <div className="attach-item attach-item--video" role="listitem">
        <div className="attach-preview attach-preview--video">
          <video src={item.previewUrl} preload="metadata" muted playsInline />
          {removeButton}
        </div>
        <div className="attach-meta">
          <span className="attach-name" title={item.name}>
            {item.name}
          </span>
          <span className="attach-sub">{formatDmFileSize(item.size)}</span>
          {status}
        </div>
      </div>
    );
  }

  const extension = item.name.includes(".")
    ? item.name.slice(item.name.lastIndexOf(".") + 1)
    : "";

  return (
    <div className="attach-item attach-item--doc" role="listitem">
      <span className="attach-doc-icon" aria-hidden="true">
        <FileText size={18} />
      </span>
      <div className="attach-meta">
        <span className="attach-name" title={item.name}>
          {item.name}
        </span>
        <span className="attach-sub">
          {extension ? `${dmDocumentLabel(extension)} • ` : ""}
          {formatDmFileSize(item.size)}
        </span>
        {status}
      </div>
      {removeButton}
    </div>
  );
}

/** Pending attachment previews that sit directly above the composer row. */
export function PendingAttachmentStrip({
  items,
  onRemove,
  onRetry,
}: {
  items: DmPendingAttachment[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="attachment-strip" role="list" aria-label="Pending attachments">
      {items.map(item => (
        <AttachmentChip
          key={item.id}
          item={item}
          onRemove={onRemove}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
}

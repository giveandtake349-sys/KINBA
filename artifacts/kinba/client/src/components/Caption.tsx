import { useEffect, useRef, useState } from "react";

/**
 * Clamp long post/room text to `maxLines` and reveal a "See more"/"See less"
 * toggle when the text overflows the collapsed area, so the full saved text is
 * always reachable without keeping it expanded by default. The toggle stays
 * mounted while expanded — un-clamping the text hides the overflow it was based
 * on — so the text can always be collapsed again.
 *
 * `--caption-toggle-color` lets a surface (e.g. Hype Rooms) recolor the toggle;
 * the default keeps the feed's existing look.
 */
export function Caption({
  text,
  maxLines = 4,
  className = "",
}: {
  text: string;
  maxLines?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    if (ref.current) {
      setIsOverflowing(ref.current.scrollHeight > ref.current.clientHeight);
    }
  }, [text, expanded]);

  if (!text) return null;

  // Expanding drops the line clamp, so the box grows to its content and the
  // overflow probe can no longer tell the text is long. Keep the toggle mounted
  // while expanded, otherwise "See more" would swallow its own way back.
  const showToggle = expanded || isOverflowing;

  return (
    <div className={`caption-container ${className}`} style={{ maxHeight: expanded ? "none" : undefined }}>
      <div
        ref={ref}
        style={{
          maxHeight: expanded ? "none" : undefined,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: expanded ? undefined : maxLines,
          WebkitBoxOrient: "vertical",
        }}
      >
        {text}
      </div>
      {showToggle && (
        <button
          type="button"
          onClick={event => {
            // Cards (feed tiles, room lobby cards) are clickable containers —
            // expanding the text must not also activate them.
            event.stopPropagation();
            setExpanded(e => !e);
          }}
          style={{
            marginTop: 6,
            padding: 0,
            background: "none",
            border: "none",
            color: "var(--caption-toggle-color, rgba(255,255,255,0.8))",
            fontSize: "0.82rem",
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {expanded ? "See less" : "See more"}
        </button>
      )}
    </div>
  );
}

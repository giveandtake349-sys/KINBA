import { ExternalLink, Link2, Pencil } from "lucide-react";

/**
 * Client-side mirror of the server URL allow-list (validateRoomLink).
 * Defense in depth only — the server validates before it ever persists a link.
 * Anything that is not an absolute http(s) URL with a host renders nothing.
 */
export function safeRoomLink(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
}

/** Short human label: host (www stripped) + path when it adds context. */
export function roomLinkLabel(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./i, "");
  const path = parsed.pathname.replace(/\/+$/, "");
  if (!path || path === "/") return host;
  const remainder = `${path}${parsed.search}`.slice(0, 48);
  return `${host}${remainder}`;
}

/**
 * Compact product/website link bar — sits between the room header and the
 * conversation. Renders NOTHING when the room has no link (no empty box, no
 * placeholder, no blank space). Horizontal, single line, no thumbnail.
 */
export function RoomLinkBar({
  url,
  canManage,
  busy,
  onManage,
}: {
  url: string | null | undefined;
  canManage: boolean;
  busy?: boolean;
  onManage?: () => void;
}) {
  const href = safeRoomLink(url);
  if (href == null) return null;

  return (
    <aside className="hype-room-link-bar" aria-label="Room link">
      <a
        className="hype-room-link-bar-anchor"
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={href}
      >
        <span className="hype-room-link-bar-icon" aria-hidden="true">
          <Link2 size={14} />
        </span>
        <span className="hype-room-link-bar-label">{roomLinkLabel(href)}</span>
        <ExternalLink size={13} aria-hidden="true" />
      </a>
      {canManage && onManage ? (
        <button
          type="button"
          className="hype-room-icon-btn hype-room-link-bar-edit"
          aria-label="Edit room link"
          title="Edit link"
          disabled={busy}
          onClick={onManage}
        >
          <Pencil size={13} />
        </button>
      ) : null}
    </aside>
  );
}

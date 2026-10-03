/**
 * JHILIK Direct Messaging attachments — shared vocabulary.
 *
 * Consumed by the DM composer (client), the DM upload route + send validation
 * (server), and the DM tests. Everything here is pure: no I/O, no DOM, no node
 * built-ins, so it can be imported from either side.
 *
 * Storage model (no schema change required): `dm_messages` and
 * `dm_message_requests` already carry mediaUrl / mediaType / mediaWidth /
 * mediaHeight / mediaDuration, so one attachment per message is represented by
 * the existing columns. `mediaUrl` stores the *storage object key*
 * (`dm/<senderId>/<token>-<size>-<name>.<ext>`), never a permanent public URL;
 * the server hands out short-lived signed read URLs only to conversation
 * members.
 */

export const DM_ATTACHMENT_KINDS = ["image", "video", "document"] as const;
export type DMAttachmentKind = (typeof DM_ATTACHMENT_KINDS)[number];

export const DM_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DM_MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const DM_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DM_MAX_VIDEO_DURATION_SECONDS = 30 * 60;

/** How many attachments one composer batch may queue before sending. */
export const DM_MAX_ATTACHMENTS = 6;

/** mediaType token stored for every document attachment (column is varchar 16). */
export const DM_DOCUMENT_MEDIA_TYPE = "document";

export const DM_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export const DM_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;
export const DM_IMAGE_EXTENSIONS = ["jpg", "png", "webp", "gif"] as const;
export const DM_VIDEO_EXTENSIONS = ["mp4", "mov", "webm"] as const;
export const DM_DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
] as const;

export const DM_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
export const DM_VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime";
export const DM_DOCUMENT_ACCEPT = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
].join(",");

export function dmIsAttachmentKind(value: string): value is DMAttachmentKind {
  return (DM_ATTACHMENT_KINDS as readonly string[]).includes(value);
}

export function dmMaxBytesForKind(kind: DMAttachmentKind): number {
  if (kind === "image") return DM_MAX_IMAGE_BYTES;
  if (kind === "video") return DM_MAX_VIDEO_BYTES;
  return DM_MAX_DOCUMENT_BYTES;
}

export function dmIsDocumentExtension(ext: string): boolean {
  const normalized = ext.toLowerCase().replace(/^\./, "");
  return (DM_DOCUMENT_EXTENSIONS as readonly string[]).includes(normalized);
}

export function dmIsImageExtension(ext: string): boolean {
  const normalized = ext.toLowerCase().replace(/^\./, "");
  return (DM_IMAGE_EXTENSIONS as readonly string[]).includes(normalized);
}

export function dmIsVideoExtension(ext: string): boolean {
  const normalized = ext.toLowerCase().replace(/^\./, "");
  return (DM_VIDEO_EXTENSIONS as readonly string[]).includes(normalized);
}

/** Which attachment family a stored `mediaType` token belongs to. */
export function dmKindForMediaType(
  mediaType: string
): DMAttachmentKind | null {
  const value = (mediaType || "").trim().toLowerCase();
  if (value === DM_DOCUMENT_MEDIA_TYPE) return "document";
  if (value.startsWith("image/")) {
    return (DM_IMAGE_MIME_TYPES as readonly string[]).includes(value)
      ? "image"
      : null;
  }
  if (value.startsWith("video/")) {
    return (DM_VIDEO_MIME_TYPES as readonly string[]).includes(value)
      ? "video"
      : null;
  }
  return null;
}

export function dmMediaTypeIsAllowed(mediaType: string): boolean {
  return dmKindForMediaType(mediaType) !== null;
}

const DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
};

export function dmDocumentContentType(ext: string): string {
  return (
    DOCUMENT_CONTENT_TYPES[ext.toLowerCase().replace(/^\./, "")] ??
    "application/octet-stream"
  );
}

const DOCUMENT_LABELS: Record<string, string> = {
  pdf: "PDF",
  doc: "DOC",
  docx: "DOCX",
  xls: "XLS",
  xlsx: "XLSX",
  ppt: "PPT",
  pptx: "PPTX",
  txt: "TXT",
};

export function dmDocumentLabel(ext: string): string {
  const normalized = ext.toLowerCase().replace(/^\./, "");
  const label = DOCUMENT_LABELS[normalized] ?? normalized.toUpperCase();
  return label || "FILE";
}

const KNOWN_EXTENSIONS = new Set<string>([
  ...DM_IMAGE_EXTENSIONS,
  ...DM_VIDEO_EXTENSIONS,
  ...DM_DOCUMENT_EXTENSIONS,
  "jpeg",
  "jpe",
  "mpeg",
  "mkv",
]);

/**
 * Storage keys only allow `[A-Za-z0-9._-]`, so the visible file name is
 * normalized here *before* upload — the recipient therefore always sees the
 * same sanitized name the key was built from (no path segments, no traversal).
 */
export function dmSafeBaseName(fileName: string): string {
  const withoutPath = String(fileName || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop() as string;
  let base = withoutPath.trim().replace(/^\.+/, "");
  const lastDot = base.lastIndexOf(".");
  if (lastDot > 0) {
    const ext = base.slice(lastDot + 1).toLowerCase();
    if (KNOWN_EXTENSIONS.has(ext)) base = base.slice(0, lastDot);
  }
  base = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[.\-_]+/, "")
    .replace(/[.\-_]+$/, "");
  // storagePut() appends `_<8 hex>` before the extension; make sure a user file
  // that already looks like that cannot confuse parseDmObjectKey().
  base = base.replace(/_[0-9a-f]{8}$/i, "");
  if (base.length > 64) {
    base = base.slice(0, 64).replace(/[.\-_]+$/, "");
  }
  return base || "attachment";
}

export type DmObjectKeyInfo = {
  /** Exact storage object key, including the collision hash added on write. */
  key: string;
  senderId: number;
  size: number;
  /** Display file name without extension (storage hash removed). */
  baseName: string;
  ext: string;
};

const DM_KEY_PATTERN = /^(\d+)\/([0-9a-f]{8})-(\d{1,12})-([^/]+)$/;

/**
 * Parses a DM object key out of either a bare key or a full storage URL
 * (public base, r2.dev, signed S3 endpoint …). Returns null for anything that
 * is not a well-formed `dm/<senderId>/<token>-<size>-<name>.<ext>` key.
 */
export function parseDmObjectKey(source: string): DmObjectKeyInfo | null {
  const raw = (source || "").trim();
  if (!raw) return null;

  let pathPart = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathPart = decodeURIComponent(new URL(raw).pathname);
    } catch {
      return null;
    }
  } else {
    pathPart = decodeURIComponent(raw.split("?")[0].split("#")[0]);
  }
  pathPart = pathPart.replace(/\\/g, "/");

  const marker = "/dm/";
  const markerIndex = pathPart.lastIndexOf(marker);
  let rest: string;
  if (markerIndex >= 0) {
    rest = pathPart.slice(markerIndex + marker.length);
  } else if (pathPart.startsWith("dm/")) {
    rest = pathPart.slice("dm/".length);
  } else {
    return null;
  }

  const match = DM_KEY_PATTERN.exec(rest);
  if (!match) return null;

  const senderId = Number(match[1]);
  const size = Number(match[3]);
  const fileName = match[4];
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) return null;
  const ext = fileName.slice(lastDot + 1).toLowerCase();
  const stem = fileName.slice(0, lastDot);
  const baseName = stem.replace(/_[0-9a-f]{8}$/i, "") || "attachment";

  if (!Number.isSafeInteger(senderId) || senderId < 1) return null;
  if (!Number.isSafeInteger(size) || size < 0) return null;

  return {
    // Canonical object key: sender folder + `token-size-name.ext` exactly as
    // storage wrote it (round-trips through parseDmObjectKey without loss).
    key: `dm/${senderId}/${match[2]}-${match[3]}-${fileName}`,
    senderId,
    size,
    baseName,
    ext,
  };
}

export function buildDmObjectKey(
  senderId: number,
  parts: { token: string; size: number; baseName: string; ext: string }
): string {
  const token = parts.token.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 8);
  const safeToken = (token || "00000000").padEnd(8, "0");
  return `dm/${senderId}/${safeToken}-${parts.size}-${parts.baseName}.${parts.ext}`;
}

/**
 * One-line inbox preview for a conversation's last message: the caption when
 * there is one, otherwise a kind label for the attachment.
 */
export function dmConversationPreview(
  lastMessage:
    | {
        body?: string | null;
        mediaUrl?: string | null;
        mediaType?: string | null;
      }
    | null
    | undefined
): string {
  if (!lastMessage) return "No messages yet";
  const body = (lastMessage.body || "").trim();
  if (body) return body;
  if (!lastMessage.mediaUrl) return "No messages yet";
  const kind = dmKindForMediaType(lastMessage.mediaType || "") ?? "image";
  if (kind === "document") return "📄 Document";
  if (kind === "video") return "🎬 Video";
  return "📷 Photo";
}

/** Human-readable size, e.g. `2.8 MB`, `8.4 MB`, `12 KB`. */
export function formatDmFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * JHILIK DM attachment helpers (client side).
 *
 * Reuses the existing authenticated upload transport style (Bearer session +
 * `apiUrl()`), but posts to the dedicated `POST /api/dm/upload` route so the
 * server can sniff the real file type, enforce size limits, and namespace the
 * object under `dm/<senderId>/…`. Upload progress comes from real
 * XMLHttpRequest upload events — nothing here is simulated.
 */
import { apiUrl } from "@/lib/api";
import { getVideoMetadata } from "@/lib/mediaUpload";
import {
  DM_ATTACHMENT_KINDS,
  DM_IMAGE_MIME_TYPES,
  DM_MAX_VIDEO_DURATION_SECONDS,
  type DMAttachmentKind,
  dmIsDocumentExtension,
  dmMaxBytesForKind,
  formatDmFileSize,
  parseDmObjectKey,
} from "@shared/dmMedia";

export type DmMessageMedia = {
  mediaUrl: string;
  mediaType: string;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  mediaDuration?: number | null;
};

export type DmUploadedMedia = {
  key: string;
  url: string;
  mediaType: string;
  name: string;
  size: number;
  kind: DMAttachmentKind;
};

export type DmPendingAttachment = {
  id: string;
  kind: DMAttachmentKind;
  file: File;
  name: string;
  size: number;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  progress: number;
  media?: DmMessageMedia;
  error?: string;
};

export type DmSendPayload = {
  body: string;
  media?: DmMessageMedia;
  attachmentId: string | null;
};

function extensionOf(fileName: string) {
  const withoutPath = String(fileName || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop() as string;
  const lastDot = withoutPath.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return withoutPath.slice(lastDot + 1).toLowerCase();
}

function sizeErrorLabel(kind: DMAttachmentKind) {
  if (kind === "image") return "Images";
  if (kind === "video") return "Videos";
  return "Documents";
}

/** Client-side pre-flight check mirroring the server rules (server wins). */
export function validateDmFile(kind: DMAttachmentKind, file: File): void {
  if (!file || file.size <= 0) throw new Error("That file is empty.");
  const maxBytes = dmMaxBytesForKind(kind);
  if (file.size > maxBytes) {
    throw new Error(
      `${sizeErrorLabel(kind)} must be ${formatDmFileSize(maxBytes)} or smaller.`
    );
  }
  if (kind === "image") {
    const type = (file.type || "").toLowerCase().split(";")[0];
    if (!(DM_IMAGE_MIME_TYPES as readonly string[]).includes(type)) {
      throw new Error("Choose a JPG, PNG, WEBP, or GIF image.");
    }
    return;
  }
  if (kind === "video") {
    const type = (file.type || "").toLowerCase();
    if (!type.startsWith("video/")) {
      throw new Error("Choose an MP4, MOV, or WebM video.");
    }
    return;
  }
  if (!dmIsDocumentExtension(extensionOf(file.name))) {
    throw new Error("Choose a PDF, Word, Excel, PowerPoint, or text file.");
  }
}

function readImageSize(file: File): Promise<{ width: number; height: number }> {
  const previewUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      URL.revokeObjectURL(previewUrl);
      image.remove();
    };
    image.onload = () => {
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      cleanup();
      if (!width || !height) {
        reject(new Error("The image dimensions could not be read."));
        return;
      }
      resolve({ width, height });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("This image could not be previewed."));
    };
    image.src = previewUrl;
  });
}

/**
 * Real intrinsic media metadata used for the mediaWidth / mediaHeight /
 * mediaDuration columns. Videos are probed *before* upload so an oversized
 * duration never reaches storage.
 */
export async function probeDmMedia(
  kind: DMAttachmentKind,
  file: File
): Promise<{ width?: number; height?: number; duration?: number }> {
  if (kind === "image") {
    const size = await readImageSize(file);
    return { width: size.width, height: size.height };
  }
  if (kind === "video") {
    const meta = await getVideoMetadata(file, {
      maxDurationSeconds: DM_MAX_VIDEO_DURATION_SECONDS,
    });
    return {
      width: meta.width,
      height: meta.height,
      duration: meta.durationSeconds,
    };
  }
  return {};
}

type UploadResponse = {
  error?: string;
  key?: string;
  url?: string;
  mediaType?: string;
  name?: string;
  size?: number;
  kind?: string;
};

function readJson(raw: string): UploadResponse {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as UploadResponse)
      : {};
  } catch {
    return {};
  }
}

export type DmUploadHandle = {
  promise: Promise<DmUploadedMedia>;
  abort: () => void;
};

/**
 * Uploads one attachment with real byte progress. Returns a handle so the
 * composer can cancel an in-flight upload when the user removes the chip.
 */
export function startDmUpload(options: {
  kind: DMAttachmentKind;
  file: File;
  accessToken?: string | null;
  onProgress?: (percent: number) => void;
}): DmUploadHandle {
  const { kind, file, accessToken, onProgress } = options;
  const xhr = new XMLHttpRequest();

  const promise = new Promise<DmUploadedMedia>((resolve, reject) => {
    xhr.open("POST", apiUrl("/api/dm/upload"));
    xhr.responseType = "text";
    if (accessToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    }

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      onProgress?.(Math.max(0, Math.min(100, percent)));
    };
    xhr.upload.onload = () => onProgress?.(100);
    xhr.onload = () => {
      const payload = readJson(xhr.responseText);
      if (
        xhr.status >= 200 &&
        xhr.status < 300 &&
        payload.url &&
        payload.mediaType &&
        payload.key
      ) {
        resolve({
          key: payload.key,
          url: payload.url,
          mediaType: payload.mediaType,
          name: payload.name || file.name,
          size: payload.size ?? file.size,
          kind,
        });
        return;
      }
      reject(
        new Error(
          payload.error ||
            `Upload failed with HTTP ${xhr.status || 0}. Please try again.`
        )
      );
    };
    xhr.onerror = () => {
      reject(new Error("Upload failed. Check your connection and try again."));
    };
    xhr.ontimeout = () => {
      reject(new Error("Upload timed out. Please try again."));
    };
    xhr.onabort = () => {
      const abort = new Error("Upload cancelled.");
      abort.name = "AbortError";
      reject(abort);
    };

    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file, file.name);
    xhr.send(form);
  });

  return { promise, abort: () => xhr.abort() };
}

/**
 * What actually gets sent: text-only, attachment-only, or text + attachment.
 * Multiple queued images become one message each (the DM schema holds a single
 * attachment per message) with the caption riding on the first one.
 */
export function buildDmSendPayloads(
  text: string,
  attachments: DmPendingAttachment[]
): DmSendPayload[] {
  const trimmed = text.trim();
  const ready = attachments.filter(
    attachment => attachment.status === "ready" && attachment.media
  );
  if (ready.length === 0) {
    return trimmed ? [{ body: trimmed, attachmentId: null }] : [];
  }
  return ready.map((attachment, index) => ({
    body: index === 0 ? trimmed : "",
    media: attachment.media,
    attachmentId: attachment.id,
  }));
}

/** Display metadata (safe name + size) recovered from a DM media URL/key. */
export function parseDmMediaDisplay(
  source: string | null | undefined
): { name: string; ext: string; size: number } | null {
  const info = source ? parseDmObjectKey(source) : null;
  if (!info) return null;
  return { name: `${info.baseName}.${info.ext}`, ext: info.ext, size: info.size };
}

export function isDmAttachmentKind(value: string): value is DMAttachmentKind {
  return (DM_ATTACHMENT_KINDS as readonly string[]).includes(value);
}

/**
 * JHILIK Direct Messaging attachments.
 *
 * One module owns the DM attachment lifecycle on the server:
 *   1. `registerDmUploadRoute` — authenticated `POST /api/dm/upload` that sniffs
 *      the real file type from magic bytes, enforces per-kind size limits, and
 *      stores the bytes in the existing R2 storage abstraction under
 *      `dm/<senderId>/…` (traversal-safe via storage.normalizeKey()).
 *   2. `resolveOwnedDmMedia` — send-time validation for
 *      `directMessages.sendMessage` / `sendMessageRequest`: the media URL must
 *      map to a `dm/<senderId>/…` object the *sender* uploaded, the stored
 *      `mediaType` must be allow-listed, and size/extension must match.
 *   3. `signDmMessageMediaUrl` — short-lived signed read URLs, only ever handed
 *      out after the caller has passed conversation membership checks.
 *
 * No schema change: dm_messages.mediaUrl stores the object key and the
 * existing mediaType / mediaWidth / mediaHeight / mediaDuration columns hold
 * the rest.
 */
import type { Express, NextFunction, Request, Response } from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DM_DOCUMENT_MEDIA_TYPE,
  DM_MAX_VIDEO_BYTES,
  type DMAttachmentKind,
  buildDmObjectKey,
  dmDocumentContentType,
  dmIsAttachmentKind,
  dmIsDocumentExtension,
  dmIsImageExtension,
  dmIsVideoExtension,
  dmKindForMediaType,
  dmMaxBytesForKind,
  dmSafeBaseName,
  formatDmFileSize,
  parseDmObjectKey,
} from "@shared/dmMedia";
import { rateLimit } from "./rateLimiter";
import { storageGetSignedUrl, storageKeyFromUrl, storagePut } from "./storage";
import { authenticate } from "./authenticate";

export type DmMessageMedia = {
  mediaUrl: string;
  mediaType: string;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  mediaDuration?: number | null;
};

export type DmUploadValidation = {
  mediaType: string;
  ext: string;
  baseName: string;
  contentType: string;
  size: number;
};

const TEXT_SNIFF_BYTES = 4096;
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];

function startsWithBytes(buffer: Buffer, bytes: readonly number[], offset = 0) {
  if (buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function ascii(buffer: Buffer, offset: number, length: number) {
  if (buffer.length < offset + length) return "";
  return buffer.subarray(offset, offset + length).toString("latin1");
}

type SniffedFile = { mime: string; ext: string };

function sniffImage(buffer: Buffer): SniffedFile | null {
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff]))
    return { mime: "image/jpeg", ext: "jpg" };
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: "image/png", ext: "png" };
  if (ascii(buffer, 0, 4) === "GIF8") return { mime: "image/gif", ext: "gif" };
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 4) === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  return null;
}

function sniffVideo(buffer: Buffer): SniffedFile | null {
  if (ascii(buffer, 4, 4) === "ftyp") {
    const brand = ascii(buffer, 8, 4);
    return brand === "qt  "
      ? { mime: "video/quicktime", ext: "mov" }
      : { mime: "video/mp4", ext: "mp4" };
  }
  if (startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    // Matroska/WebM share the EBML magic; only the WebM DocType is supported.
    const head = buffer.subarray(0, 64).toString("latin1");
    if (head.includes("webm")) return { mime: "video/webm", ext: "webm" };
    return null;
  }
  return null;
}

function extFromName(originalName: string) {
  const withoutPath =
    (originalName || "").replace(/\\/g, "/").split("/").pop() || "";
  const lastDot = withoutPath.lastIndexOf(".");
  const rawExt = lastDot > 0 ? withoutPath.slice(lastDot + 1).toLowerCase() : "";
  return rawExt.replace(/[^a-z0-9]/g, "");
}

function sniffDocument(buffer: Buffer, originalName: string): SniffedFile | null {
  const nameExt = extFromName(originalName);

  if (ascii(buffer, 0, 4) === "%PDF") return { mime: "application/pdf", ext: "pdf" };

  if (startsWithBytes(buffer, ZIP_LOCAL_HEADER)) {
    // OOXML packages (docx/xlsx/pptx) are ZIP containers — the concrete type
    // comes from the file name, already restricted to the allow-list.
    if (nameExt === "docx" || nameExt === "xlsx" || nameExt === "pptx")
      return { mime: dmDocumentContentType(nameExt), ext: nameExt };
    return null;
  }

  if (startsWithBytes(buffer, OLE2_SIGNATURE)) {
    if (nameExt === "doc" || nameExt === "xls" || nameExt === "ppt")
      return { mime: dmDocumentContentType(nameExt), ext: nameExt };
    return null;
  }

  // Plain text has no magic number: require a text extension and no NUL bytes
  // so binary payloads cannot masquerade as .txt documents.
  if (
    nameExt === "txt" &&
    !buffer.subarray(0, Math.min(TEXT_SNIFF_BYTES, buffer.length)).includes(0)
  )
    return { mime: "text/plain", ext: "txt" };

  return null;
}

/**
 * Server-side attachment validation. The declared client MIME type is ignored:
 * the type comes from magic bytes, and document sub-formats additionally come
 * from an allow-listed extension on a container we positively identified.
 * Every error message starts with "Attachment" so the tRPC layer can map it to
 * BAD_REQUEST.
 */
export function validateDmUpload(input: {
  kind: DMAttachmentKind;
  buffer: Buffer;
  originalName: string;
}): DmUploadValidation {
  const { kind, buffer, originalName } = input;
  const size = buffer.length;
  if (size <= 0) throw new Error("Attachment is empty.");
  const maxBytes = dmMaxBytesForKind(kind);
  if (size > maxBytes) {
    throw new Error(`Attachments must be ${formatDmFileSize(maxBytes)} or smaller.`);
  }

  const baseName = dmSafeBaseName(originalName);

  if (kind === "image") {
    const sniffed = sniffImage(buffer);
    if (!sniffed)
      throw new Error(
        "Attachment is not a supported image. Choose a JPG, PNG, WEBP, or GIF."
      );
    return {
      mediaType: sniffed.mime,
      ext: sniffed.ext,
      baseName,
      contentType: sniffed.mime,
      size,
    };
  }

  if (kind === "video") {
    const sniffed = sniffVideo(buffer);
    if (!sniffed)
      throw new Error(
        "Attachment is not a supported video. Choose an MP4, MOV, or WebM video."
      );
    return {
      mediaType: sniffed.mime,
      ext: sniffed.ext,
      baseName,
      contentType: sniffed.mime,
      size,
    };
  }

  const sniffed = sniffDocument(buffer, originalName);
  if (!sniffed || !dmIsDocumentExtension(sniffed.ext))
    throw new Error(
      "Attachment is not a supported document. Choose a PDF, Word, Excel, PowerPoint, or text file."
    );
  return {
    mediaType: DM_DOCUMENT_MEDIA_TYPE,
    ext: sniffed.ext,
    baseName,
    contentType: sniffed.mime,
    size,
  };
}

function uploadToken() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The attachment could not be uploaded. Please try again.";
}

/**
 * Authenticated, rate-limited DM upload. Authentication runs *before* multer
 * touches disk so anonymous callers cannot fill the temp directory.
 */
export function registerDmUploadRoute(app: Express) {
  const receive = multer({
    dest: path.join(os.tmpdir(), "kinba-dm-uploads"),
    limits: { files: 1, fileSize: DM_MAX_VIDEO_BYTES },
  });

  const receiveFile = (req: Request, res: Response, next: NextFunction) => {
    const single = receive.single("file") as unknown as (
      r: Request,
      s: Response,
      cb: (error?: unknown) => void
    ) => void;
    single(req, res, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      const message =
        error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
          ? `Attachments must be ${formatDmFileSize(DM_MAX_VIDEO_BYTES)} or smaller.`
          : error instanceof multer.MulterError
            ? `Upload form error: ${error.code}.`
            : "The attachment could not be uploaded.";
      res.status(400).json({ error: message });
    });
  };

  const requireUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const user = await authenticate(req);
      if (!user) {
        res.status(401).json({ error: "Please sign in before uploading." });
        return;
      }
      res.locals.dmUser = user;
      next();
    } catch (error) {
      console.error("[DMAupload] authentication failed", error);
      res.status(401).json({ error: "Please sign in before uploading." });
    }
  };

  app.post(
    "/api/dm/upload",
    rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "dmup" }),
    requireUser,
    receiveFile,
    async (req: Request, res: Response) => {
      const temporaryPath = req.file?.path;
      try {
        const user = res.locals.dmUser as { id: number } | undefined;
        if (!user) {
          res.status(401).json({ error: "Please sign in before uploading." });
          return;
        }
        const kind = String(req.body?.kind ?? "");
        if (!dmIsAttachmentKind(kind)) {
          res.status(400).json({ error: "Choose a photo, video, or document." });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: "Choose a file to send." });
          return;
        }
        const buffer = await fs.readFile(req.file.path);
        const validated = validateDmUpload({
          kind,
          buffer,
          originalName: req.file.originalname || "attachment",
        });
        const key = buildDmObjectKey(user.id, {
          token: uploadToken(),
          size: buffer.length,
          baseName: validated.baseName,
          ext: validated.ext,
        });
        const fileName = `${validated.baseName}.${validated.ext}`;
        const stored = await storagePut(key, buffer, validated.contentType, {
          contentDisposition: `inline; filename="${fileName}"`,
        });
        res.status(201).json({
          key: stored.key,
          url: stored.url,
          kind,
          mediaType: validated.mediaType,
          contentType: validated.contentType,
          name: fileName,
          size: buffer.length,
        });
      } catch (error) {
        const message = errorMessage(error);
        if (message.startsWith("Attachment")) {
          res.status(400).json({ error: message });
          return;
        }
        console.error("[DMAupload] storage failure", error);
        res
          .status(500)
          .json({ error: "The attachment could not be uploaded. Please try again." });
      } finally {
        if (temporaryPath)
          await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
  );
}

function lookupDmKey(source: string): string | null {
  const trimmed = (source || "").trim();
  if (!trimmed || trimmed.length > 1024) return null;
  try {
    const key = storageKeyFromUrl(trimmed);
    if (key) return key;
  } catch {
    // Storage is not configured (or the URL points at a foreign host).
  }
  const parsed = parseDmObjectKey(trimmed);
  return parsed ? parsed.key : null;
}

function positiveInt(value: number | null | undefined) {
  return Number.isFinite(value as number) && (value as number) > 0
    ? Math.round(value as number)
    : null;
}

function mediaTypeForExtension(ext: string): string | null {
  if (dmIsDocumentExtension(ext)) return DM_DOCUMENT_MEDIA_TYPE;
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "mp4") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return null;
}

/**
 * Send-time media validation. Accepts only objects the sender uploaded under
 * `dm/<senderId>/`, and normalizes everything before it reaches the database.
 * Throws `Attachment …` messages (mapped to BAD_REQUEST by the router).
 */
export function resolveOwnedDmMedia(
  senderId: number,
  media: DmMessageMedia
): DmMessageMedia {
  const key = lookupDmKey(media.mediaUrl);
  const info = key ? parseDmObjectKey(key) : null;
  if (!info || info.senderId !== senderId)
    throw new Error("Attachment upload not found.");

  // A missing mediaType (e.g. a stored request row) is recovered from the
  // sniffed extension; anything else must be part of the allow-list.
  const mediaType =
    (media.mediaType || "").trim().toLowerCase() ||
    (mediaTypeForExtension(info.ext) ?? "");
  const kind = dmKindForMediaType(mediaType);
  if (!kind) throw new Error("Attachment type is not allowed.");

  if (info.size <= 0 || info.size > dmMaxBytesForKind(kind))
    throw new Error("Attachment is too large.");

  const extensionOk =
    (kind === "image" && dmIsImageExtension(info.ext)) ||
    (kind === "video" && dmIsVideoExtension(info.ext)) ||
    (kind === "document" && dmIsDocumentExtension(info.ext));
  if (!extensionOk) throw new Error("Attachment type is not allowed.");

  return {
    mediaUrl: info.key,
    mediaType,
    mediaWidth: positiveInt(media.mediaWidth),
    mediaHeight: positiveInt(media.mediaHeight),
    mediaDuration: positiveInt(media.mediaDuration),
  };
}

type SignedEntry = { url: string; expiresAt: number };
// Presigned GETs live for 1h (server/storage.ts). Re-signing on every 5s poll
// would change the URL string and make <img> reload, so cache just shy of the
// expiry instead.
const SIGNED_TTL_MS = 55 * 60_000;
const SIGNED_CACHE_LIMIT = 400;
const signedCache = new Map<string, SignedEntry>();

export function clearDmSignedUrlCache() {
  signedCache.clear();
}

/** Short-lived read URL for a DM object key. Never called for non-members. */
export async function signDmMessageMediaUrl(key: string): Promise<string> {
  const now = Date.now();
  const cached = signedCache.get(key);
  if (cached && cached.expiresAt > now) return cached.url;

  const url = await storageGetSignedUrl(key);
  if (signedCache.size >= SIGNED_CACHE_LIMIT) {
    for (const [cacheKey, entry] of signedCache) {
      if (entry.expiresAt <= now) signedCache.delete(cacheKey);
    }
    if (signedCache.size >= SIGNED_CACHE_LIMIT) signedCache.clear();
  }
  signedCache.set(key, { url, expiresAt: now + SIGNED_TTL_MS });
  return url;
}

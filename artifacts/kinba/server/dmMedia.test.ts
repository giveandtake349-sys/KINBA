/**
 * JHILIK DM attachment — server validation, ownership, and signed-read tests.
 *
 * Everything here is pure or mocked: no database, no R2, no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DM_MAX_IMAGE_BYTES,
  DM_MAX_VIDEO_BYTES,
} from "@shared/dmMedia";

const storageMocks = vi.hoisted(() => ({
  storageGetSignedUrl: vi.fn(),
}));

vi.mock("./storage", async importOriginal => {
  const actual = await importOriginal<typeof import("./storage")>();
  return {
    ...actual,
    storageGetSignedUrl: storageMocks.storageGetSignedUrl,
  };
});

vi.mock("./authenticate", () => ({
  authenticate: vi.fn(async () => null),
}));

import {
  clearDmSignedUrlCache,
  resolveOwnedDmMedia,
  signDmMessageMediaUrl,
  validateDmUpload,
} from "./dmMedia";

function pngBytes(length = 64) {
  const buffer = Buffer.alloc(length);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return buffer;
}

function jpegBytes(length = 64) {
  const buffer = Buffer.alloc(length);
  buffer.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return buffer;
}

function mp4Bytes() {
  const buffer = Buffer.alloc(64);
  buffer.write("    ftypisom", 0, "latin1");
  return buffer;
}

function movBytes() {
  const buffer = Buffer.alloc(64);
  buffer.write("    ftypqt  ", 0, "latin1");
  return buffer;
}

function webmBytes() {
  const buffer = Buffer.alloc(64);
  buffer.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  buffer.write("webm", 40, "latin1");
  return buffer;
}

function pdfBytes() {
  const buffer = Buffer.alloc(64);
  buffer.write("%PDF-1.7\n", 0, "latin1");
  return buffer;
}

function zipBytes() {
  const buffer = Buffer.alloc(64);
  buffer.set([0x50, 0x4b, 0x03, 0x04], 0);
  return buffer;
}

function ole2Bytes() {
  const buffer = Buffer.alloc(64);
  buffer.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  return buffer;
}

describe("validateDmUpload", () => {
  it("accepts a PNG and derives type, extension, and safe base name", () => {
    const result = validateDmUpload({
      kind: "image",
      buffer: pngBytes(),
      originalName: "holiday photo.png",
    });
    expect(result.mediaType).toBe("image/png");
    expect(result.ext).toBe("png");
    expect(result.contentType).toBe("image/png");
    expect(result.size).toBe(64);
    expect(result.baseName).toBe("holiday-photo");
    expect(result.baseName).not.toContain("/");
  });

  it("rejects a file whose bytes are not a supported image", () => {
    expect(() =>
      validateDmUpload({
        kind: "image",
        buffer: Buffer.from("<html><body>not an image</body></html>"),
        originalName: "sneaky.png",
      })
    ).toThrow(/^Attachment is not a supported image/);
  });

  it("rejects an empty attachment", () => {
    expect(() =>
      validateDmUpload({ kind: "image", buffer: Buffer.alloc(0), originalName: "a.png" })
    ).toThrow(/^Attachment is empty/);
  });

  it("rejects an image over the 5MB limit before any storage happens", () => {
    const oversized = jpegBytes(DM_MAX_IMAGE_BYTES + 1);
    expect(() =>
      validateDmUpload({ kind: "image", buffer: oversized, originalName: "big.jpg" })
    ).toThrow(/must be 5\.0 MB or smaller/);
  });

  it("accepts MP4, MOV, and WebM videos by magic bytes", () => {
    expect(validateDmUpload({ kind: "video", buffer: mp4Bytes(), originalName: "clip.mp4" })).toMatchObject({
      mediaType: "video/mp4",
      ext: "mp4",
    });
    expect(validateDmUpload({ kind: "video", buffer: movBytes(), originalName: "clip.mov" })).toMatchObject({
      mediaType: "video/quicktime",
      ext: "mov",
    });
    expect(validateDmUpload({ kind: "video", buffer: webmBytes(), originalName: "clip.webm" })).toMatchObject({
      mediaType: "video/webm",
      ext: "webm",
    });
  });

  it("rejects non-video bytes for the video kind", () => {
    expect(() =>
      validateDmUpload({ kind: "video", buffer: pngBytes(), originalName: "clip.mp4" })
    ).toThrow(/^Attachment is not a supported video/);
  });

  it("rejects a video over the 25MB limit", () => {
    const oversized = Buffer.concat([mp4Bytes(), Buffer.alloc(DM_MAX_VIDEO_BYTES)]);
    expect(() =>
      validateDmUpload({ kind: "video", buffer: oversized, originalName: "clip.mp4" })
    ).toThrow(/must be 25\.0 MB or smaller/);
  });

  it("stores documents with the shared `document` mediaType token", () => {
    const result = validateDmUpload({
      kind: "document",
      buffer: pdfBytes(),
      originalName: "contract.pdf",
    });
    expect(result.mediaType).toBe("document");
    expect(result.ext).toBe("pdf");
    expect(result.contentType).toBe("application/pdf");
  });

  it("accepts OOXML containers only with an allow-listed extension", () => {
    expect(
      validateDmUpload({
        kind: "document",
        buffer: zipBytes(),
        originalName: "report.docx",
      }).ext
    ).toBe("docx");
    expect(() =>
      validateDmUpload({
        kind: "document",
        buffer: zipBytes(),
        originalName: "payload.exe",
      })
    ).toThrow(/^Attachment is not a supported document/);
  });

  it("accepts legacy OLE2 documents with an allow-listed extension", () => {
    expect(
      validateDmUpload({
        kind: "document",
        buffer: ole2Bytes(),
        originalName: "legacy.doc",
      }).ext
    ).toBe("doc");
  });

  it("accepts a clean .txt but rejects binary bytes disguised as text", () => {
    expect(
      validateDmUpload({
        kind: "document",
        buffer: Buffer.from("hello notes\n"),
        originalName: "notes.txt",
      }).mediaType
    ).toBe("document");

    const binary = Buffer.from([0x68, 0x69, 0x00, 0xff]);
    expect(() =>
      validateDmUpload({ kind: "document", buffer: binary, originalName: "notes.txt" })
    ).toThrow(/^Attachment is not a supported document/);
  });
});

describe("resolveOwnedDmMedia", () => {
  const key = "dm/7/abcd1234-567-holiday.jpg";

  it("normalizes an object the sender uploaded", () => {
    const media = resolveOwnedDmMedia(7, {
      mediaUrl: key,
      mediaType: "image/jpeg",
      mediaWidth: 1024.4,
      mediaHeight: -3,
      mediaDuration: 0,
    });
    expect(media).toEqual({
      mediaUrl: key,
      mediaType: "image/jpeg",
      mediaWidth: 1024,
      mediaHeight: null,
      mediaDuration: null,
    });
  });

  it("rejects an object uploaded by somebody else", () => {
    expect(() =>
      resolveOwnedDmMedia(9, { mediaUrl: key, mediaType: "image/jpeg" })
    ).toThrow(/^Attachment upload not found/);
  });

  it("rejects a URL outside the dm/ namespace", () => {
    expect(() =>
      resolveOwnedDmMedia(7, {
        mediaUrl: "https://cdn.example.com/posts/photo.jpg",
        mediaType: "image/jpeg",
      })
    ).toThrow(/^Attachment upload not found/);
  });

  it("recovers a missing mediaType from the sniffed extension", () => {
    const media = resolveOwnedDmMedia(7, { mediaUrl: key, mediaType: null });
    expect(media.mediaType).toBe("image/jpeg");
  });

  it("rejects a disallowed mediaType", () => {
    expect(() =>
      resolveOwnedDmMedia(7, { mediaUrl: key, mediaType: "text/html" })
    ).toThrow(/^Attachment type is not allowed/);
  });

  it("rejects an object whose encoded size exceeds the kind limit", () => {
    expect(() =>
      resolveOwnedDmMedia(7, {
        mediaUrl: "dm/7/abcd1234-9000000-huge.jpg",
        mediaType: "image/jpeg",
      })
    ).toThrow(/^Attachment is too large/);
  });

  it("rejects a mediaType that does not match the stored extension", () => {
    expect(() =>
      resolveOwnedDmMedia(7, {
        mediaUrl: "dm/7/abcd1234-567-clip.jpg",
        mediaType: "video/mp4",
      })
    ).toThrow(/^Attachment type is not allowed/);
  });
});

describe("signDmMessageMediaUrl", () => {
  beforeEach(() => {
    clearDmSignedUrlCache();
    storageMocks.storageGetSignedUrl.mockReset();
    storageMocks.storageGetSignedUrl.mockImplementation(async (key: string) =>
      Promise.resolve(`https://cdn.test/${key}?sig=token`)
    );
  });

  it("signs a key and reuses the cached URL inside the TTL", async () => {
    const first = await signDmMessageMediaUrl("dm/7/abcd1234-567-a.jpg");
    const second = await signDmMessageMediaUrl("dm/7/abcd1234-567-a.jpg");
    expect(first).toBe("https://cdn.test/dm/7/abcd1234-567-a.jpg?sig=token");
    expect(second).toBe(first);
    expect(storageMocks.storageGetSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("re-signs after the cache is cleared", async () => {
    await signDmMessageMediaUrl("dm/7/abcd1234-567-a.jpg");
    clearDmSignedUrlCache();
    await signDmMessageMediaUrl("dm/7/abcd1234-567-a.jpg");
    expect(storageMocks.storageGetSignedUrl).toHaveBeenCalledTimes(2);
  });
});

/**
 * JHILIK DM attachment — client helpers.
 *
 * Validates the pre-flight checks, send-payload batching rules, and the
 * display metadata recovered from a stored DM object key.
 */
import { describe, expect, it } from "vitest";
import {
  DM_MAX_VIDEO_BYTES,
  dmConversationPreview,
} from "@shared/dmMedia";
import {
  buildDmSendPayloads,
  isDmAttachmentKind,
  parseDmMediaDisplay,
  validateDmFile,
  type DmPendingAttachment,
} from "./dmAttachment";

function file(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function pending(
  overrides: Partial<DmPendingAttachment> & Pick<DmPendingAttachment, "id">
): DmPendingAttachment {
  return {
    kind: "image",
    file: file("photo.png", "image/png", 10),
    name: "photo.png",
    size: 10,
    previewUrl: "blob:http://localhost/photo",
    status: "ready",
    progress: 100,
    media: { mediaUrl: "dm/7/abcd1234-10-photo.png", mediaType: "image/png" },
    ...overrides,
  };
}

describe("validateDmFile", () => {
  it("accepts a supported image", () => {
    expect(() =>
      validateDmFile("image", file("photo.png", "image/png", 1024))
    ).not.toThrow();
  });

  it("rejects an image with a non-image MIME type", () => {
    expect(() =>
      validateDmFile("image", file("photo.png", "application/pdf", 10))
    ).toThrow(/^Choose a JPG, PNG, WEBP, or GIF image/);
  });

  it("rejects an empty file", () => {
    expect(() =>
      validateDmFile("image", file("photo.png", "image/png", 0))
    ).toThrow(/^That file is empty/);
  });

  it("rejects a video over the 25MB limit", () => {
    expect(() =>
      validateDmFile("video", file("clip.mp4", "video/mp4", DM_MAX_VIDEO_BYTES + 1))
    ).toThrow(/25\.0 MB or smaller/);
  });

  it("rejects a file with an unsupported extension for the document kind", () => {
    expect(() =>
      validateDmFile("document", file("payload.exe", "application/octet-stream", 10))
    ).toThrow(/^Choose a PDF, Word, Excel, PowerPoint, or text file/);
  });

  it("accepts a PDF document", () => {
    expect(() =>
      validateDmFile("document", file("contract.pdf", "application/pdf", 64))
    ).not.toThrow();
  });
});

describe("buildDmSendPayloads", () => {
  it("returns nothing when there is neither text nor a ready attachment", () => {
    expect(buildDmSendPayloads("   ", [])).toEqual([]);
    expect(
      buildDmSendPayloads("", [pending({ id: "a", status: "uploading" })])
    ).toEqual([]);
  });

  it("sends text alone as a single message", () => {
    expect(buildDmSendPayloads("  hello  ", [])).toEqual([
      { body: "hello", attachmentId: null },
    ]);
  });

  it("puts the caption on the first attachment only", () => {
    const payloads = buildDmSendPayloads("look at these", [
      pending({ id: "a" }),
      pending({ id: "b" }),
      pending({ id: "c", status: "uploading" }),
    ]);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({ body: "look at these", attachmentId: "a" });
    expect(payloads[1]).toMatchObject({ body: "", attachmentId: "b" });
  });

  it("sends an attachment-only batch", () => {
    const payloads = buildDmSendPayloads("", [pending({ id: "a" })]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ body: "", attachmentId: "a" });
    expect(payloads[0].media?.mediaUrl).toBe("dm/7/abcd1234-10-photo.png");
  });
});

describe("parseDmMediaDisplay", () => {
  it("recovers the display name and size from a DM object key", () => {
    expect(parseDmMediaDisplay("dm/7/abcd1234-2048-report.pdf")).toEqual({
      name: "report.pdf",
      ext: "pdf",
      size: 2048,
    });
  });

  it("accepts a full storage URL as well", () => {
    expect(
      parseDmMediaDisplay("https://cdn.example.com/dm/7/abcd1234-2048-report.pdf?sig=1")
    ).toEqual({ name: "report.pdf", ext: "pdf", size: 2048 });
  });

  it("returns null for anything that is not a DM object key", () => {
    expect(parseDmMediaDisplay(null)).toBeNull();
    expect(parseDmMediaDisplay("")).toBeNull();
    expect(parseDmMediaDisplay("https://cdn.example.com/posts/photo.jpg")).toBeNull();
  });
});

describe("isDmAttachmentKind", () => {
  it("only accepts the three menu kinds", () => {
    expect(isDmAttachmentKind("image")).toBe(true);
    expect(isDmAttachmentKind("video")).toBe(true);
    expect(isDmAttachmentKind("document")).toBe(true);
    expect(isDmAttachmentKind("audio")).toBe(false);
  });
});

describe("dmConversationPreview", () => {
  it("prefers the caption, then labels the attachment kind", () => {
    expect(
      dmConversationPreview({ body: "on my way", mediaUrl: "dm/7/x.jpg", mediaType: "image/jpeg" })
    ).toBe("on my way");
    expect(dmConversationPreview({ body: "  ", mediaUrl: "dm/7/x.jpg", mediaType: null })).toBe(
      "📷 Photo"
    );
    expect(
      dmConversationPreview({ body: null, mediaUrl: "dm/7/x.mp4", mediaType: "video/mp4" })
    ).toBe("🎬 Video");
    expect(
      dmConversationPreview({ body: null, mediaUrl: "dm/7/x.pdf", mediaType: "document" })
    ).toBe("📄 Document");
    expect(dmConversationPreview({ body: null, mediaUrl: null, mediaType: null })).toBe(
      "No messages yet"
    );
    expect(dmConversationPreview(null)).toBe("No messages yet");
    expect(dmConversationPreview(undefined)).toBe("No messages yet");
  });
});

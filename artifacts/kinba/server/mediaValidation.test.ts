import { describe, expect, it } from "vitest";
import { communityAnnouncementInput, videoInput } from "./mediaValidation";

const baseVideo = {
  title: "A useful video",
  description: "A real video from a Kinba member.",
  videoUrl: "https://cdn.example.com/original.mp4",
  width: 3840,
  height: 2160,
  sources: [
    {
      quality: "ORIGINAL" as const,
      videoUrl: "https://cdn.example.com/original.mp4",
    },
  ],
};

describe("media input contracts", () => {
  it("accepts unrestricted dimensions for long-form videos", () => {
    expect(
      videoInput.safeParse({
        ...baseVideo,
        kind: "LONG",
        durationSeconds: 1800,
      }).success
    ).toBe(true);
  });

  it("rejects Shorts longer than one minute", () => {
    expect(
      videoInput.safeParse({ ...baseVideo, kind: "SHORT", durationSeconds: 61 })
        .success
    ).toBe(false);
    expect(
      videoInput.safeParse({ ...baseVideo, kind: "SHORT", durationSeconds: 60 })
        .success
    ).toBe(true);
  });

  it("requires an original source and unique quality labels", () => {
    expect(
      videoInput.safeParse({
        ...baseVideo,
        kind: "LONG",
        durationSeconds: 1,
        sources: [
          { quality: "720P", videoUrl: "https://cdn.example.com/720.mp4" },
        ],
      }).success
    ).toBe(false);
    expect(
      videoInput.safeParse({
        ...baseVideo,
        kind: "LONG",
        durationSeconds: 1,
        sources: [
          { quality: "ORIGINAL", videoUrl: baseVideo.videoUrl },
          { quality: "ORIGINAL", videoUrl: baseVideo.videoUrl },
        ],
      }).success
    ).toBe(false);
  });

  it("allows ten images and one video in an announcement", () => {
    const images = Array.from({ length: 10 }, (_, index) => ({
      mediaType: "IMAGE" as const,
      mediaUrl: `https://cdn.example.com/${index}.jpg`,
      sortOrder: index,
    }));
    const video = {
      mediaType: "VIDEO" as const,
      mediaUrl: "https://cdn.example.com/announcement.mp4",
      sortOrder: 10,
      durationSeconds: 300,
    };
    expect(
      communityAnnouncementInput.safeParse({
        body: "Official update",
        attachments: [...images, video],
      }).success
    ).toBe(true);
    expect(
      communityAnnouncementInput.safeParse({
        body: "Too many",
        attachments: [...images, { ...images[0], sortOrder: 10 }],
      }).success
    ).toBe(false);
  });
});

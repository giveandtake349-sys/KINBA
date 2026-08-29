import { describe, expect, it } from "vitest";
import {
  commentInput,
  communityAnnouncementInput,
  connectionRequestInput,
  isAcceptedParticipant,
  signalInput,
  videoInput,
} from "./nivoValidation";
import { scoreSignalPair } from "./nivoMatching";

describe("NIVO input contracts", () => {
  it("accepts a valid connection request and rejects an empty note", () => {
    expect(
      connectionRequestInput.safeParse({
        recipientId: 4,
        signalId: null,
        note: "I can help you design the identity.",
      }).success
    ).toBe(true);
    expect(
      connectionRequestInput.safeParse({
        recipientId: 4,
        signalId: null,
        note: "short",
      }).success
    ).toBe(false);
  });

  it("requires meaningful signal content", () => {
    expect(
      signalInput.safeParse({
        type: "need",
        title: "Need a mentor",
        description: "I would value guidance for my first product launch.",
        category: "Business",
        language: "English",
        location: null,
      }).success
    ).toBe(true);
    expect(
      signalInput.safeParse({
        type: "need",
        title: "No",
        description: "too short",
        category: "Business",
        language: "English",
        location: null,
      }).success
    ).toBe(false);
  });

  it("requires comment text or an image", () => {
    expect(
      commentInput.safeParse({
        postId: 10,
        content: "A useful thought",
        imageUrl: null,
      }).success
    ).toBe(true);
    expect(
      commentInput.safeParse({
        postId: 10,
        content: null,
        imageUrl: "https://cdn.example.com/comment.png",
      }).success
    ).toBe(true);
    expect(
      commentInput.safeParse({ postId: 10, content: "", imageUrl: null })
        .success
    ).toBe(false);
  });

  it("enforces video duration, orientation, and HD constraints", () => {
    expect(
      videoInput.safeParse({
        title: "Main video",
        description: "A square video",
        videoUrl: "https://cdn.example.com/main.mp4",
        kind: "LONG",
        durationSeconds: 1800,
        width: 1080,
        height: 1080,
      }).success
    ).toBe(true);
    expect(
      videoInput.safeParse({
        title: "A Short",
        description: "A vertical video",
        videoUrl: "https://cdn.example.com/short.mp4",
        kind: "SHORT",
        durationSeconds: 60,
        width: 720,
        height: 1080,
      }).success
    ).toBe(true);
    expect(
      videoInput.safeParse({
        title: "Not square",
        description: "",
        videoUrl: "https://cdn.example.com/wide.mp4",
        kind: "LONG",
        durationSeconds: 60,
        width: 1080,
        height: 720,
      }).success
    ).toBe(false);
    expect(
      videoInput.safeParse({
        title: "Too long",
        description: "",
        videoUrl: "https://cdn.example.com/long.mp4",
        kind: "SHORT",
        durationSeconds: 61,
        width: 720,
        height: 1080,
      }).success
    ).toBe(false);
  });

  it("limits community announcements to 10 images and one five-minute video", () => {
    const images = Array.from({ length: 10 }, (_, index) => ({
      mediaType: "IMAGE" as const,
      mediaUrl: `https://cdn.example.com/${index}.jpg`,
      sortOrder: index,
    }));
    const video = {
      mediaType: "VIDEO" as const,
      mediaUrl: "https://cdn.example.com/announcement.mp4",
      sortOrder: 10,
      width: 1080,
      height: 1080,
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
        body: "",
        attachments: images.slice(0, 9),
      }).success
    ).toBe(true);
    expect(
      communityAnnouncementInput.safeParse({
        body: "Too many",
        attachments: [...images, { ...images[0], sortOrder: 10 }],
      }).success
    ).toBe(false);
    expect(
      communityAnnouncementInput.safeParse({
        body: "Two videos",
        attachments: [video, { ...video, sortOrder: 11 }],
      }).success
    ).toBe(false);
  });

  it("permits messaging only for an accepted participant", () => {
    expect(
      isAcceptedParticipant(
        { requesterId: 1, recipientId: 2, status: "accepted" },
        2
      )
    ).toBe(true);
    expect(
      isAcceptedParticipant(
        { requesterId: 1, recipientId: 2, status: "pending" },
        2
      )
    ).toBe(false);
    expect(
      isAcceptedParticipant(
        { requesterId: 1, recipientId: 2, status: "accepted" },
        3
      )
    ).toBe(false);
  });
});

describe("NIVO match scoring", () => {
  it("scores an exact NEED/CAN category pairing at 85% or above", () => {
    expect(
      scoreSignalPair(
        {
          type: "need",
          category: "Design",
          title: "Need a brand designer",
          description: "Help with identity and visual direction",
        },
        {
          type: "can",
          category: "Design",
          title: "I offer product design",
          description: "Brand and visual systems",
        }
      )
    ).toBeGreaterThanOrEqual(85);
  });

  it("returns no match for two signals of the same type", () => {
    expect(
      scoreSignalPair(
        {
          type: "need",
          category: "Design",
          title: "Need a brand designer",
          description: "Help with identity",
        },
        {
          type: "need",
          category: "Design",
          title: "Need a product designer",
          description: "Help with interface",
        }
      )
    ).toBe(0);
  });
});

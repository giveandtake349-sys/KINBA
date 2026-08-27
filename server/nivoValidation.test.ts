import { describe, expect, it } from "vitest";
import { connectionRequestInput, isAcceptedParticipant, signalInput } from "./nivoValidation";
import { scoreSignalPair } from "./nivoMatching";

describe("NIVO input contracts", () => {
  it("accepts a valid connection request and rejects an empty note", () => {
    expect(connectionRequestInput.safeParse({ recipientId: 4, signalId: null, note: "I can help you design the identity." }).success).toBe(true);
    expect(connectionRequestInput.safeParse({ recipientId: 4, signalId: null, note: "short" }).success).toBe(false);
  });

  it("requires meaningful signal content", () => {
    expect(signalInput.safeParse({ type: "need", title: "Need a mentor", description: "I would value guidance for my first product launch.", category: "Business", language: "English", location: null }).success).toBe(true);
    expect(signalInput.safeParse({ type: "need", title: "No", description: "too short", category: "Business", language: "English", location: null }).success).toBe(false);
  });

  it("permits messaging only for an accepted participant", () => {
    expect(isAcceptedParticipant({ requesterId: 1, recipientId: 2, status: "accepted" }, 2)).toBe(true);
    expect(isAcceptedParticipant({ requesterId: 1, recipientId: 2, status: "pending" }, 2)).toBe(false);
    expect(isAcceptedParticipant({ requesterId: 1, recipientId: 2, status: "accepted" }, 3)).toBe(false);
  });
});

describe("NIVO match scoring", () => {
  it("scores an exact NEED/CAN category pairing at 85% or above", () => {
    expect(scoreSignalPair(
      { type: "need", category: "Design", title: "Need a brand designer", description: "Help with identity and visual direction" },
      { type: "can", category: "Design", title: "I offer product design", description: "Brand and visual systems" },
    )).toBeGreaterThanOrEqual(85);
  });

  it("returns no match for two signals of the same type", () => {
    expect(scoreSignalPair(
      { type: "need", category: "Design", title: "Need a brand designer", description: "Help with identity" },
      { type: "need", category: "Design", title: "Need a product designer", description: "Help with interface" },
    )).toBe(0);
  });
});

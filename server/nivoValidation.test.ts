import { describe, expect, it } from "vitest";
import { connectionRequestInput, isAcceptedParticipant, signalInput } from "./nivoValidation";

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

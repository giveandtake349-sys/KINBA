import { describe, expect, it } from "vitest";
import { selectNomineeIds, selectSecondaryWinnerId } from "./sponsorBidsDraw";

describe("SponsorBids multi-stage draw", () => {
  const participants = Array.from({ length: 8 }, (_, index) => ({ id: index + 1 }));

  it("selects at most three preliminary nominees from the eligible pool", () => {
    const nominees = selectNomineeIds(17, 3, participants);
    expect(nominees).toHaveLength(3);
    expect(new Set(nominees).size).toBe(3);
    expect(nominees.every(id => id >= 1 && id <= 8)).toBe(true);
  });

  it("excludes participants already awarded in earlier ranks", () => {
    const nominees = selectNomineeIds(17, 2, participants, new Set([1, 2, 3, 4, 5, 6]));
    expect(nominees).toEqual(expect.arrayContaining([7, 8]));
    expect(nominees).not.toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6]));
  });

  it("keeps preliminary and secondary selections deterministic across clients", () => {
    const first = selectNomineeIds(42, 1, participants);
    const second = selectNomineeIds(42, 1, participants);
    expect(second).toEqual(first);
    expect(selectSecondaryWinnerId(42, 1, first)).toBe(selectSecondaryWinnerId(42, 1, first));
    expect(selectSecondaryWinnerId(42, 1, [])).toBeUndefined();
  });
});

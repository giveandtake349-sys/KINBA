/**
 * Phase 6: advertiser self-service campaign Pause/Resume/End.
 * Scripted in-memory fake of the drizzle query surface.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { campaignAuditLog, campaigns } from "../drizzle/schema";

const h = vi.hoisted(() => {
  const state = {
    selectQueue: [] as unknown[][],
    inserts: [] as Array<{ table: unknown; values: unknown }>,
    updates: [] as Array<{ table: unknown; values: unknown }>,
  };
  const thenable = (value: unknown) => ({
    then: (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(value).then(resolve, reject),
  });
  function makeSelect(rows: unknown[]) {
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      then: (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    for (const m of ["from", "leftJoin", "where", "limit"]) {
      chain[m] = () => chain;
    }
    return chain;
  }
  const fakeDb: Record<string, (...args: unknown[]) => unknown> = {
    select: () => makeSelect(state.selectQueue.shift() ?? []),
    insert: (table: unknown) => {
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      chain.values = (values: unknown) => {
        state.inserts.push({ table, values });
        return chain;
      };
      return chain;
    },
    update: (table: unknown) => ({
      set: (values: unknown) => {
        state.updates.push({ table, values });
        return {
          where: () => ({ returning: () => thenable([{ id: 3 }]) }),
        };
      },
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
  };
  return { state, fakeDb };
});

vi.mock("./db", () => ({
  getDb: () => Promise.resolve(h.fakeDb),
}));

import { updateMyCampaignStatus } from "./campaigns";

beforeEach(() => {
  h.state.selectQueue = [];
  h.state.inserts = [];
  h.state.updates = [];
});

describe("updateMyCampaignStatus", () => {
  it("pauses the owner's active campaign + writes an audit row", async () => {
    h.state.selectQueue = [
      [
        {
          id: 3,
          title: "Launch",
          status: "active",
          applicationId: 7,
          ownerId: 5,
        },
      ],
    ];
    const out = await updateMyCampaignStatus(5, 3, "paused");
    expect(out.status).toBe("paused");
    expect(
      h.state.updates.filter(u => u.table === campaigns)
    ).toHaveLength(1);
    const audits = h.state.inserts.filter(u => u.table === campaignAuditLog);
    expect(audits).toHaveLength(1);
    expect(
      (audits[0].values as Record<string, unknown>).action
    ).toBe("campaign.paused_by_advertiser");
  });

  it("rejects another user's campaign", async () => {
    h.state.selectQueue = [
      [{ id: 3, title: "X", status: "active", applicationId: 7, ownerId: 9 }],
    ];
    await expect(updateMyCampaignStatus(5, 3, "paused")).rejects.toThrow(
      "not found"
    );
  });

  it("blocks advertiser self-activation of drafts", async () => {
    h.state.selectQueue = [
      [{ id: 3, title: "X", status: "draft", applicationId: 7, ownerId: 5 }],
    ];
    await expect(updateMyCampaignStatus(5, 3, "active")).rejects.toThrow(
      "Only an admin"
    );
  });

  it("rejects an illegal transition (ended→paused)", async () => {
    h.state.selectQueue = [
      [{ id: 3, title: "X", status: "ended", applicationId: 7, ownerId: 5 }],
    ];
    await expect(updateMyCampaignStatus(5, 3, "paused")).rejects.toThrow();
  });
});

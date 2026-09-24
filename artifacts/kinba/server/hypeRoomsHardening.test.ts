/**
 * M-A2.1 — hardening tests for hidden parents, atomic invite accept,
 * invite lifecycle, settings auth order, reaction unique-race.
 */
import { vi, describe, beforeEach, expect, it } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  ensureProfile: vi.fn(),
  createAnnouncementComment: vi.fn(),
  createCommunityAnnouncement: vi.fn(),
  createVideo: vi.fn(),
  createVideoComment: vi.fn(),
  getOwnProfile: vi.fn(),
  listAnnouncementComments: vi.fn(),
  listVideoComments: vi.fn(),
  submitVerificationTransaction: vi.fn(),
  approveVerificationTransaction: vi.fn(),
  adminListDashboard: vi.fn(),
  adminCreateSponsorBidsSession: vi.fn(),
  adminStartSponsorBidsSession: vi.fn(),
  adminSetSponsorStatus: vi.fn(),
  getDb: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
  insertNotification: vi.fn(),
  listUserNotifications: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  markUserNotificationsRead: vi.fn(),
  notifyClaimStatusChange: vi.fn(),
  notifyDropSoldOut: vi.fn(),
  notifyRoomWentLive: vi.fn(),
  notifyRoomExpired: vi.fn(),
  notifyMemberRemoved: vi.fn(),
}));

const featureFlagMocks = vi.hoisted(() => ({
  isFeatureFlagEnabled: vi.fn(),
  getActiveFeatureFlags: vi.fn(),
  listFeatureFlagRows: vi.fn(),
  setFeatureFlag: vi.fn(),
  FEATURE_FLAG_KEYS: [],
  FEATURE_FLAG_DEFAULTS: {},
  isFeatureFlagKey: vi.fn(),
}));

vi.mock("./db", () => databaseMocks);
vi.mock("./notifications", () => notificationMocks);
vi.mock("./featureFlags", () => featureFlagMocks);
vi.mock("./hlsProcessor", () => ({ queueVideoTranscode: vi.fn() }));
vi.mock("./rewardLedger", () => ({
  getCoinBalance: vi.fn(),
  listRewardHistory: vi.fn(),
}));
vi.mock("./moderation", async importOriginal => {
  const actual = await importOriginal<typeof import("./moderation")>();
  return {
    ...actual,
    createModerationReport: vi.fn(),
    listModerationReports: vi.fn(),
    resolveModerationReport: vi.fn(),
    adminHideRoomMessage: vi.fn(),
  };
});

import {
  acceptHypeRoomInvite,
  createHypeRoomInvite,
  listRoomMessages,
  sendHypeRoomMessage,
  toggleHypeRoomMessageReaction,
  updateHypeRoomSettings,
} from "./hypeRooms";

const baseRoom = (over: Record<string, unknown> = {}) => ({
  id: 11,
  hostId: 10,
  title: "Room",
  topic: null,
  description: null,
  visibility: "public",
  status: "live",
  durationHours: 4,
  startsAt: new Date(Date.now() - 60_000),
  endsAt: new Date(Date.now() + 4 * 3600_000),
  expiredAt: null,
  archivedAt: null,
  cancelReason: null,
  dropId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const activeMember = (over: Record<string, unknown> = {}) => ({
  id: 100,
  roomId: 11,
  userId: 41,
  role: "member",
  joinedAt: new Date(),
  leftAt: null,
  bannedAt: null,
  removedBy: null,
  ...over,
});

const messageRow = (over: Record<string, unknown> = {}) => ({
  id: 3,
  roomId: 11,
  userId: 41,
  body: "hello",
  audioUrl: null,
  audioDuration: null,
  parentId: null,
  pinned: false,
  createdAt: new Date(),
  moderatedAt: null,
  moderatedBy: null,
  hiddenAt: null,
  ...over,
});

const inviteRow = (over: Record<string, unknown> = {}) => ({
  id: 5,
  roomId: 11,
  invitedUserId: 41,
  createdBy: 10,
  status: "pending",
  createdAt: new Date(),
  updatedAt: new Date(),
  consumedAt: null,
  ...over,
});

/**
 * Fake DB whose select().from().where().limit() returns queued rows in order.
 * insert/update/delete are instrumented spies with returning().
 */
function fakeDb(selectRows: unknown[]) {
  const queue = [...selectRows];
  const insertValues = vi.fn();
  const updateSets = vi.fn();
  const deleteWheres = vi.fn();
  const insertReturning = vi.fn(async () => [{ id: 1 }]);
  const updateReturning = vi.fn(async () => []);
  const asRows = (row: unknown): unknown[] => {
    if (row === undefined) return [];
    if (Array.isArray(row)) return row;
    return [row];
  };

  const db = {
    select: vi.fn(() => {
      const row = queue.length > 0 ? queue.shift() : undefined;
      const rows = asRows(row);
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => rows),
        orderBy: vi.fn(async () => rows),
        leftJoin: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        // Await the builder itself when the chain ends at .where() (e.g. parent snapshot).
        then: (
          onFulfilled?: (v: unknown) => unknown,
          onRejected?: (e: unknown) => unknown
        ) => Promise.resolve(rows).then(onFulfilled, onRejected),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        insertValues(v);
        return {
          returning: insertReturning,
          onConflictDoNothing: vi.fn(() => ({
            returning: insertReturning,
          })),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: unknown) => {
        updateSets(v);
        return {
          where: vi.fn(() => ({
            returning: updateReturning,
          })),
          returning: updateReturning,
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((...a: unknown[]) => {
        deleteWheres(...a);
        return Promise.resolve(undefined);
      }),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    __insertValues: insertValues,
    __updateSets: updateSets,
    __deleteWheres: deleteWheres,
    __insertReturning: insertReturning,
    __updateReturning: updateReturning,
    __queue: queue,
  };
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  databaseMocks.ensureProfile.mockResolvedValue(undefined);
  notificationMocks.notifyRoomWentLive.mockResolvedValue(undefined);
  notificationMocks.notifyRoomExpired.mockResolvedValue(undefined);
});

describe("FIX 1 — hidden reply parent", () => {
  it("sendHypeRoomMessage rejects hidden parent and does not insert", async () => {
    // select order: room, membership, parent(hidden)
    const db = fakeDb([
      baseRoom(),
      activeMember(),
      messageRow({ id: 9, hiddenAt: new Date() }),
    ]);
    // resolve may attempt update — return no row so status unchanged
    db.__updateReturning.mockResolvedValue(undefined as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(
      sendHypeRoomMessage(11, 41, "reply body", { parentId: 9 })
    ).rejects.toThrow("Message not found.");
    expect(db.__insertValues).not.toHaveBeenCalled();
  });

  it("sendHypeRoomMessage allows visible top-level parent", async () => {
    const db = fakeDb([
      baseRoom(),
      activeMember(),
      messageRow({ id: 9 }),
    ]);
    db.__insertReturning.mockResolvedValue([
      messageRow({ id: 20, parentId: 9 }),
    ] as never);
    db.__updateReturning.mockResolvedValue(undefined as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await sendHypeRoomMessage(11, 41, "ok reply", {
      parentId: 9,
    });
    expect(out.parentId).toBe(9);
    expect(db.__insertValues).toHaveBeenCalled();
  });

  it("sendHypeRoomMessage still rejects cross-room and nested parents", async () => {
    const cross = fakeDb([
      baseRoom(),
      activeMember(),
      messageRow({ id: 9, roomId: 99 }),
    ]);
    cross.__updateReturning.mockResolvedValue(undefined as never);
    databaseMocks.getDb.mockResolvedValue(cross as never);
    await expect(
      sendHypeRoomMessage(11, 41, "x", { parentId: 9 })
    ).rejects.toThrow("Reply target is not in this room.");
    expect(cross.__insertValues).not.toHaveBeenCalled();

    const nested = fakeDb([
      baseRoom(),
      activeMember(),
      messageRow({ id: 9, parentId: 3 }),
    ]);
    nested.__updateReturning.mockResolvedValue(undefined as never);
    databaseMocks.getDb.mockResolvedValue(nested as never);
    await expect(
      sendHypeRoomMessage(11, 41, "x", { parentId: 9 })
    ).rejects.toThrow("You can only reply to top-level messages.");
    expect(nested.__insertValues).not.toHaveBeenCalled();
  });

  it("listRoomMessages parent snapshot omits hidden parents", async () => {
    // select order: room, messages, reactions, mentions, parents
    // Parent id 9 is hidden → parent query returns [] → parent is null.
    const db = fakeDb([
      [{ id: 11 }],
      [
        {
          message: messageRow({ id: 20, parentId: 9, body: "child" }),
          user: { id: 41, name: "U", openId: "o", photoUrl: null },
        },
      ],
      [],
      [],
      [], // hidden parent filtered out by isNull(hiddenAt)
    ]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const rows = await listRoomMessages(11, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.message.parentId).toBe(9);
    expect(rows[0]!.parent).toBeNull();
  });
});

describe("FIX 2 — atomic invite acceptance", () => {
  it("successful accept: single transaction, membership + accepted invite", async () => {
    // select order: invite, room, membership(null → insert)
    const db = fakeDb([
      inviteRow(),
      baseRoom(),
      null,
    ]);
    db.__insertReturning.mockResolvedValue([activeMember({ id: 200 })] as never);
    db.__updateReturning.mockResolvedValue([
      inviteRow({ status: "accepted", consumedAt: new Date() }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const result = await acceptHypeRoomInvite(5, 41);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(result.invite.status).toBe("accepted");
    expect(result.invite.consumedAt).toBeInstanceOf(Date);
    expect(result.membership.userId).toBe(41);
    expect(db.__insertValues).toHaveBeenCalled();
    expect(db.__updateSets).toHaveBeenCalled();
  });

  it("failed join (already member) does not flip invite to accepted", async () => {
    const db = fakeDb([
      inviteRow(),
      baseRoom(),
      activeMember(), // already active → join throws
    ]);
    db.__updateReturning.mockResolvedValue([
      inviteRow({ status: "accepted" }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(acceptHypeRoomInvite(5, 41)).rejects.toThrow(
      "You are already a member of this room."
    );
    // join throws before invite update runs
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects foreign invitee before join", async () => {
    const db = fakeDb([inviteRow({ invitedUserId: 99 })]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(acceptHypeRoomInvite(5, 41)).rejects.toThrow(
      "This invite was not created for you."
    );
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects replayed accepted invite", async () => {
    const db = fakeDb([inviteRow({ status: "accepted" })]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(acceptHypeRoomInvite(5, 41)).rejects.toThrow(
      "This invite is no longer valid."
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects missing invite", async () => {
    const db = fakeDb([undefined]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(acceptHypeRoomInvite(404, 41)).rejects.toThrow(
      "Invite not found."
    );
  });

  it("rejoin after leave: membership clear + invite accepted in one tx", async () => {
    const left = activeMember({ leftAt: new Date() });
    const db = fakeDb([inviteRow(), baseRoom(), left]);
    let updateCall = 0;
    db.update.mockImplementation(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        updateCall += 1;
        // first update is rejoin (leftAt: null), second is invite status
        if (updateCall === 1) {
          expect(v.leftAt).toBeNull();
          return {
            where: vi.fn(() => ({
              returning: vi.fn(async () => [activeMember()]),
            })),
          };
        }
        expect(v.status).toBe("accepted");
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [
              inviteRow({ status: "accepted", consumedAt: new Date() }),
            ]),
          })),
        };
      }),
    }));
    databaseMocks.getDb.mockResolvedValue(db as never);

    const result = await acceptHypeRoomInvite(5, 41);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(updateCall).toBe(2);
    expect(result.invite.status).toBe("accepted");
    expect(result.membership.leftAt).toBeNull();
  });

  it("invite update failing after join would roll back (status guard returns empty)", async () => {
    const db = fakeDb([inviteRow(), baseRoom(), null]);
    db.__insertReturning.mockResolvedValue([activeMember({ id: 200 })] as never);
    // status no longer pending → update returns []
    db.__updateReturning.mockResolvedValue([] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(acceptHypeRoomInvite(5, 41)).rejects.toThrow(
      "This invite is no longer valid."
    );
    // Same transaction: thrown error means membership write is not committed.
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});

describe("FIX 3 — invite lifecycle", () => {
  it("rejects invite for already active member", async () => {
    // room, (resolve no update), user, membership, invite lookup unused
    const db = fakeDb([
      baseRoom(),
      { id: 41 }, // invitee user exists
      activeMember(), // already active
    ]);
    db.__updateReturning.mockResolvedValue(undefined as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(createHypeRoomInvite(11, 10, 41)).rejects.toThrow(
      "This user is already a member of this room."
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects archived room after resolve", async () => {
    const db = fakeDb([baseRoom({ status: "archived" })]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(createHypeRoomInvite(11, 10, 41)).rejects.toThrow(
      "This room is no longer accepting invites."
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects time-expired scheduled room after persistResolvedRoom", async () => {
    const db = fakeDb([
      baseRoom({
        status: "scheduled",
        startsAt: new Date(Date.now() - 8 * 3600_000),
        endsAt: new Date(Date.now() - 3600_000),
      }),
    ]);
    // persistResolvedRoom updates status → expired
    db.__updateReturning.mockResolvedValue([
      baseRoom({ status: "expired", expiredAt: new Date() }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(createHypeRoomInvite(11, 10, 41)).rejects.toThrow(
      "This room is no longer accepting invites."
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects banned target", async () => {
    const db = fakeDb([
      baseRoom(),
      { id: 41 },
      activeMember({ bannedAt: new Date() }),
    ]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(createHypeRoomInvite(11, 10, 41)).rejects.toThrow(
      "You are banned from this room."
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects non-host before lifecycle write", async () => {
    const db = fakeDb([baseRoom({ hostId: 10 })]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(createHypeRoomInvite(11, 99, 41)).rejects.toThrow(
      "Only the host can create invites."
    );
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("allows scheduled/live invite for non-member (happy path)", async () => {
    const db = fakeDb([
      baseRoom({ status: "scheduled" }),
      { id: 41 }, // user
      null, // no membership
      null, // no existing invite
    ]);
    db.__insertReturning.mockResolvedValue([
      inviteRow({ status: "pending" }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await createHypeRoomInvite(11, 10, 41);
    expect(out.status).toBe("pending");
    expect(db.insert).toHaveBeenCalled();
  });
});

describe("FIX 4 — settings authorization order", () => {
  it("non-host rejected without lifecycle persist update", async () => {
    const db = fakeDb([baseRoom({ hostId: 10 })]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(
      updateHypeRoomSettings(11, 99, { title: "Hacked title" })
    ).rejects.toThrow("Only the host can update room settings.");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("host updates live room after resolve", async () => {
    const db = fakeDb([baseRoom({ status: "live" })]);
    db.__updateReturning.mockResolvedValue([
      baseRoom({ title: "New title here" }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await updateHypeRoomSettings(11, 10, {
      title: "New title here",
    });
    expect(out.title).toBe("New title here");
  });
});

describe("FIX 5 — reaction unique race", () => {
  function reactionDb(opts: {
    existing?: unknown;
    insertReturning?: unknown;
    confirmed?: unknown;
  }) {
    const db = fakeDb([
      { id: 11 }, // room
      activeMember(), // membership
      messageRow(), // message
      opts.existing ?? null, // existing reaction
      opts.confirmed ?? null, // confirm after conflict
    ]);
    db.__insertReturning.mockResolvedValue(
      (opts.insertReturning ?? []) as never
    );
    return db;
  }

  it("onConflict race: empty insert + confirmed row → active true", async () => {
    const db = reactionDb({
      existing: null,
      insertReturning: [],
      confirmed: {
        id: 1,
        roomId: 11,
        messageId: 3,
        userId: 41,
        reaction: "like",
        createdAt: new Date(),
      },
    });
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(
      toggleHypeRoomMessageReaction(11, 41, 3, "like")
    ).resolves.toMatchObject({ active: true, reaction: "like" });
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("normal insert returns active true", async () => {
    const db = reactionDb({
      existing: null,
      insertReturning: [
        {
          id: 1,
          roomId: 11,
          messageId: 3,
          userId: 41,
          reaction: "like",
          createdAt: new Date(),
        },
      ],
    });
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(
      toggleHypeRoomMessageReaction(11, 41, 3, "like")
    ).resolves.toMatchObject({ active: true });
  });

  it("existing row is deleted (toggle off)", async () => {
    const db = reactionDb({
      existing: {
        id: 7,
        roomId: 11,
        messageId: 3,
        userId: 41,
        reaction: "like",
        createdAt: new Date(),
      },
      insertReturning: null,
    });
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(
      toggleHypeRoomMessageReaction(11, 41, 3, "like")
    ).resolves.toMatchObject({ active: false });
    expect(db.delete).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("conflict with no confirming row → explicit error", async () => {
    const db = reactionDb({
      existing: null,
      insertReturning: [],
      confirmed: null,
    });
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(
      toggleHypeRoomMessageReaction(11, 41, 3, "like")
    ).rejects.toThrow("Failed to toggle reaction.");
  });

  it("rejects invalid reaction before getDb", async () => {
    databaseMocks.getDb.mockClear();
    await expect(
      toggleHypeRoomMessageReaction(11, 41, 3, "nope")
    ).rejects.toThrow("Invalid reaction type.");
    expect(databaseMocks.getDb).not.toHaveBeenCalled();
  });

  it("still rejects hidden message and cross-room message", async () => {
    const hidden = reactionDb({
      existing: null,
      insertReturning: [],
    });
    // overwrite message slot — rebuild queue: room, member, hidden message
    hidden.__queue.length = 0;
    hidden.__queue.push(
      { id: 11 },
      activeMember(),
      messageRow({ hiddenAt: new Date() })
    );
    databaseMocks.getDb.mockResolvedValue(hidden as never);
    await expect(
      toggleHypeRoomMessageReaction(11, 41, 3, "like")
    ).rejects.toThrow("Message not found.");

    const cross = reactionDb({ existing: null, insertReturning: [] });
    cross.__queue.length = 0;
    cross.__queue.push(
      { id: 11 },
      activeMember(),
      messageRow({ roomId: 99 })
    );
    databaseMocks.getDb.mockResolvedValue(cross as never);
    await expect(
      toggleHypeRoomMessageReaction(11, 41, 3, "like")
    ).rejects.toThrow("Message does not belong to this room.");
  });
});

/**
 * JHILIK Phase 2 M9 — moderation reports + admin audit (binding E1–E14).
 *
 * - NEW moderation_reports table (legacy `reports` is never touched).
 * - moderation_actions audit for report resolution + message soft-hide only (E10).
 * - Soft-hide reuses hype_room_messages.hiddenAt/moderatedAt/moderatedBy (E11).
 * - No notification writers, no new notification types.
 * Flag: moderation_v1 (fail-closed via router gate).
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  dropClaims,
  drops,
  hypeRoomMessages,
  hypeRooms,
  moderationActions,
  moderationReports,
  users,
  type ModerationReportRow,
} from "../drizzle/schema";
import { getDb } from "./db";

/** Canonical report/audit target types (E7). Never plain "message". */
export const MODERATION_TARGET_TYPES = [
  "hype_room",
  "hype_room_message",
  "drop",
  "user",
] as const;
export type ModerationTargetType = (typeof MODERATION_TARGET_TYPES)[number];

export const MODERATION_REPORT_STATUSES = ["open", "resolved"] as const;
export type ModerationReportStatus = (typeof MODERATION_REPORT_STATUSES)[number];

/** M9 audit actions (E10) — varchar on moderation_actions.action. */
export const MODERATION_ACTIONS = {
  reportResolved: "report_resolved",
  messageHidden: "message_hidden",
} as const;

const REPORT_REASON_MAX = 120;
const ADMIN_REASON_MAX = 500;
const DETAILS_MAX = 2000;

export type CreateModerationReportInput = {
  targetType: ModerationTargetType;
  targetId: number;
  reason: string;
  details?: string | null;
};

export type ListModerationReportsOptions = {
  status?: ModerationReportStatus;
  targetType?: ModerationTargetType;
  limit?: number;
};

function assertTargetType(value: string): asserts value is ModerationTargetType {
  if (!(MODERATION_TARGET_TYPES as readonly string[]).includes(value)) {
    throw new Error("Unsupported report target type.");
  }
}

function assertStatus(value: string): asserts value is ModerationReportStatus {
  if (!(MODERATION_REPORT_STATUSES as readonly string[]).includes(value)) {
    throw new Error("Unsupported report status.");
  }
}

async function assertTargetExists(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  targetType: ModerationTargetType,
  targetId: number
): Promise<void> {
  if (targetType === "user") {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);
    if (!row) throw new Error("Report target not found.");
    return;
  }
  if (targetType === "hype_room") {
    const [row] = await db
      .select({ id: hypeRooms.id })
      .from(hypeRooms)
      .where(eq(hypeRooms.id, targetId))
      .limit(1);
    if (!row) throw new Error("Report target not found.");
    return;
  }
  if (targetType === "hype_room_message") {
    const [row] = await db
      .select({ id: hypeRoomMessages.id })
      .from(hypeRoomMessages)
      .where(eq(hypeRoomMessages.id, targetId))
      .limit(1);
    if (!row) throw new Error("Report target not found.");
    return;
  }
  const [row] = await db
    .select({ id: drops.id })
    .from(drops)
    .where(eq(drops.id, targetId))
    .limit(1);
  if (!row) throw new Error("Report target not found.");
}

async function insertAuditAction(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: {
    adminId: number;
    action: string;
    targetType: ModerationTargetType;
    targetId: number;
    reason: string;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  await db.insert(moderationActions).values({
    adminId: input.adminId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    metadata: input.metadata ?? null,
  });
}

/**
 * User creates a multi-target report (E12 self/duplicate rules).
 * Rate limited at middleware (10/min per E13) — not enforced here.
 */
export async function createModerationReport(
  reporterId: number,
  input: CreateModerationReportInput
): Promise<ModerationReportRow> {
  const targetType = input.targetType;
  assertTargetType(targetType);

  const reason = (input.reason ?? "").trim();
  if (!reason || reason.length > REPORT_REASON_MAX) {
    throw new Error(`Report reason must be 1–${REPORT_REASON_MAX} characters.`);
  }
  if (!Number.isInteger(input.targetId) || input.targetId <= 0) {
    throw new Error("Report targetId is required.");
  }

  let details: string | null = null;
  if (input.details != null) {
    const trimmed = input.details.trim();
    if (trimmed.length > DETAILS_MAX) {
      throw new Error(`Report details must be at most ${DETAILS_MAX} characters.`);
    }
    details = trimmed.length > 0 ? trimmed : null;
  }

  if (targetType === "user" && input.targetId === reporterId) {
    throw new Error("You cannot report yourself.");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    await assertTargetExists(tx as never, targetType, input.targetId);

    const [duplicate] = await tx
      .select({ id: moderationReports.id })
      .from(moderationReports)
      .where(
        and(
          eq(moderationReports.reporterId, reporterId),
          eq(moderationReports.targetType, targetType),
          eq(moderationReports.targetId, input.targetId),
          eq(moderationReports.status, "open")
        )
      )
      .limit(1);
    if (duplicate) {
      throw new Error("You already have an open report for this target.");
    }

    const [inserted] = await tx
      .insert(moderationReports)
      .values({
        reporterId,
        targetType,
        targetId: input.targetId,
        reason,
        details,
        status: "open",
      })
      .returning();
    if (!inserted) throw new Error("Failed to create report.");
    return inserted;
  });
}

/** Admin report queue (E14 admin-only; flag gated at router). */
export async function listModerationReports(
  options: ListModerationReportsOptions = {}
): Promise<{ reports: ModerationReportRow[]; serverNow: Date }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const conditions = [];
  if (options.status != null) {
    assertStatus(options.status);
    conditions.push(eq(moderationReports.status, options.status));
  }
  if (options.targetType != null) {
    assertTargetType(options.targetType);
    conditions.push(eq(moderationReports.targetType, options.targetType));
  }

  const rows = await db
    .select()
    .from(moderationReports)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(moderationReports.createdAt), desc(moderationReports.id))
    .limit(limit);

  return { reports: rows, serverNow: new Date() };
}

/** Admin resolves an open report and writes moderation_actions (E10). */
export async function resolveModerationReport(
  adminId: number,
  reportId: number,
  reason: string
): Promise<ModerationReportRow> {
  const trimmed = (reason ?? "").trim();
  if (!trimmed || trimmed.length > ADMIN_REASON_MAX) {
    throw new Error(`Resolution reason must be 1–${ADMIN_REASON_MAX} characters.`);
  }
  if (!Number.isInteger(reportId) || reportId <= 0) {
    throw new Error("Report id is required.");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [report] = await tx
      .select()
      .from(moderationReports)
      .where(eq(moderationReports.id, reportId))
      .limit(1);
    if (!report) throw new Error("Report not found.");
    if (report.status !== "open") {
      throw new Error("Report is not open.");
    }
    assertTargetType(report.targetType);

    const now = new Date();
    const [updated] = await tx
      .update(moderationReports)
      .set({
        status: "resolved",
        resolvedAt: now,
        resolvedBy: adminId,
      })
      .where(
        and(
          eq(moderationReports.id, reportId),
          eq(moderationReports.status, "open")
        )
      )
      .returning();
    if (!updated) throw new Error("Report is not open.");

    await insertAuditAction(tx as never, {
      adminId,
      action: MODERATION_ACTIONS.reportResolved,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: trimmed,
      metadata: { reportId },
    });
    return updated;
  });
}

/**
 * Admin soft-hides a room message (E11): sets hiddenAt/moderatedAt/moderatedBy.
 * Does not redact body, clear pins, or hard-delete.
 */
export async function adminHideRoomMessage(
  adminId: number,
  messageId: number,
  reason: string
): Promise<typeof hypeRoomMessages.$inferSelect> {
  const trimmed = (reason ?? "").trim();
  if (!trimmed || trimmed.length > ADMIN_REASON_MAX) {
    throw new Error(`Hide reason must be 1–${ADMIN_REASON_MAX} characters.`);
  }
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new Error("Message id is required.");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [message] = await tx
      .select()
      .from(hypeRoomMessages)
      .where(eq(hypeRoomMessages.id, messageId))
      .limit(1);
    if (!message) throw new Error("Message not found.");
    if (message.hiddenAt) throw new Error("Message is already hidden.");

    const now = new Date();
    const [updated] = await tx
      .update(hypeRoomMessages)
      .set({
        hiddenAt: now,
        moderatedAt: now,
        moderatedBy: adminId,
      })
      .where(
        and(
          eq(hypeRoomMessages.id, messageId),
          isNull(hypeRoomMessages.hiddenAt)
        )
      )
      .returning();
    if (!updated) throw new Error("Message is already hidden.");

    await insertAuditAction(tx as never, {
      adminId,
      action: MODERATION_ACTIONS.messageHidden,
      targetType: "hype_room_message",
      targetId: messageId,
      reason: trimmed,
      metadata: { roomId: message.roomId },
    });
    return updated;
  });
}

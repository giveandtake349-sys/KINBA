import {
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  CalendarClock,
  Clock3,
  Eye,
  Flag,
  Lock,
  Pin,
  PinOff,
  Radio,
  RefreshCw,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { ReportDialog } from "@/components/ReportDialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatRoomTime,
  getTrpcCode,
  StatusChip,
  useNow,
  formatCountdown,
  type RoomCard,
} from "./HypeRooms";
import "./hypeRooms.css";

type MemberRow = {
  membership: {
    id: number;
    roomId: number;
    userId: number;
    role: string;
    joinedAt: Date | string;
    leftAt: Date | string | null;
    bannedAt: Date | string | null;
    removedBy: number | null;
  };
  user: {
    id: number;
    name: string | null;
    openId: string;
    photoUrl: string | null;
    username: string | null;
  };
};

type MessageRow = {
  message: {
    id: number;
    roomId: number;
    userId: number | null;
    body: string;
    pinned: boolean;
    createdAt: Date | string;
  };
  user: {
    id: number | null;
    name: string | null;
    openId: string | null;
    photoUrl: string | null;
    username: string | null;
  };
};

const ROOM_MESSAGE_MAX = 5000;

function DetailState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="hype-room-state" role="status">
      <span className="hype-room-state-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action ? <div className="hype-room-state-action">{action}</div> : null}
    </div>
  );
}

function displayMemberName(member: MemberRow): string {
  return (
    member.user.username ||
    member.user.name ||
    `Member #${member.user.id}`
  );
}

function displayMessageName(row: MessageRow): string {
  return (
    row.user.username ||
    row.user.name ||
    (row.user.id != null ? `User #${row.user.id}` : "Removed user")
  );
}

function formatMessageTime(value: Date | string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function countdownFor(
  room: Pick<RoomCard, "status" | "startsAt" | "endsAt">,
  nowMs: number
): { label: string; remaining: string } | null {
  if (room.status === "scheduled") {
    const target = new Date(room.startsAt).getTime();
    const remainingMs = target - nowMs;
    if (remainingMs <= 0) return null;
    return { label: "Starts in", remaining: formatCountdown(remainingMs) };
  }
  if (room.status === "live") {
    const target = new Date(room.endsAt).getTime();
    const remainingMs = target - nowMs;
    if (remainingMs <= 0) return null;
    return { label: "Ends in", remaining: formatCountdown(remainingMs) };
  }
  return null;
}

export default function HypeRoomDetail({
  params,
}: {
  params: { id?: string };
}) {
  const [, navigate] = useLocation();
  const auth = useAuth();
  const nowMs = useNow(1000);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTargetId, setReportTargetId] = useState<number | null>(null);
  const [reportTargetType, setReportTargetType] = useState<
    "hype_room" | "hype_room_message"
  >("hype_room");
  const [reportTitle, setReportTitle] = useState<string | undefined>(undefined);

  const rawId = Number(params?.id);
  const roomId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
  const validId = roomId != null;

  const roomQuery = trpc.hypeRooms.byId.useQuery(
    { roomId: roomId ?? -1 },
    {
      enabled: validId,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    }
  );

  const room = roomQuery.data ?? null;
  const roomReady = validId && !roomQuery.isPending && !roomQuery.isError;

  const errorCode = roomQuery.isError ? getTrpcCode(roomQuery.error) : undefined;
  const unavailable =
    errorCode === "PRECONDITION_FAILED" ||
    (roomQuery.isError &&
      typeof roomQuery.error?.message === "string" &&
      roomQuery.error.message.includes("currently disabled"));

  const membersQuery = trpc.hypeRooms.members.useQuery(
    { roomId: roomId ?? -1 },
    {
      enabled: roomReady && room != null && !unavailable,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    }
  );

  const messagesQuery = trpc.hypeRooms.messages.useQuery(
    { roomId: roomId ?? -1 },
    {
      enabled: roomReady && room != null && !unavailable,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
      refetchInterval: room?.status === "live" ? 5_000 : false,
    }
  );

  const utils = trpc.useUtils();
  const joinMut = trpc.hypeRooms.join.useMutation();
  const leaveMut = trpc.hypeRooms.leave.useMutation();
  const sendMut = trpc.hypeRooms.sendMessage.useMutation();
  const endMut = trpc.hypeRooms.end.useMutation();
  const cancelMut = trpc.hypeRooms.cancel.useMutation();
  const pinMut = trpc.hypeRooms.pin.useMutation();
  const unpinMut = trpc.hypeRooms.unpin.useMutation();
  const removeMemberMut = trpc.hypeRooms.removeMember.useMutation();

  const invalidateRoom = async () => {
    await Promise.all([
      utils.hypeRooms.byId.invalidate(),
      utils.hypeRooms.list.invalidate(),
      utils.hypeRooms.members.invalidate(),
      utils.hypeRooms.messages.invalidate(),
    ]);
  };

  const members = useMemo(
    () => (membersQuery.data ?? []) as MemberRow[],
    [membersQuery.data]
  );
  const messages = useMemo(
    () => (messagesQuery.data ?? []) as MessageRow[],
    [messagesQuery.data]
  );

  const userId = auth.user?.id ?? null;
  const isHost = room != null && userId != null && room.hostId === userId;
  const myMembership =
    userId != null
      ? members.find(member => member.user.id === userId)
      : undefined;
  const isActiveMember = Boolean(myMembership);

  const canJoinWindow =
    room != null && (room.status === "scheduled" || room.status === "live");
  const showJoin = !isActiveMember && canJoinWindow;
  const showLeave = isActiveMember && !isHost;
  const canSend =
    room?.status === "live" && isActiveMember && !auth.loading;
  const canEnd = isHost && room?.status === "live";
  const canCancel = isHost && room?.status === "scheduled";

  const countdown = room ? countdownFor(room, nowMs) : null;
  const pinnedMessageId = room?.pinnedMessageId ?? null;

  const requireAuth = () => {
    if (auth.isAuthenticated) return true;
    auth.openAuth();
    return false;
  };

  const handleJoin = async () => {
    if (!requireAuth() || roomId == null) return;
    try {
      await joinMut.mutateAsync({ roomId });
      await invalidateRoom();
      toast.success("Joined the room.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not join the room."
      );
    }
  };

  const handleLeave = async () => {
    if (!requireAuth() || roomId == null) return;
    try {
      await leaveMut.mutateAsync({ roomId });
      await invalidateRoom();
      toast.success("Left the room.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not leave the room."
      );
    }
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!requireAuth() || roomId == null) return;
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await sendMut.mutateAsync({ roomId, body });
      setDraft("");
      await utils.hypeRooms.messages.invalidate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Message could not be sent."
      );
    } finally {
      setSending(false);
    }
  };

  const handleEnd = async () => {
    if (!requireAuth() || roomId == null) return;
    try {
      await endMut.mutateAsync({ roomId });
      await invalidateRoom();
      toast.success("Room ended.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not end the room."
      );
    }
  };

  const handleCancel = async () => {
    if (!requireAuth() || roomId == null) return;
    try {
      await cancelMut.mutateAsync({ roomId });
      await invalidateRoom();
      toast.success("Room cancelled.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not cancel the room."
      );
    }
  };

  const handlePin = async (messageId: number) => {
    if (!requireAuth()) return;
    try {
      await pinMut.mutateAsync({ messageId });
      await invalidateRoom();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not pin the message."
      );
    }
  };

  const handleUnpin = async () => {
    if (!requireAuth() || roomId == null) return;
    try {
      await unpinMut.mutateAsync({ roomId });
      await invalidateRoom();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not unpin the message."
      );
    }
  };

  const handleRemoveMember = async (targetUserId: number) => {
    if (!requireAuth() || roomId == null) return;
    try {
      await removeMemberMut.mutateAsync({ roomId, userId: targetUserId });
      await invalidateRoom();
      toast.success("Member removed.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not remove the member."
      );
    }
  };

  const backToLobby = () => navigate("/rooms");

  const openRoomReport = () => {
    if (roomId == null) return;
    if (!requireAuth()) return;
    setReportTargetId(roomId);
    setReportTargetType("hype_room");
    setReportTitle("Report room");
    setReportOpen(true);
  };

  const openMessageReport = (messageId: number) => {
    if (!requireAuth()) return;
    setReportTargetId(messageId);
    setReportTargetType("hype_room_message");
    setReportTitle("Report message");
    setReportOpen(true);
  };

  const actionBusy =
    joinMut.isPending ||
    leaveMut.isPending ||
    sendMut.isPending ||
    endMut.isPending ||
    cancelMut.isPending ||
    pinMut.isPending ||
    unpinMut.isPending ||
    removeMemberMut.isPending;

  return (
    <div className="kinba-app hype-rooms-shell">
      <main className="hype-rooms-page section-shell">
        <button type="button" className="hype-rooms-back" onClick={backToLobby}>
          <ArrowLeft size={15} />
          Back to rooms
        </button>

        {!validId ? (
          <DetailState
            icon={<Radio size={22} />}
            title="Room not found."
            body="That Hype Room link is not valid."
            action={
              <button type="button" className="muted-btn" onClick={backToLobby}>
                Back to rooms
              </button>
            }
          />
        ) : roomQuery.isPending ? (
          <div className="hype-room-detail-skeleton" aria-label="Loading room">
            <Skeleton className="hype-room-skeleton-cover" />
            <Skeleton className="hype-room-skeleton-line w-2/3" />
            <Skeleton className="hype-room-skeleton-line w-1/2" />
            <Skeleton className="hype-room-skeleton-line w-full" />
            <Skeleton className="hype-room-skeleton-line w-full" />
          </div>
        ) : unavailable ? (
          <DetailState
            icon={<Radio size={22} />}
            title="Hype Rooms are unavailable right now."
            body="This feature is currently disabled on the server."
          />
        ) : roomQuery.isError ? (
          <DetailState
            icon={<RefreshCw size={22} />}
            title="Could not load this room."
            body="Something went wrong while fetching the room. Try again."
            action={
              <button
                type="button"
                className="muted-btn"
                onClick={() => void roomQuery.refetch()}
              >
                Retry
              </button>
            }
          />
        ) : room == null ? (
          <DetailState
            icon={<Radio size={22} />}
            title="Room not found."
            body="This Hype Room does not exist or is no longer available."
            action={
              <button type="button" className="muted-btn" onClick={backToLobby}>
                Back to rooms
              </button>
            }
          />
        ) : (
          <>
            <header className="hype-room-detail-header">
              <div className="hype-room-detail-heading">
                <div className="hype-room-card-top">
                  <StatusChip status={room.status} />
                  {isHost ? (
                    <span className="hype-room-host-badge">Host</span>
                  ) : null}
                </div>
                <h1>{room.title}</h1>
                {room.topic ? (
                  <p className="hype-room-topic">{room.topic}</p>
                ) : null}
                {room.description ? (
                  <p className="hype-room-desc hype-room-detail-desc">
                    {room.description}
                  </p>
                ) : null}
                {countdown ? (
                  <p className="hype-room-countdown" aria-live="polite">
                    <Clock3 size={14} aria-hidden="true" />
                    {countdown.label} {countdown.remaining}
                  </p>
                ) : null}
                <dl className="hype-room-meta">
                  <div>
                    <dt>
                      <Clock3 size={13} aria-hidden="true" />
                      <span className="sr-only">Duration</span>
                    </dt>
                    <dd>{room.durationHours}h window</dd>
                  </div>
                  <div>
                    <dt>
                      <CalendarClock size={13} aria-hidden="true" />
                      <span className="sr-only">Starts</span>
                    </dt>
                    <dd>Starts {formatRoomTime(room.startsAt)}</dd>
                  </div>
                  <div>
                    <dt>
                      <CalendarClock size={13} aria-hidden="true" />
                      <span className="sr-only">Ends</span>
                    </dt>
                    <dd>Ends {formatRoomTime(room.endsAt)}</dd>
                  </div>
                  <div>
                    <dt>
                      <Eye size={13} aria-hidden="true" />
                      <span className="sr-only">Visibility</span>
                    </dt>
                    <dd>
                      {room.visibility === "public" ? "Public" : "Link only"}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="hype-room-detail-actions">
                {showJoin ? (
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={actionBusy}
                    onClick={() => void handleJoin()}
                  >
                    {joinMut.isPending ? "Joining…" : "Join room"}
                  </button>
                ) : null}
                {showLeave ? (
                  <button
                    type="button"
                    className="muted-btn"
                    disabled={actionBusy}
                    onClick={() => void handleLeave()}
                  >
                    {leaveMut.isPending ? "Leaving…" : "Leave room"}
                  </button>
                ) : null}
                {canEnd ? (
                  <button
                    type="button"
                    className="danger-btn"
                    disabled={actionBusy}
                    onClick={() => void handleEnd()}
                  >
                    {endMut.isPending ? "Ending…" : "End room"}
                  </button>
                ) : null}
                {canCancel ? (
                  <button
                    type="button"
                    className="danger-btn"
                    disabled={actionBusy}
                    onClick={() => void handleCancel()}
                  >
                    {cancelMut.isPending ? "Cancelling…" : "Cancel room"}
                  </button>
                ) : null}
                {!auth.isAuthenticated && canJoinWindow ? (
                  <button
                    type="button"
                    className="muted-btn"
                    onClick={() => auth.openAuth()}
                  >
                    <Lock size={14} aria-hidden="true" />
                    Sign in to join
                  </button>
                ) : null}
                {!isHost && roomId != null ? (
                  <button
                    type="button"
                    className="muted-btn report-action-btn"
                    onClick={openRoomReport}
                  >
                    <Flag size={13} aria-hidden="true" />
                    Report
                  </button>
                ) : null}
              </div>
            </header>

            {room.status === "expired" ? (
              <DetailState
                icon={<Clock3 size={22} />}
                title="This room has ended."
                body="The live window is closed. Chat history remains available below."
              />
            ) : room.status === "archived" ? (
              <DetailState
                icon={<Lock size={22} />}
                title="This room is archived."
                body={
                  room.cancelReason
                    ? `Cancelled: ${room.cancelReason}`
                    : "This room is no longer active."
                }
              />
            ) : null}

            <div className="hype-room-detail-grid">
              <section
                className="hype-room-panel"
                aria-label="Room members"
                aria-busy={membersQuery.isPending || undefined}
              >
                <div className="hype-room-panel-header">
                  <h2>
                    <Users size={15} aria-hidden="true" /> Members
                    {membersQuery.data ? (
                      <span className="hype-room-panel-count">
                        {members.length}
                      </span>
                    ) : null}
                  </h2>
                </div>
                {membersQuery.isPending ? (
                  <div className="hype-room-panel-body">
                    <Skeleton className="hype-room-skeleton-line w-full" />
                    <Skeleton className="hype-room-skeleton-line w-2/3" />
                  </div>
                ) : membersQuery.isError ? (
                  <div className="hype-room-panel-body">
                    <p className="hype-room-panel-error">
                      Could not load members.
                    </p>
                    <button
                      type="button"
                      className="muted-btn"
                      onClick={() => void membersQuery.refetch()}
                    >
                      Retry
                    </button>
                  </div>
                ) : members.length === 0 ? (
                  <div className="hype-room-panel-body">
                    <p className="hype-room-panel-empty">
                      No members yet. Join to get started.
                    </p>
                  </div>
                ) : (
                  <ul className="hype-room-member-list">
                    {members.map(member => {
                      const memberIsHost =
                        member.membership.role === "host" ||
                        member.user.id === room.hostId;
                      const isSelf = member.user.id === userId;
                      return (
                        <li key={member.membership.id}>
                          <span className="hype-room-member-name">
                            {displayMemberName(member)}
                          </span>
                          {memberIsHost ? (
                            <span className="hype-room-host-badge">Host</span>
                          ) : null}
                          {isHost && !memberIsHost && !isSelf ? (
                            <button
                              type="button"
                              className="hype-room-icon-btn"
                              aria-label={`Remove ${displayMemberName(member)}`}
                              title="Remove member"
                              disabled={actionBusy}
                              onClick={() =>
                                void handleRemoveMember(member.user.id)
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section
                className="hype-room-panel hype-room-chat"
                aria-label="Room chat"
                aria-busy={messagesQuery.isPending || undefined}
              >
                <div className="hype-room-panel-header">
                  <h2>
                    <Send size={15} aria-hidden="true" /> Messages
                  </h2>
                  {isHost && pinnedMessageId != null ? (
                    <button
                      type="button"
                      className="hype-room-icon-btn"
                      aria-label="Unpin message"
                      title="Unpin message"
                      disabled={actionBusy}
                      onClick={() => void handleUnpin()}
                    >
                      <PinOff size={14} />
                    </button>
                  ) : null}
                </div>

                {pinnedMessageId != null ? (
                  (() => {
                    const pinned = messages.find(
                      row => row.message.id === pinnedMessageId
                    );
                    if (!pinned) return null;
                    return (
                      <div className="hype-room-pinned">
                        <Pin size={12} aria-hidden="true" />
                        <span>
                          <strong>{displayMessageName(pinned)}:</strong>{" "}
                          {pinned.message.body}
                        </span>
                      </div>
                    );
                  })()
                ) : null}

                <div className="hype-room-panel-body hype-room-messages">
                  {messagesQuery.isPending ? (
                    <>
                      <Skeleton className="hype-room-skeleton-line w-full" />
                      <Skeleton className="hype-room-skeleton-line w-3/4" />
                      <Skeleton className="hype-room-skeleton-line w-5/6" />
                    </>
                  ) : messagesQuery.isError ? (
                    <div className="hype-room-panel-error-block">
                      <p className="hype-room-panel-error">
                        Could not load messages.
                      </p>
                      <button
                        type="button"
                        className="muted-btn"
                        onClick={() => void messagesQuery.refetch()}
                      >
                        Retry
                      </button>
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="hype-room-panel-empty">
                      {room.status === "live"
                        ? "No messages yet. Say hello when you join."
                        : "Chat opens when the room is live."}
                    </p>
                  ) : (
                    <ul className="hype-room-message-list">
                      {messages.map(row => (
                        <li
                          key={row.message.id}
                          className={
                            row.message.id === pinnedMessageId
                              ? "hype-room-message--pinned"
                              : undefined
                          }
                        >
                          <div className="hype-room-message-meta">
                            <span className="hype-room-message-author">
                              {displayMessageName(row)}
                            </span>
                            <time dateTime={String(row.message.createdAt)}>
                              {formatMessageTime(row.message.createdAt)}
                            </time>
                            {isHost ? (
                              row.message.id === pinnedMessageId ? null : (
                                <button
                                  type="button"
                                  className="hype-room-icon-btn"
                                  aria-label="Pin message"
                                  title="Pin message"
                                  disabled={actionBusy}
                                  onClick={() =>
                                    void handlePin(row.message.id)
                                  }
                                >
                                  <Pin size={13} />
                                </button>
                              )
                            ) : null}
                            {row.message.userId != null &&
                            userId != null &&
                            row.message.userId !== userId ? (
                              <button
                                type="button"
                                className="hype-room-icon-btn"
                                aria-label="Report message"
                                title="Report message"
                                onClick={() =>
                                  openMessageReport(row.message.id)
                                }
                              >
                                <Flag size={13} />
                              </button>
                            ) : null}
                          </div>
                          <p className="hype-room-message-body">
                            {row.message.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {canSend ? (
                  <form
                    className="hype-room-composer"
                    onSubmit={event => void handleSend(event)}
                  >
                    <label className="sr-only" htmlFor="hype-room-message">
                      Message
                    </label>
                    <textarea
                      id="hype-room-message"
                      value={draft}
                      onChange={event => setDraft(event.target.value)}
                      maxLength={ROOM_MESSAGE_MAX}
                      rows={2}
                      placeholder="Send a message to the room…"
                    />
                    <button
                      type="submit"
                      className="primary-btn"
                      disabled={sending || draft.trim().length === 0}
                    >
                      {sending ? "Sending…" : "Send"}
                    </button>
                  </form>
                ) : room.status === "live" && !isActiveMember ? (
                  <p className="hype-room-composer-hint">
                    Join the room to send messages.
                  </p>
                ) : null}
              </section>
            </div>
          </>
        )}
      </main>
      {auth.authDialogOpen && !auth.isAuthenticated ? (
        <SupabaseAuthDialog
          open
          onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
        />
      ) : null}
      <ReportDialog
        open={reportOpen}
        onClose={() => {
          setReportOpen(false);
          setReportTargetId(null);
          setReportTargetType("hype_room");
          setReportTitle(undefined);
        }}
        targetType={reportTargetType}
        targetId={reportTargetId}
        title={reportTitle}
      />
    </div>
  );
}

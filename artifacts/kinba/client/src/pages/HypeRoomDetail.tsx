import {
  useMemo,
  useState,
  useEffect,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  AtSign,
  CalendarClock,
  Check,
  Clock3,
  CornerUpLeft,
  Eye,
  Flag,
  Flame,
  Hand,
  Heart,
  Lock,
  Mail,
  Pin,
  PinOff,
  Radio,
  RefreshCw,
  Send,
  Settings,
  ThumbsUp,
  Trash2,
  UserPlus,
  Users,
  X,
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
    parentId: number | null;
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
  parent?: {
    id: number;
    body: string | null;
    userId: number | null;
  } | null;
  reactions?: Array<{
    reaction: string;
    count: number;
    reactedByMe: boolean;
  }>;
  mentionUserIds?: number[];
};

type InviteRow = {
  id: number;
  roomId: number;
  invitedUserId: number;
  createdBy: number;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  consumedAt: Date | string | null;
};

type InviteTarget = {
  id: number;
  name: string | null;
  username: string | null;
  photoUrl: string | null;
};

const ROOM_MESSAGE_MAX = 5000;

const HYPE_REACTIONS = [
  { id: "like", label: "Like", Icon: ThumbsUp },
  { id: "love", label: "Love", Icon: Heart },
  { id: "fire", label: "Fire", Icon: Flame },
  { id: "clap", label: "Clap", Icon: Hand },
] as const;

type HypeReactionId = (typeof HYPE_REACTIONS)[number]["id"];

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

function displayInviteName(id: number, members: MemberRow[]): string {
  const match = members.find(member => member.user.id === id);
  return match ? displayMemberName(match) : `User #${id}`;
}

function roleLabel(role: string): string {
  if (role === "host") return "Host";
  if (role === "speaker") return "Speaker";
  if (role === "audience") return "Audience";
  return "Member";
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

function applyReactionOptimistic(
  rows: MessageRow[],
  messageId: number,
  reaction: HypeReactionId
): MessageRow[] {
  return rows.map(row => {
    if (row.message.id !== messageId) return row;
    const list = [...(row.reactions ?? [])];
    const idx = list.findIndex(entry => entry.reaction === reaction);
    const existing = idx >= 0 ? list[idx] : null;
    const wasMine = existing?.reactedByMe ?? false;
    const count = existing?.count ?? 0;
    if (wasMine) {
      const next = count - 1;
      if (next <= 0) {
        if (idx >= 0) list.splice(idx, 1);
      } else if (idx >= 0) {
        list[idx] = { reaction, count: next, reactedByMe: false };
      }
    } else if (idx >= 0) {
      list[idx] = { reaction, count: count + 1, reactedByMe: true };
    } else {
      list.push({ reaction, count: 1, reactedByMe: true });
    }
    return { ...row, reactions: list };
  });
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
  const [replyTarget, setReplyTarget] = useState<MessageRow | null>(null);
  const [mentionedIds, setMentionedIds] = useState<number[]>([]);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTitle, setSettingsTitle] = useState("");
  const [settingsTopic, setSettingsTopic] = useState("");
  const [settingsDescription, setSettingsDescription] = useState("");
  const [settingsVisibility, setSettingsVisibility] = useState<
    "public" | "link_only"
  >("public");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteTerm, setInviteTerm] = useState("");
  const [inviteDebounced, setInviteDebounced] = useState("");
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
  const reactionMut = trpc.hypeRooms.toggleReaction.useMutation();
  const setRoleMut = trpc.hypeRooms.setMemberRole.useMutation();
  const updateSettingsMut = trpc.hypeRooms.updateSettings.useMutation();
  const createInviteMut = trpc.hypeRooms.createInvite.useMutation();

  const canEditSettings =
    room != null &&
    isHostNow(room.hostId, auth.user?.id ?? null) &&
    (room.status === "scheduled" || room.status === "live");

  const invitesQuery = trpc.hypeRooms.listInvites.useQuery(
    { roomId: roomId ?? -1 },
    {
      enabled: canEditSettings && roomId != null,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    }
  );

  useEffect(() => {
    const id = window.setTimeout(() => setInviteDebounced(inviteTerm), 300);
    return () => window.clearTimeout(id);
  }, [inviteTerm]);

  const inviteSearchQuery = trpc.home.searchAll.useQuery(
    { term: inviteDebounced },
    {
      enabled:
        inviteOpen &&
        inviteDebounced.trim().length >= 2 &&
        canEditSettings,
      retry: false,
      refetchOnWindowFocus: false,
      throwOnError: false,
      staleTime: 15_000,
    }
  );

  const invalidateRoom = async () => {
    await Promise.all([
      utils.hypeRooms.byId.invalidate(),
      utils.hypeRooms.list.invalidate(),
      utils.hypeRooms.members.invalidate(),
      utils.hypeRooms.messages.invalidate(),
      utils.hypeRooms.listInvites.invalidate(),
      utils.hypeRooms.listMyInvites.invalidate(),
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
  const invites = useMemo(
    () => (invitesQuery.data ?? []) as InviteRow[],
    [invitesQuery.data]
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

  const clearComposerExtras = () => {
    setReplyTarget(null);
    setMentionedIds([]);
    setMentionPickerOpen(false);
  };

  const handleSend = async (event: FormEvent) => {
    event.preventDefault();
    if (!requireAuth() || roomId == null) return;
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await sendMut.mutateAsync({
        roomId,
        body,
        ...(replyTarget ? { parentId: replyTarget.message.id } : {}),
        ...(mentionedIds.length > 0
          ? { mentionedUserIds: mentionedIds }
          : {}),
      });
      setDraft("");
      clearComposerExtras();
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

  const handleReaction = async (messageId: number, reaction: HypeReactionId) => {
    if (!requireAuth() || roomId == null) return;
    const queryKey = { roomId };
    const prev = utils.hypeRooms.messages.getData(queryKey) as
      | MessageRow[]
      | undefined;
    if (prev) {
      utils.hypeRooms.messages.setData(
        queryKey,
        applyReactionOptimistic(prev, messageId, reaction) as never
      );
    }
    try {
      await reactionMut.mutateAsync({ roomId, messageId, reaction });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update reaction."
      );
    } finally {
      await utils.hypeRooms.messages.invalidate();
    }
  };

  const handleSetRole = async (
    targetUserId: number,
    role: "speaker" | "audience"
  ) => {
    if (!requireAuth() || roomId == null) return;
    try {
      await setRoleMut.mutateAsync({ roomId, userId: targetUserId, role });
      await utils.hypeRooms.members.invalidate();
      toast.success(
        role === "speaker" ? "Promoted to speaker." : "Moved to audience."
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not change member role."
      );
    }
  };

  const openSettings = () => {
    if (!room || !canEditSettings) return;
    if (!requireAuth()) return;
    setSettingsTitle(room.title);
    setSettingsTopic(room.topic ?? "");
    setSettingsDescription(room.description ?? "");
    setSettingsVisibility(room.visibility);
    setSettingsOpen(true);
  };

  const handleSettingsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!requireAuth() || roomId == null) return;
    const title = settingsTitle.trim();
    if (title.length < 3) {
      toast.error("Room title must be 3–180 characters.");
      return;
    }
    try {
      await updateSettingsMut.mutateAsync({
        roomId,
        title,
        topic: settingsTopic.trim() ? settingsTopic.trim() : null,
        description: settingsDescription.trim()
          ? settingsDescription.trim()
          : null,
        visibility: settingsVisibility,
      });
      setSettingsOpen(false);
      await invalidateRoom();
      toast.success("Room settings updated.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update room settings."
      );
    }
  };

  const openInvite = () => {
    if (!canEditSettings || roomId == null) return;
    if (!requireAuth()) return;
    setInviteTerm("");
    setInviteDebounced("");
    setInviteOpen(true);
  };

  const inviteSearchResults = useMemo(() => {
    const users =
      (inviteSearchQuery.data?.users as InviteTarget[] | undefined) ?? [];
    const memberIds = new Set(members.map(member => member.user.id));
    const invitedIds = new Set(invites.map(invite => invite.invitedUserId));
    return users.filter(user => {
      if (user.id === userId) return false;
      if (room && user.id === room.hostId) return false;
      if (memberIds.has(user.id)) return false;
      if (invitedIds.has(user.id)) return false;
      return true;
    });
  }, [
    inviteSearchQuery.data,
    members,
    invites,
    userId,
    room,
  ]);

  const handleCreateInvite = async (invitedUserId: number) => {
    if (!requireAuth() || roomId == null) return;
    try {
      await createInviteMut.mutateAsync({ roomId, invitedUserId });
      await Promise.all([
        utils.hypeRooms.listInvites.invalidate(),
        utils.hypeRooms.listMyInvites.invalidate(),
      ]);
      toast.success("Invite sent.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create invite."
      );
    }
  };

  const startReply = (row: MessageRow) => {
    if (!requireAuth()) return;
    if (row.message.parentId != null) return;
    setReplyTarget(row);
    setMentionPickerOpen(false);
  };

  const toggleMention = (memberUserId: number) => {
    if (memberUserId === userId) return;
    setMentionedIds(prev =>
      prev.includes(memberUserId)
        ? prev.filter(id => id !== memberUserId)
        : [...prev, memberUserId]
    );
  };

  const mentionableMembers = useMemo(
    () => members.filter(member => member.user.id !== userId),
    [members, userId]
  );

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
    removeMemberMut.isPending ||
    reactionMut.isPending ||
    setRoleMut.isPending ||
    updateSettingsMut.isPending ||
    createInviteMut.isPending;

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
                {canEditSettings ? (
                  <button
                    type="button"
                    className="muted-btn"
                    onClick={openSettings}
                  >
                    <Settings size={14} aria-hidden="true" />
                    Settings
                  </button>
                ) : null}
                {canEditSettings ? (
                  <button
                    type="button"
                    className="muted-btn"
                    onClick={openInvite}
                  >
                    <UserPlus size={14} aria-hidden="true" />
                    Invite
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
                      const currentRole = memberIsHost
                        ? "host"
                        : member.membership.role;
                      return (
                        <li key={member.membership.id}>
                          <span className="hype-room-member-name">
                            {displayMemberName(member)}
                          </span>
                          <span
                            className={`hype-room-role-badge hype-room-role--${currentRole}`}
                          >
                            {roleLabel(currentRole)}
                          </span>
                          {isHost && !memberIsHost && !isSelf ? (
                            currentRole === "speaker" ? (
                              <button
                                type="button"
                                className="hype-room-icon-btn"
                                aria-label={`Move ${displayMemberName(member)} to audience`}
                                title="Move to audience"
                                disabled={actionBusy}
                                onClick={() =>
                                  void handleSetRole(member.user.id, "audience")
                                }
                              >
                                <Users size={14} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="hype-room-icon-btn"
                                aria-label={`Promote ${displayMemberName(member)} to speaker`}
                                title="Promote to speaker"
                                disabled={actionBusy}
                                onClick={() =>
                                  void handleSetRole(member.user.id, "speaker")
                                }
                              >
                                <Send size={14} />
                              </button>
                            )
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
                {isHost && invitesQuery.data ? (
                  <div className="hype-room-invites-inline">
                    <h3>
                      <Mail size={13} aria-hidden="true" /> Room invites (
                      {invites.length})
                    </h3>
                    {invites.length === 0 ? (
                      <p className="hype-room-panel-empty">
                        No invites yet. Use Invite to search for people.
                      </p>
                    ) : (
                      <ul className="hype-room-invite-list">
                        {invites.map(invite => (
                          <li key={invite.id}>
                            <span>
                              {displayInviteName(invite.invitedUserId, members)}
                            </span>
                            <span
                              className={`hype-room-invite-status hype-room-invite-status--${invite.status}`}
                            >
                              {invite.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
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
                      {messages.map(row => {
                        const isTopLevel = row.message.parentId == null;
                        const hasParent =
                          row.message.parentId != null ||
                          (row.parent != null && row.parent.id != null);
                        return (
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
                              {canSend && isTopLevel ? (
                                <button
                                  type="button"
                                  className="hype-room-icon-btn"
                                  aria-label="Reply to message"
                                  title="Reply"
                                  onClick={() => startReply(row)}
                                >
                                  <CornerUpLeft size={13} />
                                </button>
                              ) : null}
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
                            {hasParent ? (
                              <div className="hype-room-message-parent">
                                {row.parent ? (
                                  <>
                                    <span className="hype-room-message-parent-label">
                                      Reply to{" "}
                                      {row.parent.userId != null
                                        ? displayInviteName(
                                            row.parent.userId,
                                            members
                                          )
                                        : "message"}
                                    </span>
                                    <span className="hype-room-message-parent-body">
                                      {row.parent.body ?? ""}
                                    </span>
                                  </>
                                ) : (
                                  <span className="hype-room-message-parent-label">
                                    Reply to a removed message
                                  </span>
                                )}
                              </div>
                            ) : null}
                            <p className="hype-room-message-body">
                              {row.message.body}
                            </p>
                            {row.mentionUserIds &&
                            row.mentionUserIds.length > 0 ? (
                              <p className="hype-room-message-mentions">
                                Mentioned:{" "}
                                {row.mentionUserIds
                                  .map(id => displayInviteName(id, members))
                                  .join(", ")}
                              </p>
                            ) : null}
                            <div
                              className="hype-room-reactions"
                              role="group"
                              aria-label="Message reactions"
                            >
                              {HYPE_REACTIONS.map(
                                ({ id, label, Icon }) => {
                                  const entry = (
                                    row.reactions ?? []
                                  ).find(r => r.reaction === id);
                                  const count = entry?.count ?? 0;
                                  const mine = entry?.reactedByMe ?? false;
                                  const visible = count > 0 || mine;
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      className={
                                        mine
                                          ? "hype-room-reaction hype-room-reaction--on"
                                          : "hype-room-reaction"
                                      }
                                      aria-label={
                                        mine
                                          ? `Remove ${label} reaction`
                                          : `React with ${label}`
                                      }
                                      aria-pressed={mine}
                                      title={label}
                                      disabled={!isActiveMember}
                                      onClick={() =>
                                        void handleReaction(row.message.id, id)
                                      }
                                    >
                                      <Icon size={13} aria-hidden="true" />
                                      {visible ? (
                                        <span className="hype-room-reaction-count">
                                          {count}
                                        </span>
                                      ) : null}
                                    </button>
                                  );
                                }
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {canSend ? (
                  <form
                    className="hype-room-composer"
                    onSubmit={event => void handleSend(event)}
                  >
                    {replyTarget ? (
                      <div className="hype-room-reply-banner">
                        <span>
                          Replying to{" "}
                          <strong>{displayMessageName(replyTarget)}</strong>
                        </span>
                        <button
                          type="button"
                          className="hype-room-icon-btn"
                          aria-label="Cancel reply"
                          title="Cancel reply"
                          onClick={() => setReplyTarget(null)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : null}
                    {mentionedIds.length > 0 ? (
                      <div className="hype-room-mention-chips">
                        {mentionedIds.map(id => {
                          const member = members.find(
                            row => row.user.id === id
                          );
                          return (
                            <span
                              key={id}
                              className="hype-room-mention-chip"
                            >
                              @{member ? displayMemberName(member) : `user${id}`}
                              <button
                                type="button"
                                aria-label={`Remove mention ${
                                  member ? displayMemberName(member) : id
                                }`}
                                onClick={() => toggleMention(id)}
                              >
                                <X size={11} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                    {mentionPickerOpen ? (
                      <div
                        className="hype-room-mention-picker"
                        role="listbox"
                        aria-label="Mention a member"
                      >
                        {mentionableMembers.length === 0 ? (
                          <p className="hype-room-panel-empty">
                            No other members to mention.
                          </p>
                        ) : (
                          mentionableMembers.map(member => {
                            const selected = mentionedIds.includes(
                              member.user.id
                            );
                            return (
                              <button
                                key={member.membership.id}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={
                                  selected
                                    ? "hype-room-mention-option hype-room-mention-option--on"
                                    : "hype-room-mention-option"
                                }
                                onClick={() => toggleMention(member.user.id)}
                              >
                                <span>{displayMemberName(member)}</span>
                                {selected ? (
                                  <Check size={13} aria-hidden="true" />
                                ) : null}
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                    <label className="sr-only" htmlFor="hype-room-message">
                      Message
                    </label>
                    <textarea
                      id="hype-room-message"
                      value={draft}
                      onChange={event => setDraft(event.target.value)}
                      maxLength={ROOM_MESSAGE_MAX}
                      rows={2}
                      placeholder={
                        replyTarget
                          ? "Write a reply…"
                          : "Send a message to the room…"
                      }
                    />
                    <div className="hype-room-composer-actions">
                      <button
                        type="button"
                        className={
                          mentionPickerOpen
                            ? "hype-room-icon-btn hype-room-icon-btn--on"
                            : "hype-room-icon-btn"
                        }
                        aria-label="Mention members"
                        aria-pressed={mentionPickerOpen}
                        title="Mention"
                        onClick={() => setMentionPickerOpen(open => !open)}
                      >
                        <AtSign size={14} />
                      </button>
                      <button
                        type="submit"
                        className="primary-btn"
                        disabled={sending || draft.trim().length === 0}
                      >
                        {sending ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </form>
                ) : room.status === "live" && !isActiveMember ? (
                  <p className="hype-room-composer-hint">
                    Join the room to send messages.
                  </p>
                ) : null}
              </section>
            </div>

            {settingsOpen ? (
              <div className="action-modal-layer" role="presentation">
                <button
                  type="button"
                  className="action-modal-backdrop"
                  aria-label="Close room settings"
                  onClick={() => setSettingsOpen(false)}
                />
                <section
                  className="action-modal report-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Room settings"
                >
                  <div className="action-modal-head">
                    <h2>
                      <Settings size={18} aria-hidden="true" /> Room settings
                    </h2>
                    <button
                      type="button"
                      aria-label="Close room settings"
                      onClick={() => setSettingsOpen(false)}
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <form
                    className="modal-form report-dialog-form"
                    onSubmit={handleSettingsSubmit}
                  >
                    <p className="report-dialog-hint">
                      Title, topic, description, and visibility only. Lifecycle
                      and host cannot change here.
                    </p>
                    <label htmlFor="hype-settings-title">
                      Title <span className="report-dialog-req">(required)</span>
                      <input
                        id="hype-settings-title"
                        value={settingsTitle}
                        onChange={event => setSettingsTitle(event.target.value)}
                        minLength={3}
                        maxLength={180}
                        required
                        autoComplete="off"
                        placeholder="Room title (3–180 characters)"
                      />
                    </label>
                    <label htmlFor="hype-settings-topic">
                      Topic{" "}
                      <span className="report-dialog-optional">(optional)</span>
                      <input
                        id="hype-settings-topic"
                        value={settingsTopic}
                        onChange={event => setSettingsTopic(event.target.value)}
                        maxLength={120}
                        autoComplete="off"
                        placeholder="Topic tag (max 120 characters)"
                      />
                    </label>
                    <label htmlFor="hype-settings-description">
                      Description{" "}
                      <span className="report-dialog-optional">(optional)</span>
                      <textarea
                        id="hype-settings-description"
                        value={settingsDescription}
                        onChange={event =>
                          setSettingsDescription(event.target.value)
                        }
                        maxLength={2000}
                        rows={4}
                        placeholder="Room description (max 2000 characters)"
                      />
                    </label>
                    <label htmlFor="hype-settings-visibility">
                      Visibility
                      <select
                        id="hype-settings-visibility"
                        value={settingsVisibility}
                        onChange={event =>
                          setSettingsVisibility(
                            event.target.value as "public" | "link_only"
                          )
                        }
                      >
                        <option value="public">Public</option>
                        <option value="link_only">Link only</option>
                      </select>
                    </label>
                    <div className="report-dialog-actions">
                      <button
                        type="button"
                        className="muted-btn"
                        onClick={() => setSettingsOpen(false)}
                        disabled={updateSettingsMut.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="primary-btn"
                        disabled={
                          updateSettingsMut.isPending ||
                          settingsTitle.trim().length < 3
                        }
                      >
                        {updateSettingsMut.isPending
                          ? "Saving…"
                          : "Save settings"}
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            ) : null}

            {inviteOpen ? (
              <div className="action-modal-layer" role="presentation">
                <button
                  type="button"
                  className="action-modal-backdrop"
                  aria-label="Close invite"
                  onClick={() => setInviteOpen(false)}
                />
                <section
                  className="action-modal report-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Invite to room"
                >
                  <div className="action-modal-head">
                    <h2>
                      <UserPlus size={18} aria-hidden="true" /> Invite to room
                    </h2>
                    <button
                      type="button"
                      aria-label="Close invite"
                      onClick={() => setInviteOpen(false)}
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="modal-form report-dialog-form">
                    <p className="report-dialog-hint">
                      Search people by name or username. Current members cannot
                      be invited again.
                    </p>
                    <label htmlFor="hype-invite-search">
                      Search
                      <input
                        id="hype-invite-search"
                        value={inviteTerm}
                        onChange={event => setInviteTerm(event.target.value)}
                        maxLength={120}
                        autoComplete="off"
                        placeholder="Name or @username (min 2 characters)"
                      />
                    </label>
                    <div
                      className="hype-room-invite-results"
                      aria-live="polite"
                      aria-busy={inviteSearchQuery.isPending || undefined}
                    >
                      {inviteDebounced.trim().length < 2 ? (
                        <p className="hype-room-panel-empty">
                          Type at least 2 characters to search.
                        </p>
                      ) : inviteSearchQuery.isPending ? (
                        <Skeleton className="hype-room-skeleton-line w-full" />
                      ) : inviteSearchQuery.isError ? (
                        <p className="hype-room-panel-error">
                          Could not search right now.
                        </p>
                      ) : inviteSearchResults.length === 0 ? (
                        <p className="hype-room-panel-empty">
                          No people found (or they are already members).
                        </p>
                      ) : (
                        <ul className="hype-room-invite-results-list">
                          {inviteSearchResults.map(user => (
                            <li key={user.id}>
                              <span>
                                {user.username || user.name || `User #${user.id}`}
                              </span>
                              <button
                                type="button"
                                className="muted-btn"
                                disabled={createInviteMut.isPending}
                                onClick={() =>
                                  void handleCreateInvite(user.id)
                                }
                              >
                                Invite
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="report-dialog-actions">
                      <button
                        type="button"
                        className="muted-btn"
                        onClick={() => setInviteOpen(false)}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}
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

function isHostNow(hostId: number, userId: number | null): boolean {
  return userId != null && hostId === userId;
}

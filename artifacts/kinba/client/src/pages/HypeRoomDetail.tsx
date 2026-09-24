import {
  useMemo,
  useState,
  useEffect,
  type FormEvent,
  type ReactNode,
} from "react";
import { Flag, Radio, RefreshCw, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { ReportDialog } from "@/components/ReportDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { getTrpcCode, useNow } from "./HypeRooms";
import { RoomHeader } from "./hypeRoom/RoomHeader";
import { ActivityBar, PinnedHostNote } from "./hypeRoom/ActivityBar";
import { MessageCard, type HypeReactionId } from "./hypeRoom/MessageCard";
import { ThreadSheet } from "./hypeRoom/ThreadSheet";
import { MembersPanel } from "./hypeRoom/MembersPanel";
import { DropPanel } from "./hypeRoom/DropPanel";
import { EmptyRoom } from "./hypeRoom/EmptyRoom";
import { SettingsModal } from "./hypeRoom/SettingsModal";
import { InviteModal } from "./hypeRoom/InviteModal";
import { LifecycleBanner } from "./hypeRoom/LifecycleBanner";
import { Composer } from "./hypeRoom/Composer";
import {
  displayMemberName,
  displayMessageName,
  type InviteRow,
  type InviteTarget,
  type MemberRow,
  type MessageRow,
} from "./hypeRoom/shared";
import "./hypeRooms.css";

type HypeReaction = HypeReactionId;

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

function applyReactionOptimistic(
  rows: MessageRow[],
  messageId: number,
  reaction: HypeReaction
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
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [threadRootId, setThreadRootId] = useState<number | null>(null);
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

  const hostMember = useMemo(() => {
    if (room == null) return undefined;
    const rows = (membersQuery.data ?? []) as MemberRow[];
    return rows.find(member => member.user.id === room.hostId);
  }, [membersQuery.data, room]);

  // Only fetch host identity when the host is not already in the member list.
  const hostProfileQuery = trpc.profile.byId.useQuery(
    { userId: room?.hostId ?? -1 },
    {
      enabled:
        roomReady &&
        room != null &&
        !unavailable &&
        ((membersQuery.isSuccess && hostMember == null) ||
          membersQuery.isError),
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
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

  const dropId = room?.dropId ?? null;
  const dropQuery = trpc.drops.byId.useQuery(
    { dropId: dropId ?? -1 },
    {
      enabled: dropId != null && roomReady && room != null,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
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

  const replyCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const row of messages) {
      const parentId = row.message.parentId;
      if (parentId != null) {
        map.set(parentId, (map.get(parentId) ?? 0) + 1);
      }
    }
    return map;
  }, [messages]);

  const topLevelMessages = useMemo(
    () => messages,
    [messages]
  );

  const threadRoot = useMemo(() => {
    if (threadRootId == null) return null;
    return messages.find(row => row.message.id === threadRootId) ?? null;
  }, [threadRootId, messages]);

  const userId = auth.user?.id ?? null;
  const isHost = room != null && userId != null && room.hostId === userId;
  const myMembership =
    userId != null
      ? members.find(member => member.user.id === userId)
      : undefined;
  const isActiveMember = Boolean(myMembership);

  const hostProfile = hostProfileQuery.data ?? null;
  const hostFallbackName =
    isHost && userId != null ? auth.user?.name || `User #${userId}` : null;
  const hostName = hostMember
    ? displayMemberName(hostMember)
    : hostProfile
      ? hostProfile.profile?.username ||
        hostProfile.user?.name ||
        `User #${room?.hostId ?? ""}`
      : hostFallbackName;
  const hostPhoto = hostMember
    ? hostMember.user.photoUrl
    : hostProfile?.profile?.photoUrl ?? null;

  const canJoinWindow =
    room != null && (room.status === "scheduled" || room.status === "live");
  const showJoin = !isActiveMember && canJoinWindow;
  const showLeave = isActiveMember && !isHost;
  const canSend =
    room?.status === "live" && isActiveMember && !auth.loading;
  const canEnd = isHost && room?.status === "live";
  const canCancel = isHost && room?.status === "scheduled";
  const showSignIn = !auth.isAuthenticated && !auth.loading && canJoinWindow;

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

  const handleReaction = async (messageId: number, reaction: HypeReaction) => {
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

  const handleSettingsSubmit = async (values: {
    title: string;
    topic: string;
    description: string;
    visibility: "public" | "link_only";
  }) => {
    if (!requireAuth() || roomId == null) return;
    if (values.title.length < 3) {
      toast.error("Room title must be 3–180 characters.");
      return;
    }
    try {
      await updateSettingsMut.mutateAsync({
        roomId,
        title: values.title,
        topic: values.topic ? values.topic : null,
        description: values.description ? values.description : null,
        visibility: values.visibility,
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
    setThreadRootId(null);
  };

  const openThread = (row: MessageRow) => {
    if (row.message.parentId != null) return;
    setThreadRootId(row.message.id);
    if (requireAuth()) {
      setReplyTarget(row);
    }
  };

  const toggleMention = (memberUserId: number) => {
    if (memberUserId === userId) return;
    setMentionedIds(prev =>
      prev.includes(memberUserId)
        ? prev.filter(id => id !== memberUserId)
        : [...prev, memberUserId]
    );
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
    removeMemberMut.isPending ||
    reactionMut.isPending ||
    setRoleMut.isPending ||
    updateSettingsMut.isPending ||
    createInviteMut.isPending;

  const pinnedMessage = useMemo(() => {
    if (pinnedMessageId == null) return null;
    return messages.find(row => row.message.id === pinnedMessageId) ?? null;
  }, [pinnedMessageId, messages]);

  const dropData = dropQuery.data?.drop ?? null;

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
            <RoomHeader
              room={room}
              nowMs={nowMs}
              isHost={isHost}
              isActiveMember={isActiveMember}
              showJoin={showJoin}
              showLeave={showLeave}
              canEnd={canEnd}
              canCancel={canCancel}
              canEditSettings={canEditSettings}
              showSignIn={showSignIn}
              participantCount={
                membersQuery.data ? members.length : null
              }
              hostName={hostName}
              hostPhoto={hostPhoto}
              actionBusy={actionBusy}
              joinPending={joinMut.isPending}
              leavePending={leaveMut.isPending}
              endPending={endMut.isPending}
              cancelPending={cancelMut.isPending}
              onJoin={() => void handleJoin()}
              onLeave={() => void handleLeave()}
              onEnd={() => void handleEnd()}
              onCancel={() => void handleCancel()}
              onOpenSettings={openSettings}
              onOpenInvite={openInvite}
              onOpenReport={openRoomReport}
              onSignIn={() => auth.openAuth()}
            />

            <LifecycleBanner room={room} nowMs={nowMs} />

            <ActivityBar
              participantCount={membersQuery.data ? members.length : null}
              messageCount={
                messagesQuery.data != null ? messages.length : null
              }
              hasDrop={dropId != null}
              dropLabel={
                dropData
                  ? `${Math.max(0, dropData.remainingQuantity)} left`
                  : dropId != null
                    ? "linked"
                    : undefined
              }
            />

            {pinnedMessage ? (
              <PinnedHostNote
                authorName={displayMessageName(pinnedMessage)}
                body={pinnedMessage.message.body}
                canUnpin={isHost}
                busy={actionBusy}
                onUnpin={() => void handleUnpin()}
              />
            ) : null}

            <div className="hype-room-detail-grid">
              <div className="hype-room-side">
                <MembersPanel
                  members={members}
                  invites={invites}
                  hostId={room.hostId}
                  isHostViewer={isHost}
                  viewerId={userId}
                  busy={actionBusy}
                  loading={membersQuery.isPending}
                  error={membersQuery.isError}
                  invitesReady={Boolean(invitesQuery.data)}
                  onRetry={() => void membersQuery.refetch()}
                  onSetRole={(id, role) => void handleSetRole(id, role)}
                  onRemove={id => void handleRemoveMember(id)}
                />

                {dropId != null ? (
                  <DropPanel
                    drop={
                      dropData
                        ? {
                            id: dropData.id,
                            title: dropData.title,
                            status: dropData.status,
                            discountedPrice: dropData.discountedPrice,
                            originalPrice: dropData.originalPrice,
                            currency: dropData.currency,
                            remainingQuantity: dropData.remainingQuantity,
                            startsAt: dropData.startsAt,
                            endsAt: dropData.endsAt,
                          }
                        : null
                    }
                    loading={dropQuery.isPending}
                    error={dropQuery.isError}
                    onRetry={() => void dropQuery.refetch()}
                  />
                ) : null}
              </div>

              <section
                className="hype-room-panel hype-room-chat"
                aria-label="Room chat"
                aria-busy={messagesQuery.isPending || undefined}
              >
                <div className="hype-room-panel-header">
                  <h2>
                    <Flag size={15} aria-hidden="true" /> Conversation
                    {messagesQuery.data ? (
                      <span className="hype-room-panel-count">
                        {messages.length}
                      </span>
                    ) : null}
                  </h2>
                </div>

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
                    <EmptyRoom
                      isLive={room.status === "live"}
                      isHost={isHost}
                      isActiveMember={isActiveMember}
                      hostAction={
                        canEditSettings
                          ? { label: "Invite people", onClick: openInvite }
                          : undefined
                      }
                      memberAction={
                        showJoin
                          ? { label: "Join room", onClick: () => void handleJoin() }
                          : undefined
                      }
                    />
                  ) : (
                    <ul className="hype-room-message-list">
                      {topLevelMessages.map(row => (
                        <MessageCard
                          key={row.message.id}
                          row={row}
                          members={members}
                          hostId={room.hostId}
                          viewerId={userId}
                          isHostViewer={isHost}
                          isActiveMember={isActiveMember}
                          canReply={canSend}
                          isPinned={row.message.id === pinnedMessageId}
                          replyCount={replyCounts.get(row.message.id) ?? 0}
                          selected={selectedMessageId === row.message.id}
                          busy={actionBusy}
                          onSelect={() =>
                            setSelectedMessageId(id =>
                              id === row.message.id ? null : row.message.id
                            )
                          }
                          onReply={() => startReply(row)}
                          onReact={reaction =>
                            void handleReaction(row.message.id, reaction)
                          }
                          onPin={
                            isHost ? () => void handlePin(row.message.id) : undefined
                          }
                          onReport={
                            row.user.id != null && row.user.id !== userId
                              ? () => openMessageReport(row.message.id)
                              : undefined
                          }
                          onOpenThread={() => openThread(row)}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                {canSend ? (
                  <Composer
                    draft={draft}
                    sending={sending}
                    replyTarget={replyTarget}
                    mentionedIds={mentionedIds}
                    mentionPickerOpen={mentionPickerOpen}
                    members={members}
                    viewerId={userId}
                    hostId={room.hostId}
                    onDraftChange={setDraft}
                    onToggleMentionPicker={() =>
                      setMentionPickerOpen(open => !open)
                    }
                    onToggleMention={toggleMention}
                    onCancelReply={() => setReplyTarget(null)}
                    onSubmit={event => void handleSend(event)}
                  />
                ) : room.status === "live" && !isActiveMember ? (
                  <p className="hype-room-composer-hint">
                    Join the room to send messages.
                  </p>
                ) : null}
              </section>
            </div>

            {threadRoot ? (
              <ThreadSheet
                root={threadRoot}
                messages={messages}
                members={members}
                hostId={room.hostId}
                viewerId={userId}
                isHostViewer={isHost}
                isActiveMember={isActiveMember}
                canReply={canSend}
                replyTarget={replyTarget}
                draft={draft}
                sending={sending}
                busy={actionBusy}
                replyCounts={replyCounts}
                onDraftChange={setDraft}
                onSend={() => {
                  const event = {
                    preventDefault: () => {},
                  } as unknown as FormEvent;
                  void handleSend(event);
                }}
                onCancelReply={() => setReplyTarget(null)}
                onReact={(id, reaction) => void handleReaction(id, reaction)}
                onPin={isHost ? id => void handlePin(id) : undefined}
                onReport={id => openMessageReport(id)}
                onClose={() => {
                  setThreadRootId(null);
                  setReplyTarget(null);
                }}
              />
            ) : null}

            {settingsOpen ? (
              <SettingsModal
                initial={{
                  title: settingsTitle,
                  topic: settingsTopic,
                  description: settingsDescription,
                  visibility: settingsVisibility,
                }}
                saving={updateSettingsMut.isPending}
                onClose={() => setSettingsOpen(false)}
                onSubmit={handleSettingsSubmit}
              />
            ) : null}

            {inviteOpen ? (
              <InviteModal
                roomTitle={room.title}
                term={inviteTerm}
                onTermChange={setInviteTerm}
                search={inviteDebounced}
                searchLoading={inviteSearchQuery.isPending}
                searchError={inviteSearchQuery.isError}
                results={inviteSearchResults}
                invites={invites}
                members={members}
                inviting={createInviteMut.isPending}
                canInvite={canEditSettings}
                onClose={() => setInviteOpen(false)}
                onInvite={id => void handleCreateInvite(id)}
              />
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

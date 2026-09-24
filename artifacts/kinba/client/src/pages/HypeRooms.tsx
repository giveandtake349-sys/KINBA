import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Clock3,
  Eye,
  Lock,
  Mail,
  Plus,
  Radio,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { TRPCClientError } from "@trpc/client";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { Skeleton } from "@/components/ui/skeleton";
import "./hypeRooms.css";

/** Matches server `HypeRoomListFilter` (server/hypeRooms.ts) — lobby tabs only. */
type LobbyFilter = "live" | "upcoming" | "mine";

const FILTERS: ReadonlyArray<{ id: LobbyFilter; label: string }> = [
  { id: "live", label: "Live" },
  { id: "upcoming", label: "Upcoming" },
  { id: "mine", label: "Mine" },
];

const EMPTY_COPY: Record<LobbyFilter, { title: string; body: string }> = {
  live: {
    title: "No live rooms right now.",
    body: "When a Hype Room goes live, it will appear here.",
  },
  upcoming: {
    title: "No upcoming rooms.",
    body: "Scheduled rooms will show here before they start.",
  },
  mine: {
    title: "You have not hosted a room yet.",
    body: "Rooms you host will appear under Mine.",
  },
};

export function getTrpcCode(error: unknown): string | undefined {
  if (error instanceof TRPCClientError) {
    return error.data?.code;
  }
  return undefined;
}

export function formatRoomTime(value: Date | string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Client wall-clock tick for countdowns — no serverNow yet (Gate 3). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function StatusChip({ status }: { status: string }) {
  const label =
    status === "live"
      ? "Live"
      : status === "scheduled"
        ? "Scheduled"
        : status === "expired"
          ? "Ended"
          : status === "archived"
            ? "Archived"
            : status;
  return (
    <span
      className={`hype-room-chip hype-room-chip--${status}`}
      aria-label={`Status: ${label}`}
    >
      <span className="hype-room-chip-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export type RoomCard = {
  id: number;
  title: string;
  topic: string | null;
  description: string | null;
  coverUrl: string | null;
  status: string;
  durationHours: number;
  startsAt: Date | string;
  endsAt: Date | string;
  visibility: "public" | "link_only";
  hostId: number;
};

function countdownFor(
  room: Pick<RoomCard, "status" | "startsAt" | "endsAt">,
  nowMs: number
): { label: string; remaining: string } | null {
  if (room.status === "scheduled") {
    const remainingMs = new Date(room.startsAt).getTime() - nowMs;
    if (remainingMs <= 0) return null;
    return { label: "Starts in", remaining: formatCountdown(remainingMs) };
  }
  if (room.status === "live") {
    const remainingMs = new Date(room.endsAt).getTime() - nowMs;
    if (remainingMs <= 0) return null;
    return { label: "Ends in", remaining: formatCountdown(remainingMs) };
  }
  return null;
}

function RoomCard({
  room,
  isHost,
  onOpen,
  nowMs,
}: {
  room: RoomCard;
  isHost: boolean;
  onOpen: () => void;
  nowMs: number;
}) {
  const countdown = countdownFor(room, nowMs);
  return (
    <article
      className="hype-room-card hype-room-card--interactive"
      aria-labelledby={`hype-room-${room.id}`}
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {room.coverUrl ? (
        <div className="hype-room-card-cover">
          <img src={room.coverUrl} alt="" loading="lazy" />
        </div>
      ) : (
        <div className="hype-room-card-cover hype-room-card-cover--placeholder" aria-hidden="true">
          <Radio size={28} strokeWidth={1.6} />
        </div>
      )}
      <div className="hype-room-card-body">
        <div className="hype-room-card-top">
          <StatusChip status={room.status} />
          {isHost ? <span className="hype-room-host-badge">Host</span> : null}
        </div>
        <h3 id={`hype-room-${room.id}`}>{room.title}</h3>
        {room.topic ? <p className="hype-room-topic">{room.topic}</p> : null}
        {room.description ? (
          <p className="hype-room-desc">{room.description}</p>
        ) : null}
        {countdown ? (
          <p className="hype-room-countdown" aria-live="polite">
            <Clock3 size={13} aria-hidden="true" />
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
              <Eye size={13} aria-hidden="true" />
              <span className="sr-only">Visibility</span>
            </dt>
            <dd>{room.visibility === "public" ? "Public" : "Link only"}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

function LobbyState({
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

export default function HypeRooms() {
  const [, navigate] = useLocation();
  const auth = useAuth();
  const [filter, setFilter] = useState<LobbyFilter>("live");
  const nowMs = useNow(1000);
  const utils = trpc.useUtils();

  const needsAuth = filter === "mine";
  const blockedByAuth =
    needsAuth && !auth.loading && !auth.isAuthenticated;

  const query = trpc.hypeRooms.list.useQuery(
    { filter },
    {
      enabled: !blockedByAuth,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  );

  const invitesQuery = trpc.hypeRooms.listMyInvites.useQuery(undefined, {
    enabled: auth.isAuthenticated && !auth.loading,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });
  const acceptInviteMut = trpc.hypeRooms.acceptInvite.useMutation();

  const myInvites = useMemo(
    () => ((invitesQuery.data ?? []) as InviteRow[] | undefined) ?? [],
    [invitesQuery.data]
  );

  const handleAcceptInvite = async (inviteId: number) => {
    if (!auth.isAuthenticated) {
      auth.openAuth();
      return;
    }
    try {
      const result = await acceptInviteMut.mutateAsync({ inviteId });
      await Promise.all([
        utils.hypeRooms.listMyInvites.invalidate(),
        utils.hypeRooms.byId.invalidate(),
        utils.hypeRooms.members.invalidate(),
        utils.hypeRooms.list.invalidate(),
      ]);
      toast.success("Invite accepted — you joined the room.");
      navigate(`/rooms/${result.invite.roomId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not accept invite."
      );
    }
  };

  const rooms = useMemo(
    () => ((query.data ?? []) as RoomCard[] | undefined) ?? [],
    [query.data]
  );
  const authReady = !needsAuth || !auth.loading;
  const isLoading = authReady && query.isPending && !blockedByAuth;
  const errorCode = query.isError ? getTrpcCode(query.error) : undefined;
  const unavailable =
    errorCode === "PRECONDITION_FAILED" ||
    (query.isError &&
      typeof query.error?.message === "string" &&
      query.error.message.includes("currently disabled"));
  const unauthorized =
    blockedByAuth || errorCode === "UNAUTHORIZED";

  const goHome = () => navigate("/");
  const openRoom = (roomId: number) => navigate(`/rooms/${roomId}`);

  const retry = () => {
    void query.refetch();
  };

  return (
    <div className="kinba-app hype-rooms-shell">
      <main className="hype-rooms-page section-shell">
        <button type="button" className="hype-rooms-back" onClick={goHome}>
          <ArrowLeft size={15} />
          Back to feed
        </button>

        <header className="hype-rooms-header">
          <div>
            <p className="eyebrow eyebrow--bright">
              <Radio size={14} aria-hidden="true" /> Time-limited community
            </p>
            <h1>Hype Rooms</h1>
            <p className="hype-rooms-lede">
              Live and scheduled rooms for real-time community energy.
            </p>
          </div>
          <button
            type="button"
            className="primary-btn hype-rooms-create-cta"
            onClick={() => navigate("/rooms/new")}
          >
            <Plus size={15} aria-hidden="true" />
            Create Hype Room
          </button>
        </header>

        <nav className="hype-room-filters" aria-label="Hype Room filters" role="tablist">
          {FILTERS.map(item => {
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "active" : ""}
                onClick={() => setFilter(item.id)}
              >
                {item.id === "mine" ? (
                  <Users size={14} aria-hidden="true" />
                ) : null}
                {item.label}
              </button>
            );
          })}
        </nav>

        {auth.isAuthenticated && myInvites.length > 0 ? (
          <section
            className="hype-room-invite-inbox"
            aria-label="Your room invites"
            aria-busy={invitesQuery.isPending || undefined}
          >
            <h2>
              <Mail size={15} aria-hidden="true" /> Invites
              <span className="hype-room-panel-count">{myInvites.length}</span>
            </h2>
            <ul className="hype-room-invite-list">
              {myInvites.map(invite => (
                <li key={invite.id}>
                  <span>
                    Room invite
                    <span className="hype-room-invite-room">
                      #{invite.roomId}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={acceptInviteMut.isPending}
                    onClick={() => void handleAcceptInvite(invite.id)}
                  >
                    <Check size={14} aria-hidden="true" />
                    {acceptInviteMut.isPending &&
                    acceptInviteMut.variables?.inviteId === invite.id
                      ? "Accepting…"
                      : "Accept"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          className="hype-room-results"
          aria-live="polite"
          aria-busy={isLoading || undefined}
        >
          {isLoading ? (
            <div className="hype-room-grid" aria-label="Loading Hype Rooms">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="hype-room-card hype-room-card--skeleton" key={index}>
                  <Skeleton className="hype-room-skeleton-cover" />
                  <div className="hype-room-card-body">
                    <Skeleton className="hype-room-skeleton-line w-1/3" />
                    <Skeleton className="hype-room-skeleton-line w-3/4" />
                    <Skeleton className="hype-room-skeleton-line w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : unauthorized ? (
            <LobbyState
              icon={<Lock size={22} />}
              title="Sign in to view your rooms."
              body="Mine shows Hype Rooms you host. Sign in to continue."
              action={
                auth.isAuthenticated ? null : (
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => auth.openAuth()}
                  >
                    Sign in
                  </button>
                )
              }
            />
          ) : unavailable ? (
            <LobbyState
              icon={<Radio size={22} />}
              title="Hype Rooms are unavailable right now."
              body="This feature is currently disabled on the server."
            />
          ) : query.isError ? (
            <LobbyState
              icon={<RefreshCw size={22} />}
              title="Could not load Hype Rooms."
              body="Something went wrong while fetching the lobby. Try again."
              action={
                <button type="button" className="muted-btn" onClick={retry}>
                  Retry
                </button>
              }
            />
          ) : rooms.length === 0 ? (
            <LobbyState
              icon={<Radio size={22} />}
              title={EMPTY_COPY[filter].title}
              body={EMPTY_COPY[filter].body}
              action={
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => navigate("/rooms/new")}
                >
                  <Plus size={15} aria-hidden="true" />
                  Create Hype Room
                </button>
              }
            />
          ) : (
            <div className="hype-room-grid">
              {rooms.map(room => (
                <RoomCard
                  key={room.id}
                  room={room}
                  nowMs={nowMs}
                  isHost={
                    Boolean(auth.user?.id) && room.hostId === auth.user?.id
                  }
                  onOpen={() => openRoom(room.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>
      {auth.authDialogOpen && !auth.isAuthenticated ? (
        <SupabaseAuthDialog
          open
          onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
        />
      ) : null}
    </div>
  );
}

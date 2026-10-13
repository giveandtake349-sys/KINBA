import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BookOpen,
  Gamepad2,
  MessageCircle,
  Music,
  Plus,
  Radio,
  ShoppingBag,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { getTrpcCode } from "./HypeRooms";
import {
  ROOM_DESCRIPTION_MAX,
  ROOM_TITLE_MAX,
  ROOM_TITLE_MIN,
  validateRoomDescription,
  validateRoomTitle,
} from "./hypeRoom/roomText";
import { formatMoney } from "./Drops";
import "./hypeRooms.css";

const DURATION_OPTIONS = [4, 6, 12, 24] as const;
type DurationHours = (typeof DURATION_OPTIONS)[number];
type VisibilityOption = "public" | "link_only";

type RoomType = "talk" | "selling" | "music" | "study" | "gaming";

const ROOM_TYPES: ReadonlyArray<{ id: RoomType; label: string; Icon: typeof MessageCircle }> = [
  { id: "talk", label: "Adda", Icon: MessageCircle },
  { id: "selling", label: "Selling", Icon: ShoppingBag },
  { id: "music", label: "Music", Icon: Music },
  { id: "study", label: "Study", Icon: BookOpen },
  { id: "gaming", label: "Gaming", Icon: Gamepad2 },
];

const TOPIC_SUGGESTIONS = ["Fashion", "Drops", "Tech", "Music", "Gaming"] as const;

type MyDropRow = {
  id: number;
  title: string;
  mediaUrl: string;
  currency: string;
  discountedPrice: string;
  remainingQuantity: number;
  status: string;
};

/** Mirrors server normalizeStartsAt bounds (server remains authoritative). */
const ROOM_MAX_LEAD_MS = 7 * 24 * 60 * 60 * 1000;
const START_PAST_TOLERANCE_MS = 5_000;

const pad2 = (value: number) => String(value).padStart(2, "0");

function toDatetimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function createErrorMessage(error: unknown): string {
  const code = getTrpcCode(error);
  const message = error instanceof Error ? error.message : "";
  if (
    code === "PRECONDITION_FAILED" ||
    message.includes("currently disabled")
  ) {
    return "Hype Rooms are currently disabled on the server.";
  }
  if (code === "FORBIDDEN") {
    return message || "Only verified company/creator accounts can create rooms.";
  }
  if (code === "UNAUTHORIZED") {
    return "Sign in to create a Hype Room.";
  }
  if (code === "BAD_REQUEST" && message) {
    return message;
  }
  if (message) return message;
  return "Room could not be created. Try again.";
}

type ClientErrors = {
  title?: string;
  topic?: string;
  description?: string;
  startsAt?: string;
};

export default function CreateHypeRoom() {
  const [, navigate] = useLocation();
  const auth = useAuth();
  const createRoom = trpc.hypeRooms.create.useMutation();

  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [description, setDescription] = useState("");
  const [durationHours, setDurationHours] = useState<DurationHours>(6);
  const [visibility, setVisibility] = useState<VisibilityOption>("public");
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [roomType, setRoomType] = useState<RoomType>("talk");
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [attachedDropId, setAttachedDropId] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ClientErrors>({});
  const [formError, setFormError] = useState("");

  const myDropsQuery = trpc.drops.list.useQuery(
    { filter: "mine" },
    {
      enabled: auth.isAuthenticated && roomType === "selling",
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    }
  );
  const myDrops = useMemo(
    () => (myDropsQuery.data?.drops ?? []) as MyDropRow[],
    [myDropsQuery.data]
  );

  const minStart = useMemo(() => toDatetimeLocalValue(new Date()), []);
  const maxStart = useMemo(
    () => toDatetimeLocalValue(new Date(Date.now() + ROOM_MAX_LEAD_MS)),
    []
  );

  useEffect(() => {
    if (!auth.loading && !auth.isAuthenticated) {
      auth.openAuth();
    }
  }, [auth]);

  const goBack = () => navigate("/rooms");

  const validate = (): ClientErrors => {
    const errors: ClientErrors = {};
    const titleError = validateRoomTitle(title);
    if (titleError) {
      errors.title = titleError;
    }
    const trimmedTopic = topic.trim();
    if (trimmedTopic.length > 120) {
      errors.topic = "Topic must be at most 120 characters.";
    }
    const descriptionError = validateRoomDescription(description);
    if (descriptionError) {
      errors.description = descriptionError;
    }
    if (startsAtLocal) {
      const parsed = new Date(startsAtLocal);
      if (Number.isNaN(parsed.getTime())) {
        errors.startsAt = "Start time is invalid.";
      } else {
        const now = Date.now();
        if (parsed.getTime() < now - START_PAST_TOLERANCE_MS) {
          errors.startsAt = "Start must be now or in the future.";
        } else if (parsed.getTime() > now + ROOM_MAX_LEAD_MS) {
          errors.startsAt = "Start cannot be more than 7 days ahead.";
        }
      }
    }
    return errors;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createRoom.isPending) return;
    setFormError("");
    if (!auth.loading && !auth.isAuthenticated) {
      auth.openAuth();
      return;
    }
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      const room = await createRoom.mutateAsync({
        title: title.trim(),
        topic: topic.trim() ? topic.trim() : null,
        description: description.trim() ? description.trim() : null,
        durationHours,
        visibility,
        ...(startsAtLocal
          ? { startsAt: new Date(startsAtLocal).toISOString() }
          : {}),
        ...(roomType === "selling" && attachedDropId != null
          ? { dropId: attachedDropId }
          : {}),
      });
      navigate(`/rooms/${room.id}`);
    } catch (error) {
      setFormError(createErrorMessage(error));
    }
  };

  if (auth.loading) {
    return (
      <div className="kinba-app hype-rooms-shell">
        <main className="hype-create-page section-shell">
          <p className="hype-create-status">Checking access…</p>
        </main>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <div className="kinba-app hype-rooms-shell">
        <main className="hype-create-page section-shell">
          <button type="button" className="hype-rooms-back" onClick={goBack}>
            <ArrowLeft size={16} />
            Back to rooms
          </button>
          <div className="hype-room-state" role="status">
            <span className="hype-room-state-icon" aria-hidden="true">
              <Radio size={24} />
            </span>
            <h3>Sign in to create a room.</h3>
            <p>Creating a Hype Room requires an authenticated account.</p>
            <div className="hype-room-state-action">
              <button
                type="button"
                className="primary-btn"
                onClick={() => auth.openAuth()}
              >
                Sign in
              </button>
            </div>
          </div>
        </main>
        {auth.authDialogOpen ? (
          <SupabaseAuthDialog
            open
            onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="kinba-app hype-rooms-shell">
      <main className="hype-create-page section-shell">
        <button type="button" className="hype-rooms-back" onClick={goBack}>
          <ArrowLeft size={16} />
          Back to rooms
        </button>

        <header className="hype-rooms-header">
          <div>
            <p className="eyebrow eyebrow--bright">
              <Radio size={14} aria-hidden="true" /> Hype Rooms
            </p>
            <h1>Create Hype Room</h1>
            <p className="hype-rooms-lede">
              Schedule a time-limited room. Duration and start rules are
              validated on the server.
            </p>
          </div>
        </header>

        <form className="hype-create-form" onSubmit={handleSubmit} noValidate>
          <fieldset className="hype-type-fieldset">
            <legend>What kind of room?</legend>
            <div className="hype-type-picker" role="radiogroup" aria-label="Room type">
              {ROOM_TYPES.map(({ id, label, Icon }) => {
                const active = roomType === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`hype-type-card${active ? " active" : ""}`}
                    onClick={() => {
                      setRoomType(id);
                      if (id !== "selling") setAttachedDropId(null);
                    }}
                  >
                    <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {roomType === "selling" ? (
            <div className="hype-attach-section">
              <p className="hype-attach-label">
                Attach products <span className="hype-create-optional">(optional)</span>
              </p>
              {myDropsQuery.isPending ? (
                <p className="hype-attach-status">Loading your drops…</p>
              ) : myDropsQuery.isError ? (
                <p className="hype-attach-status">
                  Could not load your drops.{" "}
                  <button
                    type="button"
                    className="hype-attach-retry"
                    onClick={() => void myDropsQuery.refetch()}
                  >
                    Retry
                  </button>
                </p>
              ) : myDrops.length === 0 ? (
                <p className="hype-attach-status">
                  You have no drops yet. Create one first, then attach it here.
                </p>
              ) : (
                <ul className="hype-attach-list">
                  {myDrops.map(drop => {
                    const selected = attachedDropId === drop.id;
                    return (
                      <li key={drop.id}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          className={`hype-attach-row${selected ? " selected" : ""}`}
                          onClick={() =>
                            setAttachedDropId(selected ? null : drop.id)
                          }
                        >
                          {drop.mediaUrl ? (
                            <img src={drop.mediaUrl} alt="" loading="lazy" />
                          ) : (
                            <span className="hype-attach-thumb" aria-hidden="true">
                              <ShoppingBag size={18} strokeWidth={1.8} />
                            </span>
                          )}
                          <span className="hype-attach-info">
                            <span className="hype-attach-title">{drop.title}</span>
                            <span className="hype-attach-meta">
                              {formatMoney(drop.discountedPrice, drop.currency)} ·{" "}
                              {Math.max(0, drop.remainingQuantity)} left
                            </span>
                          </span>
                          <span
                            className="hype-attach-check"
                            aria-hidden="true"
                          >
                            {selected ? "✓" : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button
                type="button"
                className="hype-attach-new"
                onClick={() => navigate("/drops")}
              >
                <Plus size={16} aria-hidden="true" /> Create new drop
              </button>
            </div>
          ) : null}

          <label htmlFor="hype-create-title">
            Title
            <input
              id="hype-create-title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              minLength={3}
              required
              autoComplete="off"
              placeholder={`Room title (${ROOM_TITLE_MIN}–${ROOM_TITLE_MAX} characters)`}
              aria-invalid={fieldErrors.title ? true : undefined}
            />
            {fieldErrors.title ? (
              <span className="hype-create-field-error" role="alert">
                {fieldErrors.title}
              </span>
            ) : null}
          </label>

          <div className="hype-field-group">
            <label htmlFor="hype-create-topic">
              Topic <span className="hype-create-optional">(optional)</span>
              <input
                id="hype-create-topic"
                value={topic}
                onChange={event => setTopic(event.target.value)}
                maxLength={120}
                autoComplete="off"
                placeholder="Topic tag (max 120 characters)"
                aria-invalid={fieldErrors.topic ? true : undefined}
              />
              {fieldErrors.topic ? (
                <span className="hype-create-field-error" role="alert">
                  {fieldErrors.topic}
                </span>
              ) : null}
            </label>
            <div className="hype-topic-chips" aria-label="Suggested topics">
              {TOPIC_SUGGESTIONS.map(suggestion => {
                const active = topic === suggestion;
                return (
                  <button
                    key={suggestion}
                    type="button"
                    aria-pressed={active}
                    className={active ? "active" : ""}
                    onClick={() =>
                      setTopic(active ? "" : suggestion)
                    }
                  >
                    {suggestion}
                  </button>
                );
              })}
            </div>
          </div>

          <label htmlFor="hype-create-description">
            Description <span className="hype-create-optional">(optional)</span>
            <textarea
              id="hype-create-description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              rows={4}
              placeholder={`What is this room about? (max ${ROOM_DESCRIPTION_MAX} characters)`}
              aria-invalid={fieldErrors.description ? true : undefined}
            />
            {fieldErrors.description ? (
              <span className="hype-create-field-error" role="alert">
                {fieldErrors.description}
              </span>
            ) : null}
          </label>

          <div className="hype-field-group">
            <span className="hype-field-label" id="hype-duration-label">
              Duration
            </span>
            <div
              className="hype-duration-pills"
              role="radiogroup"
              aria-labelledby="hype-duration-label"
            >
              {DURATION_OPTIONS.map(hours => {
                const active = durationHours === hours;
                return (
                  <button
                    key={hours}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? "active" : ""}
                    onClick={() => setDurationHours(hours)}
                  >
                    {hours}h
                  </button>
                );
              })}
            </div>
          </div>

          <div className="hype-field-group">
            <label htmlFor="hype-create-visibility">
              Visibility
              <select
                id="hype-create-visibility"
                value={visibility}
                onChange={event =>
                  setVisibility(event.target.value as VisibilityOption)
                }
              >
                <option value="public">Public</option>
                <option value="link_only">Link only</option>
              </select>
            </label>
          </div>

          <div className="hype-field-group">
            <span className="hype-field-label" id="hype-when-label">
              When
            </span>
            <div
              className="hype-seg-toggle"
              role="radiogroup"
              aria-labelledby="hype-when-label"
            >
              <button
                type="button"
                role="radio"
                aria-checked={scheduleMode === "now"}
                className={scheduleMode === "now" ? "active" : ""}
                onClick={() => {
                  setScheduleMode("now");
                  setStartsAtLocal("");
                }}
              >
                Now
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={scheduleMode === "later"}
                className={scheduleMode === "later" ? "active" : ""}
                onClick={() => setScheduleMode("later")}
              >
                Schedule
              </button>
            </div>
            {scheduleMode === "later" ? (
              <label htmlFor="hype-create-starts" className="hype-starts-label">
                Start time
                <input
                  id="hype-create-starts"
                  type="datetime-local"
                  value={startsAtLocal}
                  onChange={event => setStartsAtLocal(event.target.value)}
                  min={minStart}
                  max={maxStart}
                  aria-invalid={fieldErrors.startsAt ? true : undefined}
                />
                {fieldErrors.startsAt ? (
                  <span className="hype-create-field-error" role="alert">
                    {fieldErrors.startsAt}
                  </span>
                ) : null}
                <span className="hype-create-hint">
                  Choose a time within the next 7 days.
                </span>
              </label>
            ) : null}
          </div>

          {formError ? (
            <p className="form-message form-message--error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="hype-create-actions">
            <button
              type="submit"
              className="primary-btn"
              disabled={createRoom.isPending}
            >
              {createRoom.isPending ? "Creating…" : "Create room"}
            </button>
            <button type="button" className="muted-btn" onClick={goBack}>
              Cancel
            </button>
          </div>
        </form>
      </main>
      {auth.authDialogOpen ? (
        <SupabaseAuthDialog
          open
          onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
        />
      ) : null}
    </div>
  );
}

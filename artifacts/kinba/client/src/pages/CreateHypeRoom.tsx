import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Radio } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { getTrpcCode } from "./HypeRooms";
import "./hypeRooms.css";

const DURATION_OPTIONS = [4, 6, 12, 24] as const;
type DurationHours = (typeof DURATION_OPTIONS)[number];
type VisibilityOption = "public" | "link_only";

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
  const [fieldErrors, setFieldErrors] = useState<ClientErrors>({});
  const [formError, setFormError] = useState("");

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
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3 || trimmedTitle.length > 180) {
      errors.title = "Title must be 3–180 characters.";
    }
    const trimmedTopic = topic.trim();
    if (trimmedTopic.length > 120) {
      errors.topic = "Topic must be at most 120 characters.";
    }
    const trimmedDescription = description.trim();
    if (trimmedDescription.length > 2000) {
      errors.description = "Description must be at most 2000 characters.";
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
            <ArrowLeft size={15} />
            Back to rooms
          </button>
          <div className="hype-room-state" role="status">
            <span className="hype-room-state-icon" aria-hidden="true">
              <Radio size={22} />
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
          <ArrowLeft size={15} />
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
          <label htmlFor="hype-create-title">
            Title
            <input
              id="hype-create-title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              minLength={3}
              maxLength={180}
              required
              autoComplete="off"
              placeholder="Room title (3–180 characters)"
              aria-invalid={fieldErrors.title ? true : undefined}
            />
            {fieldErrors.title ? (
              <span className="hype-create-field-error" role="alert">
                {fieldErrors.title}
              </span>
            ) : null}
          </label>

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

          <label htmlFor="hype-create-description">
            Description <span className="hype-create-optional">(optional)</span>
            <textarea
              id="hype-create-description"
              value={description}
              onChange={event => setDescription(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="What is this room about? (max 2000 characters)"
              aria-invalid={fieldErrors.description ? true : undefined}
            />
            {fieldErrors.description ? (
              <span className="hype-create-field-error" role="alert">
                {fieldErrors.description}
              </span>
            ) : null}
          </label>

          <div className="hype-create-form-row">
            <label htmlFor="hype-create-duration">
              Duration
              <select
                id="hype-create-duration"
                value={durationHours}
                onChange={event =>
                  setDurationHours(
                    Number(event.target.value) as DurationHours
                  )
                }
              >
                {DURATION_OPTIONS.map(hours => (
                  <option key={hours} value={hours}>
                    {hours} hours
                  </option>
                ))}
              </select>
            </label>

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

          <label htmlFor="hype-create-starts">
            Starts at <span className="hype-create-optional">(optional)</span>
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
              Leave blank to start now. Otherwise choose a time within the next
              7 days.
            </span>
          </label>

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

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import "./profile.css";
import { toast } from "sonner";
import GuestLanding from "@/pages/GuestLanding";
import { LanguageSelector, useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { SupabaseAuthDialog } from "@/components/SupabaseAuthDialog";
import { trpc } from "@/lib/trpc";
import {
  getMediaDuration,
  uploadImage,
  uploadMedia,
  validateImageFile,
  validateMediaFile,
  type SignalMediaType,
} from "@/lib/mediaUpload";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Flag,
  Home as HomeIcon,
  Heart,
  Link2,
  ImagePlus,
  Loader2,
  LogOut,
  Menu,
  MessageCircle,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Square,
  UserRound,
  UsersRound,
  Video,
  Volume2,
  VolumeX,
  Waves,
  X,
  Zap,
} from "lucide-react";

type Screen =
  | "landing"
  | "dashboard"
  | "discover"
  | "connections"
  | "profile"
  | "chat"
  | "member";
type SignalMode = "need" | "can";
type TrustAction = { kind: "block" | "report"; userId: number; name: string };
type PendingMessage = {
  clientMessageId: string;
  connectionId: number;
  body: string;
  imageUrl: string | null;
  createdAt: Date;
  senderId: number;
};
type SelectedImage = { file: File; previewUrl: string };
type SelectedMedia = {
  file: File;
  previewUrl: string;
  mediaType: SignalMediaType;
  duration: number;
};

const logoSrc = "/logo.png";
const heroImage = "/manus-storage/nivo-hero-field_7ca54bc2.png";
const categories = [
  "All",
  "Business",
  "Technology",
  "Design",
  "Education",
  "Jobs",
  "Services",
  "Advice",
  "Collaboration",
  "Personal",
  "Other",
];
const blankProfile = {
  country: "",
  languages: "",
  about: "",
  skills: "",
  interests: "",
  photoUrl: "",
};
const profileTabs = [
  { id: "videos", label: "Videos" },
  { id: "trendy", label: "Trendy" },
  { id: "following", label: "Following" },
  { id: "icons", label: "ICONS" },
] as const;
const blankSignal = {
  title: "",
  description: "",
  category: "Technology",
  language: "English",
  location: "",
};

function OfficialLogo({ small = false }: { small?: boolean }) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <div className={`official-logo ${small ? "official-logo--small" : ""}`}>
      {logoFailed ? (
        <span className="logo-fallback">KINBA</span>
      ) : (
        <img
          src={logoSrc}
          alt="Kinba official logo"
          onError={() => setLogoFailed(true)}
        />
      )}
    </div>
  );
}

function Avatar({
  name,
  photoUrl,
  large = false,
}: {
  name: string | null | undefined;
  photoUrl?: string | null;
  large?: boolean;
}) {
  const initials = (name ?? "N")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join("")
    .toUpperCase();
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);
  const showPhoto = Boolean(photoUrl && failedPhotoUrl !== photoUrl);
  return (
    <div className={`avatar ${large ? "avatar--large" : ""}`}>
      {showPhoto ? (
        <img
          src={photoUrl ?? undefined}
          alt=""
          onError={() => setFailedPhotoUrl(photoUrl ?? null)}
        />
      ) : (
        initials || "N"
      )}
    </div>
  );
}

function InputLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-label">
      <span>{label}</span>
      {children}
    </label>
  );
}

function CommentPanel({
  postId,
  postOwnerId,
  currentUserId,
}: {
  postId: number;
  postOwnerId: number;
  currentUserId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [image, setImage] = useState<SelectedImage | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const commentsQuery = trpc.comments.list.useQuery(
    { postId },
    { enabled: open, refetchOnWindowFocus: false }
  );
  const createComment = trpc.comments.create.useMutation({
    onSuccess: async () => {
      await commentsQuery.refetch();
      setBody("");
      clearImage();
      toast.success("Comment added.");
    },
    onError: error => toast.error(error.message),
  });
  const deleteComment = trpc.comments.delete.useMutation({
    onSuccess: async () => {
      await commentsQuery.refetch();
      toast.success("Comment deleted.");
    },
    onError: error => toast.error(error.message),
  });
  const comments = commentsQuery.data ?? [];
  function clearImage() {
    setImage(current => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    if (imageInputRef.current) imageInputRef.current.value = "";
  }
  function selectImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      validateImageFile(file);
      clearImage();
      setImage({ file, previewUrl: URL.createObjectURL(file) });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to select this image."
      );
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = body.trim();
    if (!content && !image) return;
    try {
      const imageUrl = image ? await uploadImage("comment", image.file) : null;
      await createComment.mutateAsync({
        postId,
        content: content || null,
        imageUrl,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to add comment."
      );
    }
  }
  return (
    <section className="comment-panel">
      <button
        type="button"
        className="comment-toggle"
        onClick={() => setOpen(current => !current)}
      >
        <MessageCircle size={15} />{" "}
        {open
          ? "Hide comments"
          : `${commentsQuery.data?.length ?? 0} comment${(commentsQuery.data?.length ?? 0) === 1 ? "" : "s"}`}
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="comment-content">
          {commentsQuery.isLoading ? (
            <p className="comment-state">Loading comments…</p>
          ) : comments.length ? (
            <div className="comment-list">
              {comments.map(comment => (
                <article className="comment-item" key={comment.id}>
                  <Avatar
                    name={comment.user.name}
                    photoUrl={comment.user.avatar}
                  />
                  <div className="comment-body">
                    <div className="comment-meta">
                      <strong>{comment.user.name ?? "KINBA member"}</strong>
                      <time
                        dateTime={new Date(comment.createdAt).toISOString()}
                      >
                        {new Date(comment.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </time>
                      {currentUserId &&
                        (currentUserId === comment.userId ||
                          currentUserId === postOwnerId) && (
                          <button
                            type="button"
                            className="comment-delete"
                            onClick={() =>
                              deleteComment.mutate({ id: comment.id })
                            }
                            disabled={deleteComment.isPending}
                          >
                            Delete
                          </button>
                        )}
                    </div>
                    {comment.content && <p>{comment.content}</p>}
                    {comment.imageUrl && (
                      <a
                        className="comment-image-link"
                        href={comment.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={comment.imageUrl}
                          alt="Comment attachment"
                          loading="lazy"
                        />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="comment-state">
              No comments yet. Start the conversation.
            </p>
          )}
          <form className="comment-form" onSubmit={submit}>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              onChange={selectImage}
            />
            <div className="comment-entry">
              <textarea
                value={body}
                onChange={event => setBody(event.target.value)}
                placeholder="Add a thoughtful comment…"
                rows={2}
                maxLength={2000}
              />
              <button
                type="button"
                className="comment-attach"
                onClick={() => imageInputRef.current?.click()}
                aria-label="Attach an image"
                title="Attach an image"
              >
                <ImagePlus size={17} />
              </button>
              <button
                className="primary-btn comment-submit"
                type="submit"
                disabled={createComment.isPending || (!body.trim() && !image)}
              >
                {createComment.isPending ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
            {image && (
              <div className="comment-preview">
                <img src={image.previewUrl} alt="Selected comment preview" />
                <span>{image.file.name}</span>
                <button
                  type="button"
                  onClick={clearImage}
                  aria-label="Remove comment image"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <small>JPG, PNG, WEBP, or GIF · Max 5MB</small>
          </form>
        </div>
      )}
    </section>
  );
}

function SignalMediaPicker({
  media,
  onChange,
}: {
  media: SelectedMedia | null;
  onChange: (media: SelectedMedia | null) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const clearMedia = () => {
    if (media) URL.revokeObjectURL(media.previewUrl);
    onChange(null);
  };
  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setIsRecording(false);
  };
  const startRecording = async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      toast.error("Voice recording is not supported in this browser.");
      return;
    }
    try {
      clearMedia();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType =
        ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find(type =>
          MediaRecorder.isTypeSupported(type)
        ) ?? "";
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setIsRecording(true);
      recorder.ondataavailable = event => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        const file = new File(
          [
            new Blob(chunksRef.current, {
              type: recorder.mimeType || "audio/webm",
            }),
          ],
          `voice-signal-${Date.now()}.webm`,
          { type: recorder.mimeType || "audio/webm" }
        );
        try {
          const duration = await getMediaDuration(file);
          onChange({
            file,
            previewUrl: URL.createObjectURL(file),
            mediaType: "AUDIO",
            duration,
          });
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Unable to prepare the recording."
          );
        }
      };
      recorder.start();
      const timer = window.setInterval(() => {
        const elapsed = Math.floor(
          (Date.now() - recordingStartedAtRef.current) / 1000
        );
        setRecordingSeconds(Math.min(elapsed, 15));
        if (elapsed >= 15) {
          window.clearInterval(timer);
          stopRecording();
        }
      }, 250);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Microphone access was not granted."
      );
      setIsRecording(false);
    }
  };
  const selectVideo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (validateMediaFile(file) !== "VIDEO")
        throw new Error("Choose a video file for a 15-second video signal.");
      clearMedia();
      const duration = await getMediaDuration(file);
      onChange({
        file,
        previewUrl: URL.createObjectURL(file),
        mediaType: "VIDEO",
        duration,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to prepare this video."
      );
    }
  };
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      if (recorderRef.current?.state === "recording")
        recorderRef.current.stop();
      if (media) URL.revokeObjectURL(media.previewUrl);
    },
    []
  );
  return (
    <div className="signal-media-picker">
      <div className="signal-media-actions">
        <button
          type="button"
          className="media-action-button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={Boolean(media?.mediaType === "VIDEO")}
        >
          {isRecording ? (
            <>
              <Square size={16} /> Stop recording · {15 - recordingSeconds}s
            </>
          ) : (
            <>
              <Mic size={16} /> Record voice signal
            </>
          )}
        </button>
        <button
          type="button"
          className="media-action-button"
          onClick={() => videoInputRef.current?.click()}
          disabled={isRecording || Boolean(media?.mediaType === "AUDIO")}
        >
          <Video size={16} /> Add 15s video
        </button>
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/ogg"
          className="sr-only"
          onChange={selectVideo}
        />
      </div>
      {isRecording && (
        <div className="recording-status">
          <span className="recording-dot" /> Recording voice{" "}
          <strong>{15 - recordingSeconds}s</strong>
          <div className="recording-waveform">
            {Array.from({ length: 18 }).map((_, index) => (
              <i key={index} style={{ animationDelay: `${index * 35}ms` }} />
            ))}
          </div>
        </div>
      )}
      {media && (
        <div className="signal-media-review">
          {media.mediaType === "AUDIO" ? (
            <div className="voice-review">
              <Waves size={20} />
              <div>
                <strong>Voice signal ready</strong>
                <span>{media.duration}s · Tap publish to share</span>
              </div>
            </div>
          ) : (
            <video src={media.previewUrl} controls muted playsInline />
          )}
          <button type="button" className="media-rerecord" onClick={clearMedia}>
            {media.mediaType === "AUDIO" ? "Rerecord" : "Choose another video"}
          </button>
        </div>
      )}
      <small>
        Audio/video only · Maximum 15 seconds · Video files up to 25MB
      </small>
    </div>
  );
}

function SignalMediaPlayer({
  url,
  mediaType,
  duration,
}: {
  url: string;
  mediaType: "AUDIO" | "VIDEO";
  duration: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const togglePlay = async () => {
    const element = mediaType === "VIDEO" ? videoRef.current : audioRef.current;
    if (!element) return;
    if (element.paused) {
      await element.play();
      setIsPlaying(true);
    } else {
      element.pause();
      setIsPlaying(false);
    }
  };
  const toggleMute = () => {
    const element = videoRef.current;
    if (!element) return;
    element.muted = !element.muted;
    setMuted(element.muted);
  };
  useEffect(() => {
    if (mediaType !== "VIDEO" || !videoRef.current) return;
    const element = videoRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          element
            .play()
            .then(() => setIsPlaying(true))
            .catch(() => undefined);
        } else {
          element.pause();
          setIsPlaying(false);
        }
      },
      { threshold: 0.65 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [mediaType, url]);
  if (mediaType === "VIDEO")
    return (
      <div className="signal-video-player">
        <video
          ref={videoRef}
          src={url}
          loop
          muted={muted}
          playsInline
          preload="metadata"
          onClick={toggleMute}
          onEnded={() => setIsPlaying(false)}
        />
        <div className="video-player-overlay">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause video" : "Play video"}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute video" : "Mute video"}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <span>{duration}s</span>
        </div>
      </div>
    );
  return (
    <div className="signal-audio-player">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onEnded={() => setIsPlaying(false)}
      />
      <button
        type="button"
        className="audio-play-button"
        onClick={togglePlay}
        aria-label={isPlaying ? "Pause audio" : "Play audio"}
      >
        {isPlaying ? <Pause size={17} /> : <Play size={17} />}
      </button>
      <div
        className={isPlaying ? "audio-waveform is-playing" : "audio-waveform"}
      >
        {Array.from({ length: 22 }).map((_, index) => (
          <i key={index} className="wave-bar" />
        ))}
      </div>
      <span className="audio-duration">{Math.min(duration, 15)}s</span>
    </div>
  );
}

function parseList(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const auth = useAuth();
  const { t } = useLanguage();
  const utils = trpc.useUtils();
  const [location, navigate] = useLocation();
  const routeChatId = Number(location.match(/^\/chat\/(\d+)$/)?.[1]) || null;
  const routeMemberId =
    Number(location.match(/^\/members\/(\d+)$/)?.[1]) || null;
  const screen: Screen =
    location === "/discover"
      ? "discover"
      : location === "/connections"
        ? "connections"
        : location === "/profile"
          ? "profile"
          : routeChatId
            ? "chat"
            : routeMemberId
              ? "member"
              : auth.isAuthenticated
                ? "dashboard"
                : "landing";

  const [menuOpen, setMenuOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | SignalMode>("all");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [composerMode, setComposerMode] = useState<SignalMode | null>(null);
  const [signalForm, setSignalForm] = useState(blankSignal);
  const [signalImage, setSignalImage] = useState<SelectedImage | null>(null);
  const [signalMedia, setSignalMedia] = useState<SelectedMedia | null>(null);
  const [isUploadingSignalImage, setIsUploadingSignalImage] = useState(false);
  const signalImageInputRef = useRef<HTMLInputElement>(null);
  const [requestSignalId, setRequestSignalId] = useState<number | null>(null);
  const [requestNote, setRequestNote] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [messageImage, setMessageImage] = useState<SelectedImage | null>(null);
  const [isUploadingMessageImage, setIsUploadingMessageImage] = useState(false);
  const messageImageInputRef = useRef<HTMLInputElement>(null);
  const [profileForm, setProfileForm] = useState(blankProfile);
  const [profileTab, setProfileTab] = useState<
    "videos" | "trendy" | "following" | "icons"
  >("icons");
  const [avatarImage, setAvatarImage] = useState<SelectedImage | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarImageInputRef = useRef<HTMLInputElement>(null);
  const [trustAction, setTrustAction] = useState<TrustAction | null>(null);
  const [reportReason, setReportReason] = useState<
    "spam" | "harassment" | "unsafe" | "misleading" | "other"
  >("other");
  const [reportDetails, setReportDetails] = useState("");
  const [pendingRecipientIds, setPendingRecipientIds] = useState<number[]>([]);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);

  const filters = useMemo(
    () => ({
      type: typeFilter === "all" ? undefined : typeFilter,
      category: categoryFilter === "All" ? undefined : categoryFilter,
      search: searchTerm.trim() || undefined,
    }),
    [typeFilter, categoryFilter, searchTerm]
  );
  const matchFilters = useMemo(
    () => ({ search: matchSearch.trim() || undefined }),
    [matchSearch]
  );
  const signalsQuery = trpc.signals.list.useQuery(filters, {
    refetchOnWindowFocus: false,
  });
  const profileQuery = trpc.profile.me.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const profileContentQuery = trpc.profile.content.useQuery(
    { tab: profileTab },
    { enabled: auth.isAuthenticated, refetchOnWindowFocus: false }
  );
  const ownSignalsQuery = trpc.signals.mine.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const connectionsQuery = trpc.connections.list.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const matchesQuery = trpc.matches.list.useQuery(matchFilters, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const messagesQuery = trpc.messages.list.useQuery(
    { id: routeChatId ?? 0 },
    {
      enabled: auth.isAuthenticated && Boolean(routeChatId),
      refetchOnWindowFocus: false,
    }
  );
  const memberQuery = trpc.profile.get.useQuery(
    { userId: routeMemberId ?? 0 },
    { enabled: Boolean(routeMemberId), refetchOnWindowFocus: false }
  );

  const signals = signalsQuery.data ?? [];
  const connections = connectionsQuery.data ?? [];
  const matches = matchesQuery.data ?? [];
  const selectedSignal =
    signals.find(signal => signal.id === requestSignalId) ??
    matches.find(signal => signal.id === requestSignalId) ??
    null;
  const selectedConnection =
    connections.find(connection => connection.id === routeChatId) ?? null;
  const messageThread = [
    ...(messagesQuery.data ?? []),
    ...pendingMessages.filter(message => message.connectionId === routeChatId),
  ].sort(
    (first, second) =>
      new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
  );
  const headerPhoto = profileQuery.data?.profile?.photoUrl ?? null;

  useEffect(() => {
    const privateScreen =
      screen === "dashboard" ||
      screen === "connections" ||
      screen === "profile" ||
      screen === "chat";
    if (privateScreen && !auth.loading && !auth.isAuthenticated)
      auth.openAuth();
  }, [auth.isAuthenticated, auth.loading, screen]);

  useEffect(() => {
    const profile = profileQuery.data?.profile;
    if (!profile) return;
    setProfileForm({
      country: profile.country ?? "",
      languages: parseList(profile.languages).join(", "),
      about: profile.about ?? "",
      skills: parseList(profile.skills).join(", "),
      interests: parseList(profile.interests).join(", "),
      photoUrl: profile.photoUrl ?? "",
    });
  }, [profileQuery.data]);

  const notifyError = (error: unknown) =>
    toast.error(
      error instanceof Error
        ? error.message
        : "The operation could not be completed. Please try again."
    );
  const clearSignalImage = () => {
    setSignalImage(current => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    if (signalImageInputRef.current) signalImageInputRef.current.value = "";
  };
  const clearSignalMedia = () => {
    setSignalMedia(current => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  };
  const selectSignalImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      validateImageFile(file);
      clearSignalImage();
      setSignalImage({ file, previewUrl: URL.createObjectURL(file) });
    } catch (error) {
      notifyError(error);
    }
  };
  const clearAvatarImage = () => {
    setAvatarImage(current => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    if (avatarImageInputRef.current) avatarImageInputRef.current.value = "";
  };
  const selectAvatarImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      validateImageFile(file);
      clearAvatarImage();
      setAvatarImage({ file, previewUrl: URL.createObjectURL(file) });
    } catch (error) {
      notifyError(error);
    }
  };
  const clearMessageImage = () => {
    setMessageImage(current => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    if (messageImageInputRef.current) messageImageInputRef.current.value = "";
  };
  const selectMessageImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      validateImageFile(file);
      clearMessageImage();
      setMessageImage({ file, previewUrl: URL.createObjectURL(file) });
    } catch (error) {
      notifyError(error);
    }
  };
  const refreshNetwork = async () =>
    Promise.all([
      utils.signals.list.invalidate(),
      utils.signals.mine.invalidate(),
      utils.matches.list.invalidate(),
      utils.connections.list.invalidate(),
    ]);
  const createSignal = trpc.signals.create.useMutation({
    onSuccess: async () => {
      await refreshNetwork();
      clearSignalImage();
      clearSignalMedia();
      setComposerMode(null);
      setSignalForm(blankSignal);
      navigate("/");
      toast.success("Your signal is published.");
    },
    onError: notifyError,
  });
  const saveProfile = trpc.profile.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.profile.me.invalidate(),
        utils.profile.get.invalidate(),
      ]);
      toast.success("Profile saved.");
    },
    onError: notifyError,
  });
  const requestConnection = trpc.connections.request.useMutation({
    onMutate: ({ recipientId }) =>
      setPendingRecipientIds(current =>
        current.includes(recipientId) ? current : [...current, recipientId]
      ),
    onSuccess: async (_result, input) => {
      await refreshNetwork();
      setRequestSignalId(null);
      setRequestNote("");
      toast.success("Connection request sent.");
    },
    onError: (error, input) => {
      setPendingRecipientIds(current =>
        current.filter(id => id !== input.recipientId)
      );
      notifyError(error);
    },
  });
  const acceptConnection = trpc.connections.accept.useMutation({
    onSuccess: async () => {
      await utils.connections.list.invalidate();
      toast.success("Connection accepted. Messaging is now available.");
    },
    onError: notifyError,
  });
  const declineConnection = trpc.connections.decline.useMutation({
    onSuccess: async () => {
      await utils.connections.list.invalidate();
      toast.success("Connection declined.");
    },
    onError: notifyError,
  });
  const cancelConnection = trpc.connections.cancel.useMutation({
    onSuccess: async () => {
      await utils.connections.list.invalidate();
      toast.success("Connection request cancelled.");
    },
    onError: notifyError,
  });
  const sendMessage = trpc.messages.send.useMutation({
    onSuccess: async (_result, input) => {
      await Promise.all([
        utils.messages.list.invalidate({ id: input.connectionId }),
        utils.connections.list.invalidate(),
      ]);
      setPendingMessages(current =>
        current.filter(
          message => message.clientMessageId !== input.clientMessageId
        )
      );
    },
    onError: (error, input) => {
      setPendingMessages(current =>
        current.filter(
          message => message.clientMessageId !== input.clientMessageId
        )
      );
      notifyError(error);
    },
  });
  const blockUser = trpc.trust.block.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.signals.list.invalidate(),
        utils.matches.list.invalidate(),
        utils.connections.list.invalidate(),
        utils.profile.get.invalidate(),
      ]);
      setTrustAction(null);
      setRequestSignalId(null);
      navigate("/discover");
      toast.success(
        "Member blocked. Their signals and connections are now hidden."
      );
    },
    onError: notifyError,
  });
  const reportUser = trpc.trust.report.useMutation({
    onSuccess: () => {
      setTrustAction(null);
      setReportDetails("");
      toast.success("Report submitted for review.");
    },
    onError: notifyError,
  });

  const requireAuth = (next: () => void) =>
    auth.isAuthenticated ? next() : auth.openAuth();
  const go = (next: Screen, id?: number) => {
    const requiresAuthentication =
      next === "dashboard" ||
      next === "connections" ||
      next === "profile" ||
      next === "chat";
    if (requiresAuthentication && !auth.isAuthenticated) {
      auth.openAuth();
      return;
    }
    const route =
      next === "discover"
        ? "/discover"
        : next === "connections"
          ? "/connections"
          : next === "profile"
            ? "/profile"
            : next === "chat" && id
              ? `/chat/${id}`
              : next === "member" && id
                ? `/members/${id}`
                : "/";
    navigate(route);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const startComposer = (mode: SignalMode) =>
    requireAuth(() => {
      clearSignalImage();
      clearSignalMedia();
      setComposerMode(mode);
      setSignalForm(blankSignal);
    });
  const connectionFor = (userId: number) =>
    connections.find(connection => connection.counterpart?.id === userId);
  const openConnection = (signal: {
    id: number;
    title: string;
    owner: { id: number };
  }) =>
    requireAuth(() => {
      if (signal.owner.id === auth.user?.id)
        return toast.error("You cannot connect to your own signal.");
      if (
        connectionFor(signal.owner.id) ||
        pendingRecipientIds.includes(signal.owner.id)
      )
        return;
      setRequestSignalId(signal.id);
      setRequestNote(`I believe I can help with “${signal.title}”.`);
    });
  const openTrustAction = (
    kind: "block" | "report",
    userId: number,
    name: string | null | undefined
  ) =>
    requireAuth(() => {
      setReportReason("other");
      setReportDetails("");
      setTrustAction({ kind, userId, name: name ?? "this member" });
    });
  const submitSignal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!composerMode) return;
    setIsUploadingSignalImage(true);
    try {
      const imageUrl = signalImage
        ? await uploadImage("post", signalImage.file)
        : null;
      const mediaUrl = signalMedia
        ? await uploadMedia(signalMedia.file, signalMedia.mediaType)
        : null;
      await createSignal.mutateAsync({
        ...signalForm,
        type: composerMode,
        location: signalForm.location.trim() || null,
        imageUrl,
        mediaUrl,
        mediaType: signalMedia?.mediaType ?? "NONE",
        mediaDuration: signalMedia?.duration ?? 0,
      });
    } catch (error) {
      notifyError(error);
    } finally {
      setIsUploadingSignalImage(false);
    }
  };
  const submitConnection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSignal) return;
    requestConnection.mutate({
      recipientId: selectedSignal.owner.id,
      signalId: selectedSignal.id,
      note: requestNote,
    });
  };
  const submitProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const list = (value: string) =>
      value
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
    setIsUploadingAvatar(Boolean(avatarImage));
    try {
      const photoUrl = avatarImage
        ? await uploadImage("avatar", avatarImage.file)
        : profileForm.photoUrl.trim() || null;
      await saveProfile.mutateAsync({
        country: profileForm.country.trim() || null,
        languages: list(profileForm.languages),
        about: profileForm.about.trim() || null,
        skills: list(profileForm.skills),
        interests: list(profileForm.interests),
        photoUrl,
      });
      clearAvatarImage();
    } catch (error) {
      notifyError(error);
    } finally {
      setIsUploadingAvatar(false);
    }
  };
  const submitMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currentUserId = auth.user?.id;
    const body = messageBody.trim();
    if (!routeChatId || (!body && !messageImage) || !currentUserId) return;
    setIsUploadingMessageImage(true);
    try {
      const imageUrl = messageImage
        ? await uploadImage("chat", messageImage.file)
        : null;
      const clientMessageId = crypto.randomUUID();
      setPendingMessages(current => [
        ...current,
        {
          clientMessageId,
          connectionId: routeChatId,
          body,
          imageUrl,
          senderId: currentUserId,
          createdAt: new Date(),
        },
      ]);
      await sendMessage.mutateAsync({
        connectionId: routeChatId,
        body,
        imageUrl,
        clientMessageId,
      });
      setMessageBody("");
      clearMessageImage();
    } catch (error) {
      notifyError(error);
    } finally {
      setIsUploadingMessageImage(false);
    }
  };
  const submitTrustAction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trustAction) return;
    if (trustAction.kind === "block")
      blockUser.mutate({ userId: trustAction.userId });
    else
      reportUser.mutate({
        reportedUserId: trustAction.userId,
        reason: reportReason,
        details: reportDetails.trim() || null,
      });
  };
  const ConnectionAction = ({
    signal,
  }: {
    signal: { id: number; title: string; owner: { id: number } };
  }) => {
    if (signal.owner.id === auth.user?.id)
      return (
        <button className="muted-btn" onClick={() => go("dashboard")}>
          Your signal
        </button>
      );
    const existing = connectionFor(signal.owner.id);
    if (
      pendingRecipientIds.includes(signal.owner.id) ||
      (existing?.status === "pending" && existing.requesterId === auth.user?.id)
    )
      return (
        <button className="muted-btn" disabled>
          {t("pending")}
        </button>
      );
    if (existing?.status === "pending")
      return (
        <button className="muted-btn" onClick={() => go("connections")}>
          {t("reviewRequest")}
        </button>
      );
    if (existing?.status === "accepted")
      return (
        <button
          className="primary-btn primary-btn--compact"
          onClick={() => go("chat", existing.id)}
        >
          {t("message")} <MessageCircle size={15} />
        </button>
      );
    return (
      <button
        className="primary-btn primary-btn--compact"
        onClick={() => openConnection(signal)}
      >
        {t("connect")} <Link2 size={15} />
      </button>
    );
  };

  if (screen === "landing" && !auth.isAuthenticated) {
    return (
      <>
        <GuestLanding
          onLogin={auth.openAuth}
          onExplore={() => go("discover")}
          onHowItWorks={() =>
            document
              .getElementById("how")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        />
        <SupabaseAuthDialog
          open={auth.authDialogOpen}
          onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
        />
      </>
    );
  }

  return (
    <div className="nivo-app app-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => go("dashboard")}>
          <OfficialLogo />
          <span className="brand-name">KINBA</span>
        </button>
        <nav className="desktop-nav app-nav">
          <button
            className={screen === "dashboard" ? "active" : ""}
            onClick={() => go("dashboard")}
          >
            {t("home")}
          </button>
          <button
            className={screen === "discover" ? "active" : ""}
            onClick={() => go("discover")}
          >
            {t("discover")}
          </button>
          <button
            className={
              screen === "connections" || screen === "chat" ? "active" : ""
            }
            onClick={() => go("connections")}
          >
            {t("connections")}
          </button>
          <button
            className={screen === "profile" ? "active" : ""}
            onClick={() => go("profile")}
          >
            {t("profile")}
          </button>
        </nav>
        <div className="topbar-actions">
          <LanguageSelector />
          <button
            className="header-profile"
            onClick={() => go("profile")}
            aria-label="Open your profile"
          >
            <Avatar name={auth.user?.name} photoUrl={headerPhoto} />
          </button>
          <button
            className="primary-btn primary-btn--compact"
            onClick={() => startComposer("need")}
          >
            <Plus size={15} /> {t("create")}
          </button>
          <button
            className="menu-btn"
            aria-label="Open menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
        {menuOpen && (
          <div className="mobile-menu">
            <button onClick={() => go("dashboard")}>{t("home")}</button>
            <button onClick={() => go("discover")}>{t("discover")}</button>
            <button onClick={() => go("connections")}>
              {t("connections")}
            </button>
            <button onClick={() => go("profile")}>{t("profile")}</button>
          </div>
        )}
      </header>
      <main className="app-main">
        {screen === "dashboard" && (
          <section
            className="dashboard section-shell max-w-6xl mx-auto px-6 py-10"
            data-layout="attached-dashboard"
          >
            <div className="dashboard-head mb-10 max-w-2xl">
              <div>
                <p className="eyebrow">{t("yourNivo")}</p>
                <h1>
                  Start with what
                  <br />
                  <span>matters now.</span>
                </h1>
              </div>
              <p>
                {auth.user?.name
                  ? `Welcome, ${auth.user.name}.`
                  : "Put a need or capability into the network."}
              </p>
            </div>
            <div className="action-split grid grid-cols-1 md:grid-cols-2 gap-6">
              <button onClick={() => startComposer("need")}>
                <span className="action-icon">
                  <Search size={22} />
                </span>
                <div>
                  <small>{t("shareIntention")}</small>
                  <strong>+ I NEED</strong>
                  <p>Find a person, skill, answer, or opportunity.</p>
                </div>
                <ArrowRight size={18} />
              </button>
              <button onClick={() => startComposer("can")}>
                <span className="action-icon action-icon--violet">
                  <Zap size={22} />
                </span>
                <div>
                  <small>{t("shareCapability")}</small>
                  <strong>+ I CAN</strong>
                  <p>Make your knowledge, work, or help discoverable.</p>
                </div>
                <ArrowRight size={18} />
              </button>
            </div>
            <div className="app-section-head">
              <div>
                <p className="eyebrow">{t("activeSignals")}</p>
                <h2>
                  What you’ve put
                  <br />
                  into the network.
                </h2>
              </div>
              <button className="text-btn" onClick={() => go("discover")}>
                {t("discoverPeople")} <ArrowRight size={15} />
              </button>
            </div>
            {ownSignalsQuery.isLoading ? (
              <div className="loading-row">
                <Loader2 className="spin" /> Loading your signals
              </div>
            ) : ownSignalsQuery.data?.length ? (
              <div className="signal-list own-signal-list grid gap-4">
                {ownSignalsQuery.data.map(signal => (
                  <article className="signal-row" key={signal.id}>
                    <span
                      className={`type-pill ${signal.type === "can" ? "type-pill--violet" : ""}`}
                    >
                      {signal.type === "need" ? "I NEED" : "I CAN"}
                    </span>
                    <div>
                      <h3>{signal.title}</h3>
                      <p>{signal.description}</p>
                      {signal.imageUrl && (
                        <img
                          className="signal-row-image"
                          src={signal.imageUrl}
                          alt={`Attached image for ${signal.title}`}
                          loading="lazy"
                        />
                      )}
                      {signal.mediaUrl && signal.mediaType !== "NONE" && (
                        <SignalMediaPlayer
                          url={signal.mediaUrl}
                          mediaType={signal.mediaType}
                          duration={signal.mediaDuration}
                        />
                      )}
                      <small>
                        {signal.category} · {signal.language} · {signal.status}
                      </small>
                      <CommentPanel
                        postId={signal.id}
                        postOwnerId={signal.userId}
                        currentUserId={auth.user?.id}
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-icon">
                  <Plus size={19} />
                </span>
                <h3>Your network starts here.</h3>
                <p>
                  You have not posted a NEED or CAN yet. Add one clear signal to
                  make it discoverable.
                </p>
                <button
                  className="ghost-btn"
                  onClick={() => startComposer("need")}
                >
                  Post your first need <ArrowRight size={15} />
                </button>
              </div>
            )}
            <section className="matches-section">
              <div className="app-section-head">
                <div>
                  <p className="eyebrow">{t("opportunities")}</p>
                  <h2>
                    Signals that may
                    <br />
                    <span>fit your own.</span>
                  </h2>
                </div>
                <div className="match-search">
                  <Search size={15} />
                  <input
                    value={matchSearch}
                    onChange={event => setMatchSearch(event.target.value)}
                    placeholder={t("refineMatches")}
                    aria-label={t("refineMatches")}
                  />
                </div>
              </div>
              {matchesQuery.isLoading ? (
                <div className="loading-row">
                  <Loader2 className="spin" /> Calculating matches
                </div>
              ) : matches.length ? (
                <div className="match-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {matches.map(signal => (
                    <article className="match-card" key={signal.id}>
                      <div className="match-card-top">
                        <span
                          className={`type-pill ${signal.type === "can" ? "type-pill--violet" : ""}`}
                        >
                          {signal.type === "need" ? "I NEED" : "I CAN"}
                        </span>
                        <strong>{signal.matchScore}% fit</strong>
                      </div>
                      <h3>{signal.title}</h3>
                      <p>{signal.description}</p>
                      {signal.imageUrl && (
                        <img
                          className="signal-card-image"
                          src={signal.imageUrl}
                          alt={`Attached image for ${signal.title}`}
                          loading="lazy"
                        />
                      )}
                      {signal.mediaUrl && signal.mediaType !== "NONE" && (
                        <SignalMediaPlayer
                          url={signal.mediaUrl}
                          mediaType={signal.mediaType}
                          duration={signal.mediaDuration}
                        />
                      )}
                      <small>
                        {signal.category} · complements your{" "}
                        {signal.matchedWith.toUpperCase()}
                      </small>
                      <button
                        className="discover-owner signal-owner signal-owner--button"
                        onClick={() => go("member", signal.owner.id)}
                      >
                        <Avatar
                          name={signal.owner.name}
                          photoUrl={signal.owner.photoUrl}
                        />
                        <div>
                          <strong>{signal.owner.name ?? "KINBA member"}</strong>
                          <small>
                            {signal.owner.country ?? "Location private"}
                          </small>
                        </div>
                        <ArrowRight size={14} />
                      </button>
                      <div className="discover-actions card-actions pt-4 border-t border-slate-800/60 flex items-center justify-between">
                        <ConnectionAction signal={signal} />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">
                    <UsersRound size={19} />
                  </span>
                  <h3>
                    {ownSignalsQuery.data?.length
                      ? "No compatible signals are live right now."
                      : "Post a signal to calculate your matches."}
                  </h3>
                  <p>
                    KINBA scores complementary NEED and CAN signals by category
                    first, then meaningful words in the signal.
                  </p>
                  {ownSignalsQuery.data?.length ? (
                    <button
                      className="ghost-btn"
                      onClick={() => go("discover")}
                    >
                      Browse all signals <ArrowRight size={15} />
                    </button>
                  ) : (
                    <button
                      className="ghost-btn"
                      onClick={() => startComposer("need")}
                    >
                      {t("postNeed")} <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              )}
            </section>
          </section>
        )}
        {screen === "discover" && (
          <section
            className="discover-page section-shell max-w-6xl mx-auto px-6 py-10"
            data-layout="attached-discover"
          >
            <div className="app-section-head discover-intro mb-10 max-w-2xl">
              <div>
                <p className="eyebrow text-amber-500">{t("exploreNetwork")}</p>
                <h1>
                  {t("findSignal")}
                  <br />
                  <span>{t("thatMatters")}.</span>
                </h1>
              </div>
              <p className="section-intro">
                Browse only active signals from KINBA members. Search, filter,
                open a profile, send a request, or block a member.
              </p>
            </div>
            <div className="filter-stack">
              <label className="discover-search relative max-w-xl w-full">
                <Search size={16} />
                <input
                  value={searchTerm}
                  onChange={event => setSearchTerm(event.target.value)}
                  placeholder={t("searchSignals")}
                  aria-label={t("searchSignals")}
                />
              </label>
              <div className="filter-group flex flex-wrap items-center gap-2 pt-2">
                <span>{t("type")}</span>
                {["all", "need", "can"].map(type => (
                  <button
                    key={type}
                    className={typeFilter === type ? "active" : ""}
                    onClick={() => setTypeFilter(type as "all" | SignalMode)}
                  >
                    {type === "all"
                      ? t("allSignals")
                      : type === "need"
                        ? t("need")
                        : t("can")}
                  </button>
                ))}
              </div>
              <div className="category-row flex flex-wrap items-center gap-2">
                {categories.map(category => (
                  <button
                    className={categoryFilter === category ? "active" : ""}
                    key={category}
                    onClick={() => setCategoryFilter(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
            {signalsQuery.isLoading ? (
              <div className="loading-row">
                <Loader2 className="spin" />
                {t("loadingSignals")}
              </div>
            ) : signalsQuery.isError ? (
              <div className="empty-state">
                <h3>We could not load signals.</h3>
                <p>Please check your connection and try again.</p>
                <button
                  className="ghost-btn"
                  onClick={() => signalsQuery.refetch()}
                >
                  Retry
                </button>
              </div>
            ) : signals.length ? (
              <div className="discover-signal-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {signals.map(signal => (
                  <article
                    className="discover-signal-card bg-slate-900/70 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-xl flex flex-col justify-between space-y-5"
                    key={signal.id}
                  >
                    <div className="discover-card-top flex items-center justify-between">
                      <span
                        className={`type-pill ${signal.type === "can" ? "type-pill--violet" : ""}`}
                      >
                        {signal.type === "need" ? "I NEED" : "I CAN"}
                      </span>
                      <span className="discover-live-status">Live</span>
                    </div>
                    {signal.imageUrl && (
                      <img
                        className="signal-card-image"
                        src={signal.imageUrl}
                        alt={`Attached image for ${signal.title}`}
                        loading="lazy"
                      />
                    )}
                    {signal.mediaUrl && signal.mediaType !== "NONE" && (
                      <SignalMediaPlayer
                        url={signal.mediaUrl}
                        mediaType={signal.mediaType}
                        duration={signal.mediaDuration}
                      />
                    )}
                    <h3>{signal.title}</h3>
                    <p>{signal.description}</p>
                    <div className="discover-tags flex flex-wrap gap-1.5">
                      <span>{signal.category}</span>
                      <span>{signal.language}</span>
                      {signal.location && <span>{signal.location}</span>}
                    </div>
                    <button
                      className="discover-owner signal-owner signal-owner--button"
                      onClick={() => go("member", signal.owner.id)}
                    >
                      <Avatar
                        name={signal.owner.name}
                        photoUrl={signal.owner.photoUrl}
                      />
                      <div>
                        <strong>{signal.owner.name ?? "KINBA member"}</strong>
                        <small>
                          {signal.owner.country ?? "Location private"}
                          {signal.owner.phoneVerified ? " · Verified" : ""}
                        </small>
                      </div>
                      <ArrowRight size={14} />
                    </button>
                    <div className="discover-actions card-actions pt-4 border-t border-slate-800/60 flex items-center justify-between">
                      <ConnectionAction signal={signal} />
                      {signal.owner.id !== auth.user?.id && (
                        <button
                          className="icon-action"
                          aria-label={`Block ${signal.owner.name ?? "member"}`}
                          onClick={() =>
                            openTrustAction(
                              "block",
                              signal.owner.id,
                              signal.owner.name
                            )
                          }
                        >
                          <ShieldAlert size={15} />
                        </button>
                      )}
                    </div>
                    <CommentPanel
                      postId={signal.id}
                      postOwnerId={signal.owner.id}
                      currentUserId={auth.user?.id}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-icon">
                  <Compass size={19} />
                </span>
                <h3>{t("noSignals")}</h3>
                <p>{t("noSignalsHelp")}</p>
                <button
                  className="ghost-btn"
                  onClick={() => startComposer("need")}
                >
                  {t("postNeed")} <ArrowRight size={15} />
                </button>
              </div>
            )}
          </section>
        )}
        {screen === "member" && (
          <section className="member-page section-shell">
            <button className="back-btn" onClick={() => go("discover")}>
              <ArrowLeft size={16} /> Discover
            </button>
            {memberQuery.isLoading ? (
              <div className="loading-row">
                <Loader2 className="spin" /> Loading member profile
              </div>
            ) : memberQuery.isError || !memberQuery.data ? (
              <div className="empty-state">
                <h3>This member profile is not available.</h3>
                <p>
                  It may have been removed or restricted through safety
                  controls.
                </p>
                <button className="ghost-btn" onClick={() => go("discover")}>
                  Back to discover
                </button>
              </div>
            ) : (
              <>
                <section className="member-hero">
                  <Avatar
                    name={memberQuery.data.user.name}
                    photoUrl={memberQuery.data.profile?.photoUrl}
                    large
                  />
                  <div>
                    <p className="eyebrow">KINBA member</p>
                    <h1>
                      {memberQuery.data.user.name ?? "KINBA member"}
                      {memberQuery.data.profile?.phoneVerified ? (
                        <ShieldCheck size={19} />
                      ) : null}
                    </h1>
                    <p>
                      {memberQuery.data.profile?.country ?? "Location private"}{" "}
                      ·{" "}
                      {parseList(memberQuery.data.profile?.languages).join(
                        ", "
                      ) || "Languages private"}
                    </p>
                  </div>
                  <div className="member-stat">
                    <strong>{memberQuery.data.completedConnections}</strong>
                    <span>Established connections</span>
                  </div>
                  {memberQuery.data.user.id !== auth.user?.id && (
                    <div className="member-safety-actions">
                      <button
                        className="muted-btn"
                        onClick={() =>
                          openTrustAction(
                            "report",
                            memberQuery.data.user.id,
                            memberQuery.data.user.name
                          )
                        }
                      >
                        <Flag size={15} /> Report
                      </button>
                      <button
                        className="muted-btn"
                        onClick={() =>
                          openTrustAction(
                            "block",
                            memberQuery.data.user.id,
                            memberQuery.data.user.name
                          )
                        }
                      >
                        <ShieldAlert size={15} /> Block
                      </button>
                    </div>
                  )}
                </section>
                <div className="member-grid">
                  <section className="member-about">
                    <p className="eyebrow">About</p>
                    <p>
                      {memberQuery.data.profile?.about ||
                        "This member has not added an introduction yet."}
                    </p>
                    <div className="member-tags">
                      <div>
                        <span>Skills</span>
                        {parseList(memberQuery.data.profile?.skills).length ? (
                          parseList(memberQuery.data.profile?.skills).map(
                            skill => <i key={skill}>{skill}</i>
                          )
                        ) : (
                          <small>Not shared</small>
                        )}
                      </div>
                      <div>
                        <span>Interests</span>
                        {parseList(memberQuery.data.profile?.interests)
                          .length ? (
                          parseList(memberQuery.data.profile?.interests).map(
                            interest => <i key={interest}>{interest}</i>
                          )
                        ) : (
                          <small>Not shared</small>
                        )}
                      </div>
                    </div>
                  </section>
                  <section>
                    <p className="eyebrow">Live signals</p>
                    <div className="member-signals">
                      {memberQuery.data.signals.length ? (
                        memberQuery.data.signals.map(signal => (
                          <article className="signal-row" key={signal.id}>
                            <span
                              className={`type-pill ${signal.type === "can" ? "type-pill--violet" : ""}`}
                            >
                              {signal.type === "need" ? "I NEED" : "I CAN"}
                            </span>
                            <div>
                              <h3>{signal.title}</h3>
                              <p>{signal.description}</p>
                              {signal.imageUrl && (
                                <img
                                  className="signal-row-image"
                                  src={signal.imageUrl}
                                  alt={`Attached image for ${signal.title}`}
                                  loading="lazy"
                                />
                              )}
                              {signal.mediaUrl &&
                                signal.mediaType !== "NONE" && (
                                  <SignalMediaPlayer
                                    url={signal.mediaUrl}
                                    mediaType={signal.mediaType}
                                    duration={signal.mediaDuration}
                                  />
                                )}
                              <small>
                                {signal.category} · {signal.language}
                              </small>
                              <CommentPanel
                                postId={signal.id}
                                postOwnerId={memberQuery.data.user.id}
                                currentUserId={auth.user?.id}
                              />
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="member-empty">
                          No active signals at this time.
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </>
            )}
          </section>
        )}
        {screen === "connections" && (
          <section className="connections-page section-shell">
            <div className="app-section-head">
              <div>
                <p className="eyebrow">Private connections</p>
                <h1>
                  Useful people,
                  <br />
                  <span>real conversations.</span>
                </h1>
              </div>
              <p className="section-intro">
                Requests are private. Messaging is unlocked only after the
                recipient accepts.
              </p>
            </div>
            {connectionsQuery.isLoading ? (
              <div className="loading-row">
                <Loader2 className="spin" /> Loading connections
              </div>
            ) : connections.length ? (
              <div className="connection-list">
                {connections.map(connection => {
                  const incoming = connection.recipientId === auth.user?.id;
                  const person = connection.counterpart;
                  return (
                    <article className="connection-card" key={connection.id}>
                      <button
                        className="connection-avatar-button"
                        onClick={() => person && go("member", person.id)}
                      >
                        <Avatar
                          name={person?.name}
                          photoUrl={person?.photoUrl}
                          large
                        />
                      </button>
                      <div className="connection-content">
                        <div className="connection-title">
                          <div>
                            <span
                              className={`connection-status connection-status--${connection.status}`}
                            >
                              {connection.status}
                            </span>
                            <button
                              className="member-name-button"
                              onClick={() => person && go("member", person.id)}
                            >
                              <h3>
                                {person?.name ?? "KINBA member"}
                                {person?.phoneVerified && (
                                  <ShieldCheck size={14} />
                                )}
                              </h3>
                            </button>
                            <p>{connection.note}</p>
                          </div>
                          {connection.status === "accepted" && (
                            <button
                              className="primary-btn primary-btn--compact"
                              onClick={() => go("chat", connection.id)}
                            >
                              {t("message")} <MessageCircle size={15} />
                            </button>
                          )}
                        </div>
                        <small>
                          {incoming
                            ? "They want to connect with you"
                            : "Your connection request"}
                        </small>
                        {connection.status === "pending" && (
                          <div className="connection-actions">
                            {incoming ? (
                              <>
                                <button
                                  className="primary-btn primary-btn--compact"
                                  disabled={acceptConnection.isPending}
                                  onClick={() =>
                                    acceptConnection.mutate({
                                      id: connection.id,
                                    })
                                  }
                                >
                                  {acceptConnection.isPending ? (
                                    <Loader2 className="spin" size={14} />
                                  ) : (
                                    <Check size={15} />
                                  )}{" "}
                                  Accept
                                </button>
                                <button
                                  className="muted-btn"
                                  disabled={declineConnection.isPending}
                                  onClick={() =>
                                    declineConnection.mutate({
                                      id: connection.id,
                                    })
                                  }
                                >
                                  Decline
                                </button>
                              </>
                            ) : (
                              <button
                                className="muted-btn"
                                disabled={cancelConnection.isPending}
                                onClick={() =>
                                  cancelConnection.mutate({ id: connection.id })
                                }
                              >
                                Cancel request
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-icon">
                  <Link2 size={19} />
                </span>
                <h3>No connections yet.</h3>
                <p>
                  Discover a posted signal and send a thoughtful request to
                  start a conversation.
                </p>
                <button className="ghost-btn" onClick={() => go("discover")}>
                  Explore signals <ArrowRight size={15} />
                </button>
              </div>
            )}
          </section>
        )}
        {screen === "chat" && (
          <section className="chat-page section-shell">
            <button className="back-btn" onClick={() => go("connections")}>
              <ArrowLeft size={16} /> Connections
            </button>
            {selectedConnection ? (
              <div className="chat-shell">
                <header className="chat-head">
                  <button
                    className="connection-avatar-button"
                    onClick={() =>
                      selectedConnection.counterpart &&
                      go("member", selectedConnection.counterpart.id)
                    }
                  >
                    <Avatar
                      name={selectedConnection.counterpart?.name}
                      photoUrl={selectedConnection.counterpart?.photoUrl}
                    />
                  </button>
                  <div>
                    <h2>
                      {selectedConnection.counterpart?.name ?? "KINBA member"}
                    </h2>
                    <span>
                      <span className="online-dot" /> Connection established
                    </span>
                  </div>
                  <button
                    className="muted-btn"
                    onClick={() =>
                      selectedConnection.counterpart &&
                      openTrustAction(
                        "block",
                        selectedConnection.counterpart.id,
                        selectedConnection.counterpart.name
                      )
                    }
                  >
                    <ShieldAlert size={15} /> Block
                  </button>
                </header>
                <div className="message-thread">
                  {messagesQuery.isLoading ? (
                    <div className="loading-row">
                      <Loader2 className="spin" /> Loading messages
                    </div>
                  ) : messageThread.length ? (
                    messageThread.map(message => (
                      <div
                        key={
                          "clientMessageId" in message
                            ? message.clientMessageId
                            : message.id
                        }
                        className={`message-bubble ${message.senderId === auth.user?.id ? "message-bubble--mine" : ""} ${"clientMessageId" in message ? "message-bubble--pending" : ""}`}
                      >
                        {message.imageUrl && (
                          <img
                            className="message-image"
                            src={message.imageUrl}
                            alt="Attached message"
                            loading="lazy"
                          />
                        )}
                        {message.body && <p>{message.body}</p>}
                        <small>
                          {"clientMessageId" in message
                            ? "Sending…"
                            : new Date(message.createdAt).toLocaleString()}
                        </small>
                      </div>
                    ))
                  ) : (
                    <div className="chat-empty">
                      <MessageCircle size={22} />
                      <h3>The conversation is ready.</h3>
                      <p>
                        Say hello and keep the conversation focused on the
                        connection you both accepted.
                      </p>
                    </div>
                  )}
                </div>
                <form className="message-form" onSubmit={submitMessage}>
                  <input
                    ref={messageImageInputRef}
                    id="chat-image-upload"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    onChange={selectMessageImage}
                  />
                  <div className="message-composer">
                    <div className="message-entry">
                      <button
                        type="button"
                        className="chat-attachment-button"
                        onClick={() => messageImageInputRef.current?.click()}
                        aria-label="Attach an image"
                        title="Attach an image"
                      >
                        <ImagePlus size={18} />
                      </button>
                      <textarea
                        value={messageBody}
                        onChange={event => setMessageBody(event.target.value)}
                        placeholder="Write a message…"
                        rows={2}
                        maxLength={4000}
                      />
                      <button
                        className="primary-btn"
                        type="submit"
                        disabled={
                          sendMessage.isPending ||
                          isUploadingMessageImage ||
                          (!messageBody.trim() && !messageImage)
                        }
                      >
                        {sendMessage.isPending || isUploadingMessageImage ? (
                          <Loader2 className="spin" size={17} />
                        ) : (
                          <Send size={17} />
                        )}
                      </button>
                    </div>
                    {messageImage && (
                      <div className="image-preview image-preview--chat">
                        <img
                          src={messageImage.previewUrl}
                          alt="Selected message preview"
                        />
                        <div>
                          <strong>{messageImage.file.name}</strong>
                          <span>
                            {Math.ceil(messageImage.file.size / 1024)} KB
                          </span>
                        </div>
                        <button
                          type="button"
                          className="image-preview-remove"
                          onClick={clearMessageImage}
                          aria-label="Remove selected image"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </form>
              </div>
            ) : (
              <div className="empty-state">
                <h3>This conversation is not available.</h3>
                <button className="ghost-btn" onClick={() => go("connections")}>
                  Back to connections
                </button>
              </div>
            )}
          </section>
        )}
        {screen === "profile" && (
          <section className="profile-page section-shell">
            <div className="app-section-head">
              <div>
                <p className="eyebrow">Your profile</p>
                <h1>
                  Let the right person
                  <br />
                  <span>understand you.</span>
                </h1>
              </div>
              <span className="profile-status">
                Profile data is private until you choose what to share.
              </span>
            </div>
            <form className="profile-form" onSubmit={submitProfile}>
              <section className="profile-preview">
                <div className="profile-avatar-picker">
                  <button
                    type="button"
                    className="profile-avatar-upload"
                    onClick={() => avatarImageInputRef.current?.click()}
                    aria-label="Upload a profile photo"
                  >
                    <Avatar
                      name={profileQuery.data?.user?.name ?? auth.user?.name}
                      photoUrl={
                        avatarImage?.previewUrl ??
                        (profileForm.photoUrl || null)
                      }
                      large
                    />
                    <span className="avatar-upload-badge">
                      <ImagePlus size={15} />
                    </span>
                  </button>
                  <input
                    ref={avatarImageInputRef}
                    id="avatar-image-upload"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="sr-only"
                    onChange={selectAvatarImage}
                  />
                  <button
                    type="button"
                    className="upload-photo-button"
                    onClick={() => avatarImageInputRef.current?.click()}
                  >
                    <ImagePlus size={15} /> Upload photo
                  </button>
                  <small>JPG, PNG, WEBP, or GIF · Max 5MB</small>
                </div>
                <div>
                  <h2>
                    {profileQuery.data?.user?.name ??
                      auth.user?.name ??
                      "KINBA member"}
                  </h2>
                  <p>{profileForm.country || "Location not shared"}</p>
                  <span>{profileForm.languages || "Languages not added"}</span>
                </div>
              </section>
              <section
                className="profile-stat-grid"
                aria-label="Profile statistics"
              >
                <div className="profile-stat">
                  <strong>
                    {profileQuery.data?.stats?.reactionsReceived ?? 0}
                  </strong>
                  <span>Reactions received</span>
                </div>
                <div className="profile-stat">
                  <strong>{profileQuery.data?.stats?.iconsCount ?? 0}</strong>
                  <span>ICONS</span>
                </div>
                <div className="profile-stat">
                  <strong>
                    {profileQuery.data?.stats?.followingCount ?? 0}
                  </strong>
                  <span>Following</span>
                </div>
                <div className="profile-stat">
                  <strong>
                    {profileQuery.data?.stats?.followersCount ?? 0}
                  </strong>
                  <span>Followers</span>
                </div>
              </section>
              <div className="form-grid">
                <InputLabel label="Country">
                  <input
                    value={profileForm.country}
                    onChange={event =>
                      setProfileForm({
                        ...profileForm,
                        country: event.target.value,
                      })
                    }
                    placeholder="e.g. Kenya"
                    maxLength={100}
                  />
                </InputLabel>
                <InputLabel label="Languages (separate with commas)">
                  <input
                    value={profileForm.languages}
                    onChange={event =>
                      setProfileForm({
                        ...profileForm,
                        languages: event.target.value,
                      })
                    }
                    placeholder="English, Arabic"
                  />
                </InputLabel>
                <InputLabel label="Skills (separate with commas)">
                  <input
                    value={profileForm.skills}
                    onChange={event =>
                      setProfileForm({
                        ...profileForm,
                        skills: event.target.value,
                      })
                    }
                    placeholder="Product design, Flutter"
                  />
                </InputLabel>
                <InputLabel label="Interests (separate with commas)">
                  <input
                    value={profileForm.interests}
                    onChange={event =>
                      setProfileForm({
                        ...profileForm,
                        interests: event.target.value,
                      })
                    }
                    placeholder="Learning, collaboration"
                  />
                </InputLabel>
                <InputLabel label="About">
                  <textarea
                    value={profileForm.about}
                    onChange={event =>
                      setProfileForm({
                        ...profileForm,
                        about: event.target.value,
                      })
                    }
                    placeholder="Write a short, helpful introduction."
                    rows={5}
                    maxLength={700}
                  />
                </InputLabel>
              </div>
              <div className="profile-save">
                <p>
                  Keep personal contact details private. KINBA only shares the
                  profile details you choose to add.
                </p>
                <button
                  className="primary-btn"
                  type="submit"
                  disabled={saveProfile.isPending || isUploadingAvatar}
                >
                  {saveProfile.isPending || isUploadingAvatar ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Pencil size={16} />
                  )}{" "}
                  Save profile
                </button>
              </div>
            </form>
            <section
              className="profile-content-section"
              aria-labelledby="profile-content-heading"
            >
              <div className="profile-content-head">
                <div>
                  <p className="eyebrow">Your network</p>
                  <h2 id="profile-content-heading">Your KINBA activity</h2>
                </div>
                <p className="profile-content-caption">
                  {profileTab === "following"
                    ? "Signals from the people you follow."
                    : profileTab === "videos"
                      ? "Your published video signals."
                      : profileTab === "trendy"
                        ? "Your ICONS ranked by reactions and conversation."
                        : "All of your active ICONS."}
                </p>
              </div>
              <div
                className="profile-tabs"
                role="tablist"
                aria-label="Profile content"
              >
                {profileTabs.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={profileTab === tab.id}
                    className={profileTab === tab.id ? "active" : ""}
                    onClick={() => setProfileTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="profile-tab-panel" role="tabpanel">
                {profileContentQuery.isLoading ? (
                  <div className="loading-row">
                    <Loader2 className="spin" /> Loading activity
                  </div>
                ) : profileContentQuery.isError ? (
                  <div className="empty-state">
                    Unable to load this profile view. Please try again.
                  </div>
                ) : profileContentQuery.data?.length ? (
                  <div className="profile-content-grid">
                    {profileContentQuery.data.map(signal => (
                      <article className="profile-content-card" key={signal.id}>
                        <div className="profile-content-card-head">
                          <Avatar
                            name={signal.owner.name}
                            photoUrl={signal.owner.photoUrl}
                          />
                          <div>
                            <strong>
                              {signal.owner.name ?? "KINBA member"}
                            </strong>
                            <span>
                              {profileTab === "following"
                                ? (signal.owner.country ?? "Location private")
                                : "Your ICON"}
                            </span>
                          </div>
                          <span
                            className={`type-pill ${signal.type === "can" ? "type-pill--violet" : ""}`}
                          >
                            {signal.type === "need" ? "I NEED" : "I CAN"}
                          </span>
                        </div>
                        <h3>{signal.title}</h3>
                        <p>{signal.description}</p>
                        {signal.imageUrl && (
                          <img
                            className="signal-row-image"
                            src={signal.imageUrl}
                            alt={`Attached image for ${signal.title}`}
                            loading="lazy"
                          />
                        )}
                        {signal.mediaUrl && signal.mediaType !== "NONE" && (
                          <SignalMediaPlayer
                            url={signal.mediaUrl}
                            mediaType={signal.mediaType}
                            duration={signal.mediaDuration}
                          />
                        )}
                        <div className="profile-content-meta">
                          <span>
                            {signal.category} · {signal.language}
                          </span>
                          <span>
                            <Heart size={14} fill="currentColor" />{" "}
                            {signal.reactionCount}
                          </span>
                          <span>
                            <MessageCircle size={14} /> {signal.commentCount}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    {profileTab === "following"
                      ? "Follow members to see their latest signals here."
                      : profileTab === "videos"
                        ? "No video signals yet. Publish a short video to bring this view to life."
                        : profileTab === "trendy"
                          ? "Your ICONS will appear here as your network reacts and joins the conversation."
                          : "No active ICONS yet. Share an I NEED or I CAN signal to get started."}
                  </div>
                )}
              </div>
            </section>
            <button
              className="logout-row"
              onClick={() => auth.logout().then(() => go("landing"))}
            >
              <LogOut size={15} /> Log out
            </button>
          </section>
        )}
      </main>
      <nav className="bottom-nav">
        <button
          className={screen === "dashboard" ? "active" : ""}
          onClick={() => go("dashboard")}
        >
          <HomeIcon size={19} />
          <span>Home</span>
        </button>
        <button
          className={screen === "discover" ? "active" : ""}
          onClick={() => go("discover")}
        >
          <Compass size={19} />
          <span>Discover</span>
        </button>
        <button
          className="create-nav"
          aria-label="Create a signal"
          onClick={() => startComposer("need")}
        >
          <Plus size={23} />
        </button>
        <button
          className={
            screen === "connections" || screen === "chat" ? "active" : ""
          }
          onClick={() => go("connections")}
        >
          <MessageCircle size={19} />
          <span>Connections</span>
        </button>
        <button
          className={screen === "profile" ? "active" : ""}
          onClick={() => go("profile")}
        >
          <UserRound size={19} />
          <span>Profile</span>
        </button>
      </nav>
      {composerMode && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="request-modal composer-modal"
            onSubmit={submitSignal}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => {
                clearSignalImage();
                clearSignalMedia();
                setComposerMode(null);
              }}
              aria-label="Close publishing form"
            >
              <X size={18} />
            </button>
            <p className="eyebrow">Publish a signal</p>
            <h2>
              {composerMode === "need"
                ? "What do you need?"
                : "What can you provide?"}
            </h2>
            <p className="modal-copy">
              Use clear language so the right person can understand the signal
              quickly.
            </p>
            <InputLabel label="Short title">
              <input
                value={signalForm.title}
                onChange={event =>
                  setSignalForm({ ...signalForm, title: event.target.value })
                }
                placeholder={
                  composerMode === "need"
                    ? "I need a website for my business"
                    : "I can teach conversational English"
                }
                minLength={5}
                maxLength={180}
                required
              />
            </InputLabel>
            <InputLabel label="Details">
              <textarea
                value={signalForm.description}
                onChange={event =>
                  setSignalForm({
                    ...signalForm,
                    description: event.target.value,
                  })
                }
                placeholder="Add useful detail about the need or capability."
                rows={4}
                minLength={12}
                maxLength={2400}
                required
              />
            </InputLabel>
            <div className="compact-form-grid">
              <InputLabel label="Category">
                <select
                  value={signalForm.category}
                  onChange={event =>
                    setSignalForm({
                      ...signalForm,
                      category: event.target.value,
                    })
                  }
                >
                  {categories.slice(1).map(category => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </InputLabel>
              <InputLabel label="Language">
                <input
                  value={signalForm.language}
                  onChange={event =>
                    setSignalForm({
                      ...signalForm,
                      language: event.target.value,
                    })
                  }
                  maxLength={64}
                  required
                />
              </InputLabel>
            </div>
            <InputLabel label="Location (optional)">
              <input
                value={signalForm.location}
                onChange={event =>
                  setSignalForm({ ...signalForm, location: event.target.value })
                }
                placeholder="e.g. Remote, Nairobi"
                maxLength={120}
              />
            </InputLabel>
            <div className="image-picker">
              <input
                ref={signalImageInputRef}
                id="signal-image-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                onChange={selectSignalImage}
              />
              <button
                type="button"
                className="image-picker-button"
                onClick={() => signalImageInputRef.current?.click()}
              >
                <ImagePlus size={17} /> Add an image
              </button>
              <p>JPG, PNG, WEBP, or GIF · Max 5MB</p>
              {signalImage && (
                <div className="image-preview">
                  <img
                    src={signalImage.previewUrl}
                    alt="Selected signal preview"
                  />
                  <div>
                    <strong>{signalImage.file.name}</strong>
                    <span>{Math.ceil(signalImage.file.size / 1024)} KB</span>
                  </div>
                  <button
                    type="button"
                    className="image-preview-remove"
                    onClick={clearSignalImage}
                    aria-label="Remove selected image"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
            <SignalMediaPicker
              media={signalMedia}
              onChange={next => {
                if (next && signalImage) clearSignalImage();
                setSignalMedia(next);
              }}
            />
            <button
              className="primary-btn primary-btn--wide"
              type="submit"
              disabled={createSignal.isPending || isUploadingSignalImage}
            >
              {createSignal.isPending || isUploadingSignalImage ? (
                <Loader2 className="spin" size={16} />
              ) : (
                "Publish signal"
              )}
              <ArrowRight size={16} />
            </button>
          </form>
        </div>
      )}
      {selectedSignal && (
        <div className="modal-backdrop" role="presentation">
          <form className="request-modal" onSubmit={submitConnection}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setRequestSignalId(null)}
              aria-label="Close connection form"
            >
              <X size={18} />
            </button>
            <p className="eyebrow">Connection request</p>
            <h2>Make the first move.</h2>
            <p className="modal-copy">
              Tell {selectedSignal.owner.name ?? "this member"} why you want to
              connect. This note is stored privately with the request.
            </p>
            <div className="request-person">
              <Avatar
                name={selectedSignal.owner.name}
                photoUrl={selectedSignal.owner.photoUrl}
                large
              />
              <div>
                <strong>{selectedSignal.owner.name ?? "KINBA member"}</strong>
                <span>
                  {selectedSignal.category} ·{" "}
                  {selectedSignal.owner.country ?? "Location private"}
                </span>
              </div>
            </div>
            <InputLabel label="Your note">
              <textarea
                value={requestNote}
                onChange={event => setRequestNote(event.target.value)}
                rows={4}
                minLength={10}
                maxLength={1200}
                required
              />
            </InputLabel>
            <button
              className="primary-btn primary-btn--wide"
              type="submit"
              disabled={requestConnection.isPending}
            >
              {requestConnection.isPending ? (
                <Loader2 className="spin" size={16} />
              ) : (
                "Send connection request"
              )}
              <ArrowRight size={16} />
            </button>
            <div className="trust-row">
              <button
                type="button"
                onClick={() =>
                  openTrustAction(
                    "report",
                    selectedSignal.owner.id,
                    selectedSignal.owner.name
                  )
                }
              >
                <Flag size={14} /> Report
              </button>
              <button
                type="button"
                onClick={() =>
                  openTrustAction(
                    "block",
                    selectedSignal.owner.id,
                    selectedSignal.owner.name
                  )
                }
              >
                <ShieldAlert size={14} /> Block
              </button>
            </div>
          </form>
        </div>
      )}
      {trustAction && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="request-modal trust-modal"
            onSubmit={submitTrustAction}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setTrustAction(null)}
              aria-label="Close safety action"
            >
              <X size={18} />
            </button>
            <p className="eyebrow">Safety action</p>
            <h2>
              {trustAction.kind === "block"
                ? `Block ${trustAction.name}?`
                : `Report ${trustAction.name}?`}
            </h2>
            <p className="modal-copy">
              {trustAction.kind === "block"
                ? "This stores a block immediately and hides this member from your discovery, matching, connections, and conversations."
                : "Your report is stored for review. Please include only factual, relevant details."}
            </p>
            {trustAction.kind === "report" && (
              <>
                <InputLabel label="Reason">
                  <select
                    value={reportReason}
                    onChange={event =>
                      setReportReason(event.target.value as typeof reportReason)
                    }
                  >
                    <option value="spam">Spam</option>
                    <option value="harassment">Harassment</option>
                    <option value="unsafe">Unsafe behavior</option>
                    <option value="misleading">Misleading signal</option>
                    <option value="other">Other</option>
                  </select>
                </InputLabel>
                <InputLabel label="Details (optional)">
                  <textarea
                    value={reportDetails}
                    onChange={event => setReportDetails(event.target.value)}
                    rows={4}
                    maxLength={1200}
                    placeholder="Add relevant context"
                  />
                </InputLabel>
              </>
            )}
            <button
              className={
                trustAction.kind === "block"
                  ? "danger-btn primary-btn--wide"
                  : "primary-btn primary-btn--wide"
              }
              type="submit"
              disabled={blockUser.isPending || reportUser.isPending}
            >
              {blockUser.isPending || reportUser.isPending ? (
                <Loader2 className="spin" size={16} />
              ) : trustAction.kind === "block" ? (
                "Block member"
              ) : (
                "Submit report"
              )}
            </button>
          </form>
        </div>
      )}
      <SupabaseAuthDialog
        open={auth.authDialogOpen}
        onOpenChange={open => (open ? auth.openAuth() : auth.closeAuth())}
      />
    </div>
  );
}

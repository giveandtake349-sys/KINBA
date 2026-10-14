import {
  ChangeEvent,
  FormEvent,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { keepPreviousData } from "@tanstack/react-query";
import {
  BadgeCheck,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerUpLeft,
  Copy,
  Download,
  Flag,
  Heart,
  Image,
  Loader2,
  MessageCircle,
  Megaphone,
  Mic,
  Send,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  MoreHorizontal,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  Share2,
  Search,
  RotateCcw,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import Hls from "hls.js";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { apiUrl } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import {
  getVideoMetadata,
  MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS,
  uploadCommentAudio,
  uploadImage,
  uploadVideo,
  validateImageFile,
  type VideoMetadata,
} from "@/lib/mediaUpload";
import ErrorBoundary from "./ErrorBoundary";
import {
  ActionMenu,
  MentionPicker,
  ReactionBar,
  ReplyBanner,
  replyCountLabel,
  type ConversationAction,
  type ConversationReactionEntry,
  type ConversationReactionId,
  type MentionPickerHandle,
} from "./conversation";
import { MentionText } from "./MentionText";
import {
  applyMentionPick,
  findMentionToken,
  type MentionToken,
} from "@/lib/mentionParser";
import { isAbsoluteHttpUrl, resolveMediaUrl } from "@/lib/runtimeConfig";
import { isAndroidApp, saveImageToGallery } from "@/lib/galleryDownload";
import {
  attachPlaybackDiagnostics,
  describePlaybackFailure,
  logPlaybackEvent,
  shouldUseHlsJs,
} from "@/lib/mediaPlayback";
import { useVideoReaction } from "@/hooks/useVideoReaction";
import {
  adoptSingleReaction,
  applySingleReaction,
  tappedReactionType,
  totalReactionCount,
  type SingleReactionState,
} from "@/lib/reactionState";
import {
  ReactionSummaryPill,
  ReactorList,
} from "./reactions";
import { useLongPress } from "@/hooks/useLongPress";
import type { ReactionType } from "@shared/reactions";
import { postCaption } from "@/lib/postCaption";
import { Caption } from "./Caption";
import "./mediaHub.css";
import "./feedUi.css";
import "./modernFeed.css";
import "./shorts-stage.css";
import "./conversation/conversation.css";
import "./commentsUpgrade.css";
// @ts-expect-error The uploaded JSX module is intentionally kept as JSX for the feed design handoff.
import { NewestUpdates, ShortsRow } from "./FeedSections.jsx";
type HomeTab = "videos" | "trendy" | "following" | "icons" | "spotlight";
type VideoKind = "LONG" | "SHORT" | "WHEEL";
type Quality = "ORIGINAL" | "1080P" | "720P" | "480P" | "240P";
type VideoSource = { quality: Quality; videoUrl: string };
export type ShortsViewerOrigin = "videos" | "search" | "profile";

function isHlsMediaUrl(value: string) {
  return /\.m3u8(?:$|\?)/i.test(value);
}

function resolvePlaybackUrl(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return "";
  // Public R2/Supabase URLs are already browser-playable. Do not rewrite them
  // to /api/media/*, because this production app has no media proxy route.
  if (isAbsoluteHttpUrl(raw)) return raw;
  return resolveMediaUrl(raw) ?? "";
}

function navigateToProfile(
  event: MouseEvent<HTMLAnchorElement>,
  userId: number
) {
  event.preventDefault();
  event.stopPropagation();
  window.history.pushState({}, "", `/profile/${userId}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export type VideoRecord = {
  id: number;
  title: string;
  description: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  gallery?: Array<{ url: string; width: number; height: number }>;
  mediaType: "VIDEO" | "IMAGE" | "TEXT";
  kind: VideoKind;
  durationSeconds: number;
  width: number;
  height: number;
  sources: VideoSource[];
  hlsMasterUrl?: string | null;
  processingStatus?: "PENDING" | "PROCESSING" | "READY" | "FAILED";
  createdAt: Date | string;
  viewCount: number;
  reactionCount: number;
  commentCount: number;
  shareCount: number;
  viewerReacted: boolean;
  viewerReaction?: ReactionType | null;
  viewerShared: boolean;
  bookmarkCount: number;
  viewerBookmarked: boolean;
  /** JHILIK Ads — set when the video is a campaign deliverable (Sponsored badge). */
  campaignId: number | null;
  owner: {
    id: number;
    name: string | null;
    username: string | null;
    photoUrl: string | null;
    accountType: "member" | "creator" | "company";
    isVerified: boolean;
  };
};

/**
 * JHILIK Ads — subtle "Sponsored" pill (FB-style) shown on any video that is
 * a campaign deliverable (video.campaignId != null). Rendered on every
 * content surface: feed card, Shorts fullscreen player, text posts,
 * profile grid, and search — never when campaignId is null.
 */
export function SponsoredBadge({
  tile = false,
  dark = false,
}: {
  tile?: boolean;
  dark?: boolean;
}) {
  return (
    <span
      className={`sponsored-badge${tile ? " sponsored-badge--tile" : ""}${dark ? " sponsored-badge--dark" : ""}`}
      aria-label="Sponsored content"
    >
      Sponsored
    </span>
  );
}
type FeedAttachment = {
  id: number;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  sortOrder: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};
type Engagement = {
  reactionCount: number;
  shareCount: number;
  commentCount: number;
  viewerReacted: boolean;
  viewerReaction: ReactionType | null;
  viewerShared: boolean;
};
type ImageSelection = { file: File; previewUrl: string };
type AnnouncementVideoSelection = {
  file: File;
  previewUrl: string;
  metadata: VideoMetadata;
};

const tabOptions: { id: HomeTab; label: string; caption: string }[] = [
  { id: "videos", label: "Videos", caption: "Latest main-feed videos" },
  {
    id: "spotlight",
    label: "Spotlight",
    caption: "Global photo and video spotlight",
  },
  { id: "trendy", label: "Trendy", caption: "Most reacted-to videos" },
  {
    id: "following",
    label: "Following",
    caption: "Videos from people you follow",
  },
  {
    id: "icons",
    label: "ICONS",
    caption: "Verified creator and company videos",
  },
];

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes
    ? `${minutes}:${String(remainder).padStart(2, "0")}`
    : `${seconds}s`;
}
function formatCount(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
const SHORTS_MUTE_STORAGE_KEY = "kinba.shorts.muted";
function readShortsMutePreference() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SHORTS_MUTE_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}
function writeShortsMutePreference(muted: boolean) {
  try {
    window.localStorage.setItem(SHORTS_MUTE_STORAGE_KEY, String(muted));
  } catch {
    // Storage may be disabled; playback should still work in memory.
  }
}
function relativeTime(value: Date | string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  );
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString();
}
function displayName(
  name: string | null | undefined,
  username?: string | null,
  fallback = "JHILIK member"
) {
  const cleanName = name?.trim();
  if (cleanName && !cleanName.includes("@")) return cleanName;
  const cleanUsername = username?.trim();
  if (cleanUsername) return `@${cleanUsername}`;
  return fallback;
}
function ownerHandle(name: string | null, username?: string | null) {
  const source = name?.includes("@") ? username : name;
  return `@${
    (source ?? "jhilik_creator")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "jhilik_creator"
  }`;
}
function hashtagsFromDescription(description: string) {
  const tags = description.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  return tags.slice(0, 3).join(" ") || "#jhilik";
}
function isReportedLegacyMedia(
  video: Pick<VideoRecord, "title" | "description">
) {
  const copy = `${video.title} ${video.description}`
    .toLowerCase()
    .replace(/\s+/g, " ");
  return copy.includes("hey, well-connected") && copy.includes("platform");
}

type SpotlightHighlight = {
  id: string;
  sourceType: "video" | "post";
  postId: number;
  createdAt: string;
  title: string;
  caption: string;
  mediaType: "VIDEO" | "IMAGE" | "TEXT";
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  score: number;
  likes: number;
  comments: number;
  shares: number;
  author: {
    id: number;
    name: string | null;
    username: string | null;
    photoUrl: string | null;
  };
};

function SpotlightHighlights({
  onSelect,
}: {
  onSelect: (highlight: SpotlightHighlight) => void;
}) {
  const [highlights, setHighlights] = useState<SpotlightHighlight[]>([]);
  const [photoViewer, setPhotoViewer] = useState<SpotlightHighlight | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void fetch(apiUrl("/api/spotlight/highlights"), { credentials: "include" })
      .then(response => {
        if (!response.ok)
          throw new Error(`Highlights request failed: ${response.status}`);
        return response.json() as Promise<{
          highlights?: SpotlightHighlight[];
        }>;
      })
      .then(payload => {
        if (!cancelled)
          setHighlights(
            Array.isArray(payload.highlights) ? payload.highlights : []
          );
      })
      .catch(error => {
        console.warn("[Spotlight] Highlights unavailable:", error);
        if (!cancelled) setHighlights([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (loading || highlights.length === 0) return null;
  return (
    <section
      className="spotlight-highlights"
      aria-label="Top Content Highlights"
    >
      <div className="spotlight-highlights__heading">
        <div>
          <span className="eyebrow">Spotlight</span>
          <h2>Top Content Highlights</h2>
        </div>
        <span>Last 48 hours</span>
      </div>
      <div className="spotlight-highlights__rail">
        {highlights.map(highlight => (
          <button
            key={highlight.id}
            type="button"
            className="spotlight-highlight-card"
            onClick={() =>
              highlight.mediaType === "IMAGE"
                ? setPhotoViewer(highlight)
                : onSelect(highlight)
            }
          >
            <div className="spotlight-highlight-card__media">
              {highlight.mediaUrl ? (
                highlight.mediaType === "VIDEO" ? (
                  highlight.thumbnailUrl ? (
                    <img
                      src={resolveMediaUrl(highlight.thumbnailUrl)}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <video
                      src={resolveMediaUrl(highlight.mediaUrl)}
                      muted
                      playsInline
                      {...({ "webkit-playsinline": "true" } as Record<
                        string,
                        string
                      >)}
                      preload="metadata"
                      crossOrigin="anonymous"
                      aria-label="Highlighted video"
                    />
                  )
                ) : (
                  <img
                    src={resolveMediaUrl(highlight.mediaUrl)}
                    alt=""
                    loading="lazy"
                    className="object-contain w-full h-auto max-h-[60vh] bg-black"
                  />
                )
              ) : (
                <div className="spotlight-highlight-card__text">
                  {highlight.caption.slice(0, 120)}
                </div>
              )}
            </div>
            <a
              className="spotlight-highlight-card__author profile-link"
              href={`/profile/${highlight.author.id}`}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                window.history.pushState(
                  {},
                  "",
                  `/profile/${highlight.author.id}`
                );
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
            >
              {highlight.author.photoUrl ? (
                <img
                  src={resolveMediaUrl(highlight.author.photoUrl, "avatars")}
                  alt=""
                />
              ) : (
                <UserRound size={14} />
              )}
              {displayName(highlight.author.name, highlight.author.username)}
            </a>
            <strong>{highlight.title || highlight.caption.slice(0, 80)}</strong>
            <span className="spotlight-highlight-card__metrics">
              ♥ {highlight.likes} · comments {highlight.comments} · shares{" "}
              {highlight.shares}
            </span>
          </button>
        ))}
      </div>
      {photoViewer && (
        <FeedPhotoLightbox
          imageUrl={photoViewer.mediaUrl}
          alt={photoViewer.title || "Spotlight photo"}
          owner={photoViewer.author}
          onClose={() => setPhotoViewer(null)}
        />
      )}
    </section>
  );
}

function notifyError(error: unknown) {
  toast.error(
    error instanceof Error
      ? error.message
      : "The operation could not be completed."
  );
}
function formatAudioTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function useVoiceCommentRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const start = async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    )
      throw new Error("Voice recording is not supported on this device.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeCandidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
    ];
    const mimeType = mimeCandidates.find(type =>
      MediaRecorder.isTypeSupported(type)
    );
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    chunksRef.current = [];
    streamRef.current = stream;
    recorderRef.current = recorder;
    setElapsed(0);
    setAudioBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    recorder.ondataavailable = event => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const recordedType = (recorder.mimeType || "audio/webm")
        .toLowerCase()
        .split(";", 1)[0];
      const acceptedType = [
        "audio/webm",
        "audio/ogg",
        "audio/mp4",
        "audio/mpeg",
        "audio/wav",
      ].includes(recordedType)
        ? recordedType
        : "audio/webm";
      const blob = new Blob(chunksRef.current, { type: acceptedType });
      if (blob.size) {
        setAudioBlob(blob);
        setPreviewUrl(URL.createObjectURL(blob));
      }
      chunksRef.current = [];
      setRecording(false);
    };
    recorder.start();
    setRecording(true);
  };
  const stop = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setElapsed(value => {
        if (value >= 59) {
          window.setTimeout(stop, 0);
          return 60;
        }
        return value + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);
  const discard = () => {
    stop();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setAudioBlob(null);
    setElapsed(0);
  };
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );
  return { recording, elapsed, audioBlob, previewUrl, start, stop, discard };
}

const COMMENT_WAVE_BARS = 32;
const COMMENT_AUDIO_SPEEDS = [1, 1.5, 2] as const;

/** Stable pseudo-random bar heights per recording (no audio analysis needed). */
function commentWaveform(seed: string, count = COMMENT_WAVE_BARS): number[] {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  const bars: number[] = [];
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const base = 0.3 + (state / 0xffffffff) * 0.7;
    // Taper the ends so the bars read like a real voice note.
    const edge = Math.min(1, 0.55 + (Math.min(index, count - 1 - index) / 4) * 0.45);
    bars.push(Math.max(0.22, Math.min(1, base * edge)));
  }
  return bars;
}

function CommentAudioPlayer({
  src,
  duration,
}: {
  src: string;
  duration?: number | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const bars = useMemo(() => commentWaveform(src), [src]);
  const mediaDuration = audioRef.current?.duration;
  const total = Math.max(
    typeof mediaDuration === "number" &&
      Number.isFinite(mediaDuration) &&
      mediaDuration > 0
      ? mediaDuration
      : (duration ?? 1),
    1
  );
  const progress = Math.min(1, Math.max(0, current / total));
  const speed = COMMENT_AUDIO_SPEEDS[speedIndex] ?? 1;
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };
  const seekTo = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Math.min(Math.max(seconds, 0), total);
    audio.currentTime = next;
    setCurrent(next);
  };
  const cycleSpeed = () => {
    const next = (speedIndex + 1) % COMMENT_AUDIO_SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = COMMENT_AUDIO_SPEEDS[next] ?? 1;
    }
  };
  return (
    <div className={`comment-audio-player${playing ? " is-playing" : ""}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={event => setCurrent(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
      />
      <button
        type="button"
        className="comment-audio-play"
        onClick={toggle}
        aria-label={playing ? "Pause voice comment" : "Play voice comment"}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div
        className="comment-audio-wave"
        role="slider"
        tabIndex={0}
        aria-label="Voice comment position"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(current)}
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          seekTo(((event.clientX - rect.left) / rect.width) * total);
        }}
        onKeyDown={event => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            seekTo(current + 5);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            seekTo(current - 5);
          }
        }}
      >
        {bars.map((height, index) => (
          <span
            key={index}
            className={index / bars.length < progress ? "is-played" : undefined}
            style={{ height: `${Math.round(height * 100)}%` }}
          />
        ))}
      </div>
      <span className="comment-audio-time">
        {formatAudioTime(current)} /{" "}
        {formatAudioTime(duration ?? audioRef.current?.duration ?? 0)}
      </span>
      <button
        type="button"
        className="comment-audio-speed"
        onClick={cycleSpeed}
        aria-label={`Playback speed ${speed}x, tap to change`}
      >
        {speed}×
      </button>
    </div>
  );
}

function VoiceCommentComposer({
  body,
  onBodyChange,
  onSend,
  disabled,
  inputRef,
  placeholder,
  onInputChange,
  onInputKeyDown,
}: {
  body: string;
  onBodyChange: (value: string) => void;
  onSend: (
    audioUrl: string | null,
    audioDuration: number | null
  ) => Promise<void>;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  placeholder: string;
  /** Reports the live caret position for cursor-aware mention insertion. */
  onInputChange?: (value: string, cursor: number) => void;
  onInputKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}) {
  const recorder = useVoiceCommentRecorder();
  const [uploading, setUploading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || uploading || (!body.trim() && !recorder.audioBlob)) return;
    setUploading(true);
    try {
      const audioUrl = recorder.audioBlob
        ? await uploadCommentAudio(recorder.audioBlob)
        : null;
      await onSend(
        audioUrl,
        recorder.audioBlob ? Math.max(1, recorder.elapsed) : null
      );
      recorder.discard();
      onBodyChange("");
    } catch (error) {
      notifyError(error);
    } finally {
      setUploading(false);
    }
  };
  return (
    <form onSubmit={submit} className="comment-form voice-comment-form">
      <input
        ref={inputRef}
        value={body}
        onChange={event => {
          onBodyChange(event.target.value);
          onInputChange?.(
            event.target.value,
            event.target.selectionStart ?? event.target.value.length
          );
        }}
        onSelect={event => {
          const target = event.currentTarget;
          onInputChange?.(
            target.value,
            target.selectionStart ?? target.value.length
          );
        }}
        onKeyDown={event => onInputKeyDown?.(event)}
        maxLength={500}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={disabled || recorder.recording || uploading}
      />
      {recorder.recording ? (
        <button
          type="button"
          className="voice-recording-button is-recording"
          onClick={recorder.stop}
          aria-label="Stop recording"
        >
          <Square size={16} /> {formatAudioTime(recorder.elapsed)} / 1:00
        </button>
      ) : recorder.audioBlob && recorder.previewUrl ? (
        <div className="voice-comment-preview">
          <audio src={recorder.previewUrl} controls preload="metadata" />
          <button
            type="button"
            onClick={recorder.discard}
            aria-label="Delete and re-record"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="voice-record-button"
          onClick={() => recorder.start().catch(notifyError)}
          disabled={disabled || uploading}
          aria-label="Record voice comment"
        >
          <Mic size={18} />
        </button>
      )}
      <button
        type="submit"
        className="primary-btn voice-send-button"
        disabled={
          disabled || uploading || (!body.trim() && !recorder.audioBlob)
        }
      >
        {uploading ? (
          <Loader2 className="spin" size={16} />
        ) : (
          <Send size={16} />
        )}{" "}
        {uploading ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

function useOptimisticEngagement(video: VideoRecord) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const reaction = useVideoReaction(video, { onError: notifyError });
  const [shareOverride, setShareOverride] = useState<{
    shareCount: number;
    viewerShared: boolean;
  } | null>(null);
  const [sharePending, setSharePending] = useState(false);
  const shareMutation = trpc.videos.share.useMutation();
  const current: Engagement = {
    reactionCount: reaction.state.reactionCount,
    shareCount: shareOverride?.shareCount ?? video.shareCount,
    commentCount: video.commentCount,
    viewerReacted: reaction.state.viewerReacted,
    viewerReaction: reaction.state.viewerReaction,
    viewerShared: shareOverride?.viewerShared ?? video.viewerShared,
  };
  const share = async () => {
    if (!auth.isAuthenticated) return auth.openAuth();
    try {
      const url = `${window.location.origin}/videos/${video.id}`;
      if (navigator.share)
        await navigator.share({
          title: video.title,
          text: video.description,
          url,
        });
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast.success("Video link copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notifyError(error);
      return;
    }
    const previous = current;
    const previousOverride = shareOverride;
    setShareOverride({
      viewerShared: true,
      shareCount: previous.shareCount + (previous.viewerShared ? 0 : 1),
    });
    setSharePending(true);
    try {
      const response = await shareMutation.mutateAsync({ videoId: video.id });
      setShareOverride({
        shareCount: response.shareCount,
        viewerShared: response.viewerShared,
      });
      await utils.home.feed.invalidate();
      await utils.videos.list.invalidate();
    } catch (error) {
      setShareOverride(previousOverride);
      notifyError(error);
    } finally {
      setSharePending(false);
    }
  };
  const pending: "react" | "share" | null = reaction.pending
    ? "react"
    : sharePending
      ? "share"
      : null;
  return {
    current,
    react: reaction.react,
    selectReaction: reaction.select,
    share,
    pending,
  };
}

function QualityVideoPlayer({
  video,
  vertical = false,
  active = true,
  showPoster = true,
  preload = "none",
  muted: mutedProp,
  onMutedChange,
  onFirstPlay,
}: {
  video: VideoRecord;
  vertical?: boolean;
  active?: boolean;
  showPoster?: boolean;
  preload?: "none" | "metadata" | "auto";
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  onFirstPlay?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [muted, setMuted] = useState(mutedProp ?? true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [showTapIcon, setShowTapIcon] = useState(false);
  const tapIconTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionRef = useRef(0);
  const resumeRef = useRef(false);
  const viewedRef = useRef(false);
  const sourceMap = useMemo(
    () =>
      new Map(
        (Array.isArray(video.sources) ? video.sources : []).map(source => [
          source.quality,
          source.videoUrl,
        ])
      ),
    [video.sources]
  );
  // Prefer a persisted direct media file. Android WebView cannot render an HLS
  // manifest as a normal video source when MediaSource support is unavailable.
  const directSourceUrl = resolvePlaybackUrl(video.videoUrl);
  const originalSourceUrl = resolvePlaybackUrl(sourceMap.get("ORIGINAL"));
  const hlsMasterSourceUrl = resolvePlaybackUrl(video.hlsMasterUrl);
  const sourceUrl =
    directSourceUrl && !isHlsMediaUrl(directSourceUrl)
      ? directSourceUrl
      : originalSourceUrl || hlsMasterSourceUrl || directSourceUrl;
  const posterUrl =
    resolveMediaUrl(video.thumbnailUrl) ?? `/api/videos/${video.id}/thumbnail`;

  const shouldPlay = active && isInView;

  useEffect(() => {
    if (mutedProp !== undefined) setMuted(mutedProp);
  }, [mutedProp]);

  const togglePlay = () => {
    const element = ref.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  };

  const handleVideoTap = (event: React.MouseEvent<HTMLVideoElement>) => {
    if (event.defaultPrevented) return;
    togglePlay();
    setShowTapIcon(true);
    if (tapIconTimer.current) clearTimeout(tapIconTimer.current);
    tapIconTimer.current = setTimeout(() => setShowTapIcon(false), 800);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        const visible = Boolean(entry?.isIntersecting);
        setIsNearViewport(visible);
        setIsInView(Boolean(visible && entry.intersectionRatio >= 0.7));
      },
      { rootMargin: "240px 0px", threshold: [0, 0.7] }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (!sourceUrl) {
      setIsLoading(false);
      setPlaybackError("This video has no playable source.");
      return;
    }
    setIsLoading(true);
    setPlaybackError(null);
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (!isNearViewport) {
      element.pause();
      element.removeAttribute("src");
      element.load();
      return;
    }
    if (shouldUseHlsJs(element, sourceUrl, Hls.isSupported())) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        logPlaybackEvent("hls-error", element, sourceUrl, {
          videoId: video.id,
          fatal: data.fatal,
          type: data.type,
          details: data.details,
        });
        if (data.fatal) {
          setIsLoading(false);
          setPlaybackError(describePlaybackFailure(element, sourceUrl).message);
        }
      });
      hls.loadSource(sourceUrl);
      hls.attachMedia(element);
    } else {
      element.src = sourceUrl;
      element.load();
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [sourceUrl, isNearViewport, video.id]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !sourceUrl || !isNearViewport) return;
    return attachPlaybackDiagnostics(element, sourceUrl, video.id);
  }, [sourceUrl, isNearViewport, video.id]);

  const restorePlayback = () => {
    const element = ref.current;
    if (!element) return;
    element.currentTime = Math.min(
      positionRef.current,
      Number.isFinite(element.duration) ? element.duration : positionRef.current
    );
    if (resumeRef.current && shouldPlay)
      void element.play().catch(() => undefined);
  };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!shouldPlay) {
      resumeRef.current = !element.paused;
      element.pause();
      positionRef.current = element.currentTime;
    } else {
      void element.play().catch(() => undefined);
    }
  }, [shouldPlay]);

  useEffect(() => {
    return () => {
      if (tapIconTimer.current) clearTimeout(tapIconTimer.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={
        vertical
          ? "media-video-frame media-video-frame--short w-full h-full object-contain"
          : "media-video-frame media-video-frame--square w-full"
      }
    >
      <video
        src={isNearViewport ? sourceUrl : undefined}
        poster={showPoster ? posterUrl : undefined}
        className={`w-full h-full ${vertical ? "object-contain" : "object-contain"}`}
        ref={ref}
        {...({ "webkit-playsinline": "true" } as Record<string, string>)}
        controls={false}
        loop
        controlsList="nofullscreen noplaybackrate"
        disablePictureInPicture
        playsInline
        preload={isNearViewport ? (active ? "auto" : preload) : "none"}
        autoPlay={active && isInView}
        muted={muted}
        onLoadedMetadata={restorePlayback}
        onClick={handleVideoTap}
        onError={() => {
          const element = ref.current;
          if (element && directSourceUrl && sourceUrl !== directSourceUrl) {
            element.src = directSourceUrl;
            element.load();
            setIsLoading(true);
            setPlaybackError(null);
            return;
          }
          setIsLoading(false);
          setPlaybackError(describePlaybackFailure(element, sourceUrl).message);
        }}
        onLoadedData={() => setIsLoading(false)}
        onCanPlay={() => setIsLoading(false)}
        onPlay={() => {
          setIsLoading(false);
          setPlaying(true);
          if (!viewedRef.current) {
            viewedRef.current = true;
            onFirstPlay?.();
          }
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => {
          const el = ref.current;
          if (el) setCurrentTime(el.currentTime);
        }}
      />
      {vertical && isLoading && !playbackError && (
        <div className="shorts-playback-state shorts-playback-state--loading" role="status">
          <Loader2 className="spin" size={22} aria-hidden="true" />
          <span>Loading Short…</span>
        </div>
      )}
      {showTapIcon && (
        <div className="media-video-tap-indicator" aria-hidden="true">
          {playing ? <Pause size={32} /> : <Play size={32} />}
        </div>
      )}
      {vertical && !playbackError && (
        <div
          className="shorts-progress"
          role="progressbar"
          aria-label="Short progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            video.durationSeconds > 0
              ? Math.min(100, Math.round((currentTime / video.durationSeconds) * 100))
              : 0
          }
        >
          <span
            style={{
              width: `${
                video.durationSeconds > 0
                  ? Math.min(100, (currentTime / video.durationSeconds) * 100)
                  : 0
              }%`,
            }}
          />
        </div>
      )}
      <div className="media-video-controls" data-short-no-swipe>
        <div className="media-video-timeline">
          <span className="media-video-time">{formatDuration(Math.floor(currentTime))}</span>
          <input
            type="range"
            min={0}
            max={video.durationSeconds || 0}
            step={0.1}
            value={currentTime}
            onChange={event => {
              const el = ref.current;
              if (!el) return;
              const time = Number(event.target.value);
              el.currentTime = time;
              setCurrentTime(time);
            }}
            aria-label="Video timeline"
          />
          <span className="media-video-time">{formatDuration(video.durationSeconds)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className="media-video-skip-btn"
            onClick={() => {
              const el = ref.current;
              if (!el) return;
              el.currentTime = Math.max(0, el.currentTime - 5);
            }}
            aria-label="Rewind 5 seconds"
          >
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              const element = ref.current;
              if (!element) return;
              if (element.paused) void element.play();
              else element.pause();
            }}
            aria-label={playing ? "Pause video" : "Play video"}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            type="button"
            className="media-video-skip-btn"
            onClick={() => {
              const el = ref.current;
              if (!el) return;
              el.currentTime = Math.min(el.duration || 0, el.currentTime + 5);
            }}
            aria-label="Forward 5 seconds"
          >
            <SkipForward size={14} />
          </button>
          <button
            type="button"
            onClick={() =>
              setMuted(value => {
                const next = !value;
                onMutedChange?.(next);
                return next;
              })
            }
            aria-label={muted ? "Unmute video" : "Mute video"}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>
      {playbackError && !vertical && (
        <p
          className="media-processing-status media-processing-status--error"
          role="alert"
        >
          {playbackError}
        </p>
      )}
      {vertical && playbackError && (
        <div className="shorts-playback-state shorts-playback-state--error" role="alert">
          <p>{playbackError}</p>
          <button
            type="button"
            data-short-no-swipe
            onClick={event => {
              event.stopPropagation();
              setPlaybackError(null);
              setIsLoading(true);
              const element = ref.current;
              if (hlsRef.current) {
                hlsRef.current.startLoad(-1);
                hlsRef.current.recoverMediaError();
              } else {
                element?.load();
              }
            }}
          >
            <RotateCcw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   ForYouVideoPlayer — Dedicated player for the For You feed.

   Uses class "for-you-video-frame" (NOT "media-video-frame") so it
   is never targeted by the feedUi.css specificity cascade that forces
   height:0 / aspect-ratio:auto on .media-video-frame in feed context.

   Inline style={{ aspectRatio }} from video.width/video.height gives
   the frame deterministic non-zero height on mount, breaking the
   chicken-and-egg: frame visible → IntersectionObserver fires →
   preload="metadata" → metadata loads → video uses real intrinsic dims.
    ------------------------------------------------------------------ */

function InlineVideoPlayer({
  video,
  active = true,
  onFirstPlay,
  autoplayOnVisible = false,
}: {
  video: VideoRecord;
  active?: boolean;
  onFirstPlay?: () => void;
  /** When true, play muted once ≥50% visible and pause when scrolled away. */
  autoplayOnVisible?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const hlsRef = useRef<Hls | null>(null);
  const viewedRef = useRef(false);
  // Autoplay bookkeeping: never override an explicit user pause.
  const userPausedRef = useRef(false);
  const [inAutoplayView, setInAutoplayView] = useState(false);
  const [autoPlayBadge, setAutoPlayBadge] = useState(false);

  const sourceMap = useMemo(
    () =>
      new Map(
        (Array.isArray(video.sources) ? video.sources : []).map(s => [
          s.quality,
          s.videoUrl,
        ])
      ),
    [video.sources]
  );
  const directUrl = resolvePlaybackUrl(video.videoUrl);
  const originalUrl = resolvePlaybackUrl(sourceMap.get("ORIGINAL"));
  const hlsMasterUrl = resolvePlaybackUrl(video.hlsMasterUrl);
  const sourceUrl =
    directUrl && !isHlsMediaUrl(directUrl)
      ? directUrl
      : originalUrl || hlsMasterUrl || directUrl;

  const w = video.width || 16;
  const h = video.height || 9;
  const [displayDims, setDisplayDims] = useState<{ w: number; h: number } | null>(null);
  const displayW = displayDims?.w ?? w;
  const displayH = displayDims?.h ?? h;

  const [isNearViewport, setIsNearViewport] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || isNearViewport) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isNearViewport]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !sourceUrl || !isNearViewport) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (shouldUseHlsJs(el, sourceUrl, Hls.isSupported())) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        logPlaybackEvent("hls-error", el, sourceUrl, {
          videoId: video.id,
          fatal: data.fatal,
          type: data.type,
          details: data.details,
        });
        if (data.fatal) setError("The video stream failed. Please try again.");
      });
      hls.loadSource(sourceUrl);
      hls.attachMedia(el);
    } else {
      el.src = sourceUrl;
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [sourceUrl, isNearViewport, video.id]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !sourceUrl || !isNearViewport) return;
    return attachPlaybackDiagnostics(element, sourceUrl, video.id);
  }, [sourceUrl, isNearViewport, video.id]);

  const handleLoadedMetadata = () => {
    const el = videoRef.current;
    if (el && el.videoWidth && el.videoHeight) {
      if (el.videoWidth !== w || el.videoHeight !== h) {
        console.warn(`[FeedVideo] Dimension mismatch video=${video.id}: DB=${w}x${h} actual=${el.videoWidth}x${el.videoHeight}`);
        setDisplayDims({ w: el.videoWidth, h: el.videoHeight });
      }
    }
  };

  const togglePlay = (e: React.MouseEvent) => {
    console.log("[KINBA DIAGNOSTIC] InlineVideoPlayer.togglePlay FIRED", { videoId: video.id, hasStopProp: true, timestamp: Date.now() });
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      userPausedRef.current = false;
      setAutoPlayBadge(false);
      el.play().catch(() => undefined);
    } else {
      userPausedRef.current = true;
      setAutoPlayBadge(false);
      el.pause();
    }
  };

  // Muted autoplay: play once at least half the player is on screen, pause
  // when it scrolls away. A manual pause always wins over autoplay.
  useEffect(() => {
    if (!autoplayOnVisible) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInAutoplayView(entry.isIntersecting),
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoplayOnVisible]);

  useEffect(() => {
    if (!autoplayOnVisible || !isNearViewport) return;
    const el = videoRef.current;
    if (!el) return;
    if (!inAutoplayView) {
      if (!el.paused) {
        el.pause();
        setAutoPlayBadge(false);
      }
      return;
    }
    if (userPausedRef.current || !el.paused) return;
    const tryPlay = () => {
      if (userPausedRef.current || !el.paused) return;
      el.play()
        .then(() => setAutoPlayBadge(true))
        .catch(() => undefined);
    };
    if (el.readyState >= 1) {
      tryPlay();
      return;
    }
    el.addEventListener("canplay", tryPlay, { once: true });
    return () => el.removeEventListener("canplay", tryPlay);
  }, [autoplayOnVisible, inAutoplayView, isNearViewport]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${displayW} / ${displayH}`,
        background: "var(--page-bg)",
        overflow: "hidden",
        borderRadius: 0,
        contain: "size layout paint style",
      }}
      onClick={togglePlay}
    >
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        preload={isNearViewport ? "metadata" : "none"}
        onPlay={() => {
          setPlaying(true);
          if (!viewedRef.current) {
            viewedRef.current = true;
            onFirstPlay?.();
          }
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() =>
          setError(describePlaybackFailure(videoRef.current, sourceUrl).message)
        }
        onLoadedMetadata={handleLoadedMetadata}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "var(--page-bg)",
        }}
      />
      {autoPlayBadge && playing && !error && (
        <div className="k-autoplay-badge" aria-hidden="true">
          <span className="k-autoplay-eq">
            <i />
            <i />
            <i />
          </span>
          Autoplay · muted
        </div>
      )}
      {!playing && !error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Play size={24} color="#fff" />
          </div>
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--page-bg)",
            color: "#aaa",
            fontSize: "0.82rem",
            textAlign: "center",
            padding: 16,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function ForYouVideoPlayer({
  video,
  active = true,
  onFirstPlay,
}: {
  video: VideoRecord;
  active?: boolean;
  onFirstPlay?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const viewedRef = useRef(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [displayDims, setDisplayDims] = useState<{ w: number; h: number } | null>(null);

  const sourceMap = useMemo(
    () =>
      new Map(
        (Array.isArray(video.sources) ? video.sources : []).map(s => [
          s.quality,
          s.videoUrl,
        ])
      ),
    [video.sources]
  );

  const directUrl = resolvePlaybackUrl(video.videoUrl);
  const originalUrl = resolvePlaybackUrl(sourceMap.get("ORIGINAL"));
  const hlsMasterUrl = resolvePlaybackUrl(video.hlsMasterUrl);
  const sourceUrl =
    directUrl && !isHlsMediaUrl(directUrl)
      ? directUrl
      : originalUrl || hlsMasterUrl || directUrl;

  const posterUrl =
    resolveMediaUrl(video.thumbnailUrl) ?? `/api/videos/${video.id}/thumbnail`;

  const w = video.width || 16;
  const h = video.height || 9;
  const displayW = displayDims?.w ?? w;
  const displayH = displayDims?.h ?? h;

  /* IntersectionObserver — viewport tracking */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        const visible = Boolean(entry?.isIntersecting);
        setIsNearViewport(visible);
        setIsInView(Boolean(visible && entry.intersectionRatio >= 0.7));
      },
      { rootMargin: "240px 0px", threshold: [0, 0.7] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* Source loader — attach video source when URL or viewport changes */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!sourceUrl) {
      setError("No playable source available.");
      return;
    }
    setError(null);
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (!isNearViewport) {
      el.pause();
      el.removeAttribute("src");
      el.load();
      return;
    }
    if (shouldUseHlsJs(el, sourceUrl, Hls.isSupported())) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        logPlaybackEvent("hls-error", el, sourceUrl, {
          videoId: video.id,
          fatal: data.fatal,
          type: data.type,
          details: data.details,
        });
        if (data.fatal) setError("The video stream failed. Please try again.");
      });
      hls.loadSource(sourceUrl);
      hls.attachMedia(el);
    } else {
      el.src = sourceUrl;
      el.load();
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [sourceUrl, isNearViewport, video.id]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !sourceUrl || !isNearViewport) return;
    return attachPlaybackDiagnostics(element, sourceUrl, video.id);
  }, [sourceUrl, isNearViewport, video.id]);

  /* Auto-play/pause based on viewport */
  const shouldAutoPlay = active && isInView;
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!shouldAutoPlay) {
      el.pause();
    } else {
      el.play().catch(() => undefined);
    }
  }, [shouldAutoPlay]);

  const handleLoadedMetadata = () => {
    const el = videoRef.current;
    if (el && el.videoWidth && el.videoHeight) {
      if (el.videoWidth !== w || el.videoHeight !== h) {
        console.warn(`[FeedVideo] Dimension mismatch video=${video.id}: DB=${w}x${h} actual=${el.videoWidth}x${el.videoHeight}`);
        setDisplayDims({ w: el.videoWidth, h: el.videoHeight });
      }
    }
  };

  const togglePlay = () => {
    console.log("[KINBA DIAGNOSTIC] ForYouVideoPlayer.togglePlay FIRED", { videoId: video.id, hasStopProp: false, timestamp: Date.now() });
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  };

  const flashOverlay = () => {
    setShowOverlay(true);
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => setShowOverlay(false), 2500);
  };

  useEffect(
    () => () => {
      if (overlayTimer.current) clearTimeout(overlayTimer.current);
    },
    []
  );

  return (
    <div
      ref={containerRef}
      className="for-you-video-frame"
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${displayW} / ${displayH}`,
        background: "var(--page-bg)",
        overflow: "hidden",
        contain: "size layout paint style",
      }}
      onClick={togglePlay}
      onPointerDown={flashOverlay}
    >
      <video
        ref={videoRef}
        src={isNearViewport ? sourceUrl : undefined}
        poster={posterUrl}
        muted={muted}
        loop
        playsInline
        preload={isNearViewport ? "metadata" : "none"}
        onPlay={() => {
          setPlaying(true);
          if (!viewedRef.current) {
            viewedRef.current = true;
            onFirstPlay?.();
          }
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() =>
          setError(describePlaybackFailure(videoRef.current, sourceUrl).message)
        }
        onLoadedMetadata={handleLoadedMetadata}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "var(--page-bg)",
        }}
      />
      {!playing && !error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Play size={24} color="#fff" />
          </div>
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--page-bg)",
            color: "#aaa",
            fontSize: "0.82rem",
            textAlign: "center",
            padding: 16,
          }}
        >
          {error}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          display: "flex",
          gap: 6,
          opacity: showOverlay ? 1 : 0,
          transition: "opacity 0.2s",
          pointerEvents: showOverlay ? "auto" : "none",
        }}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "none",
            background: "rgba(0,0,0,0.6)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          onClick={() => setMuted(v => !v)}
          aria-label={muted ? "Unmute" : "Mute"}
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "none",
            background: "rgba(0,0,0,0.6)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>
    </div>
  );
}

function EngagementActions({
  engagement,
  videoId,
  onReact,
  onShare,
  onComments,
  pending,
  overlay = false,
  feedStyle = false,
  bookmarked = false,
  onBookmark,
  owner,
  shorts = false,
}: {
  engagement: Engagement;
  videoId?: number;
  onReact: () => void;
  onShare: () => void;
  onComments: () => void;
  pending: "react" | "share" | null;
  overlay?: boolean;
  feedStyle?: boolean;
  bookmarked?: boolean;
  onBookmark?: () => void;
  owner?: VideoRecord["owner"];
  shorts?: boolean;
}) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const [reactorsOpen, setReactorsOpen] = useState(false);
  // Single reaction (Pookie/Love): a tap toggles it; a long-press opens the
  // reactor list instead of a multi-option picker.
  const longPress = useLongPress({
    enabled: Boolean(videoId),
    onLongPress: () => setReactorsOpen(true),
  });
  const followState = trpc.profile.followState.useQuery(
    { userId: owner?.id ?? 0 },
    {
      enabled: Boolean(
        owner && auth.isAuthenticated && auth.user?.id !== owner.id
      ),
      refetchOnWindowFocus: false,
    }
  );
  const toggleFollow = trpc.profile.toggleFollow.useMutation();
  const isOwnVideo = Boolean(owner && auth.user?.id === owner.id);
  const following = followState.data?.following ?? false;
  const followOwner = async () => {
    if (!owner || isOwnVideo) return;
    if (!auth.isAuthenticated) return auth.openAuth();
    try {
      await toggleFollow.mutateAsync({ userId: owner.id });
      await Promise.all([
        followState.refetch(),
        utils.home.feed.invalidate(),
        utils.videos.list.invalidate(),
      ]);
    } catch (error) {
      notifyError(error);
    }
  };
  return (
    <div
      className={`media-engagement-actions${overlay ? " media-engagement-actions--overlay absolute right-3 bottom-16 z-20 flex flex-col items-center gap-4" : ""}${feedStyle ? " feed-action-bar flex flex-row justify-around mt-3 pb-3" : ""}`}
    >
      {overlay && !shorts && owner && !isOwnVideo && (
        <button
          type="button"
          className={`creator-follow-action${following ? " is-following" : ""}`}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            void followOwner();
          }}
          disabled={toggleFollow.isPending}
          aria-label={following ? "Unfollow creator" : "Follow creator"}
          aria-pressed={following}
        >
          <span className="creator-follow-avatar">
            {owner.photoUrl ? (
              <img src={resolveMediaUrl(owner.photoUrl, "avatars")} alt="" />
            ) : (
              <UserRound size={18} />
            )}
          </span>
          <span className="creator-follow-badge" aria-hidden="true">
            {following ? <Check size={14} /> : <Plus size={14} />}
          </span>
          <span>{following ? "Following" : "Follow"}</span>
        </button>
      )}
      <button
        type="button"
        className={`media-engagement-actions__pookie${engagement.viewerReacted ? " is-active" : ""}`}
        {...longPress}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onReact();
        }}
        disabled={pending === "react"}
        aria-pressed={engagement.viewerReacted}
        aria-label={engagement.viewerReacted ? "Remove Pookie" : "Pookie video"}
      >
        <Heart
          size={overlay ? 27 : 16}
          fill={engagement.viewerReacted ? "currentColor" : "none"}
        />
        <span>{engagement.viewerReacted ? "Pookied" : "Pookie"}</span>
        <strong>{formatCount(engagement.reactionCount)}</strong>
      </button>
      <button
        type="button"
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onComments();
        }}
        aria-label="Open comments"
      >
        <MessageCircle size={overlay ? 27 : 16} /> <span>Comment</span>
        <strong>{formatCount(engagement.commentCount)}</strong>
      </button>
      <button
        type="button"
        className={engagement.viewerShared ? "is-active" : ""}
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onShare();
        }}
        disabled={pending === "share"}
        aria-label="Share video"
      >
        <Share2 size={overlay ? 28 : 16} />
        <span>{pending === "share" ? "Sharing" : "Share"}</span>
        <strong>{formatCount(engagement.shareCount)}</strong>
      </button>
      {onBookmark && (
        <button
          type="button"
          className={bookmarked ? "is-active" : ""}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onBookmark();
          }}
          aria-pressed={bookmarked}
          aria-label={bookmarked ? "Remove saved video" : "Save video"}
        >
          <Bookmark
            size={overlay ? 27 : 16}
            fill={bookmarked ? "currentColor" : "none"}
          />
          <span>{bookmarked ? "Saved" : "Save"}</span>
        </button>
      )}
      {videoId != null ? (
        <ReactorList
          open={reactorsOpen}
          title="Video reactions"
          source={{ kind: "video", videoId }}
          onClose={() => setReactorsOpen(false)}
        />
      ) : null}
    </div>
  );
}
/** Replies fetched per batch when a thread is expanded (Facebook-style 3–4). */
const COMMENT_REPLY_BATCH = 4;
const COMMENT_REPLY_BATCH_MAX = 50;

type CommentReactionSource = {
  reactions?: Array<{
    reaction: ConversationReactionId;
    count: number;
    reactedByMe: boolean;
  }> | null;
  likeCount?: number | null;
  viewerLiked?: boolean | null;
};

/** Backend multi-reaction rows, with the legacy binary-like fallback. */
function commentReactionEntries(
  comment: CommentReactionSource
): ConversationReactionEntry[] {
  if (comment.reactions && comment.reactions.length) {
    return comment.reactions.map(row => ({
      reaction: row.reaction,
      count: row.count,
      reactedByMe: row.reactedByMe,
    }));
  }
  return [
    {
      reaction: "love",
      count: comment.likeCount ?? 0,
      reactedByMe: Boolean(comment.viewerLiked),
    },
  ];
}

/** Root comments requested per page; "Load more" grows it by this much. */
const COMMENT_ROOT_PAGE = 20;
const COMMENT_ROOT_MAX = 200;
/** Mirrors the server's edit window (server/db.ts COMMENT_EDIT_WINDOW_MS). */
const COMMENT_EDIT_WINDOW_MS = 30 * 60 * 1000;
const COMMENT_MAX_LENGTH = 500;

type CommentSortMode = "new" | "top";

/** A text comment that is still being sent — shown instantly as "Sending…". */
type PendingComment = {
  tempId: number;
  parentId: number | null;
  body: string;
};

function CommentDrawer({
  postId,
  postOwnerId,
  open,
  onClose,
}: {
  postId: number;
  postOwnerId: number;
  open: boolean;
  onClose?: () => void;
}) {
  const auth = useAuth();
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<{
    id: number;
    username: string;
  } | null>(null);
  const [reactingId, setReactingId] = useState<number | null>(null);
  const [reactionTargetId, setReactionTargetId] = useState<number | null>(null);
  const [reactorsOpen, setReactorsOpen] = useState(false);
  // Long-press carries no React state, so recover the comment it came from
  // from the rendered row and open the reactor list for it. There is a single
  // reaction (Pookie/Love) — no multi-option tray exists anymore.
  const longPress = useLongPress({
    enabled: open,
    onLongPress: gesture => {
      const target =
        gesture.target instanceof HTMLElement ? gesture.target : null;
      const raw = target
        ?.closest("[data-comment-id]")
        ?.getAttribute("data-comment-id");
      const id = raw == null ? Number.NaN : Number(raw);
      const commentId = Number.isInteger(id) && id > 0 ? id : null;
      if (commentId == null) return;
      setReactionTargetId(commentId);
      setReactorsOpen(true);
    },
  });
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  // Active "@query" token in the composer, plus what opened the picker:
  // the @ button (search box in the picker) or typing "@" in the input.
  const [mentionToken, setMentionToken] = useState<MentionToken | null>(null);
  const [mentionSource, setMentionSource] = useState<
    "button" | "typing" | null
  >(null);
  const mentionPickerRef = useRef<MentionPickerHandle | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState<CommentSortMode>("new");
  const [rootLimit, setRootLimit] = useState(COMMENT_ROOT_PAGE);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(
    null
  );
  const [pending, setPending] = useState<PendingComment[]>([]);
  const commentsQuery = trpc.videos.comments.list.useQuery(
    { videoId: postId, sort, limit: rootLimit },
    {
      enabled: open,
      refetchOnWindowFocus: false,
      // Keep the current rows on screen while a new sort / page loads.
      placeholderData: keepPreviousData,
    }
  );
  const createComment = trpc.videos.comments.create.useMutation();
  const editComment = trpc.videos.comments.edit.useMutation();
  const pinComment = trpc.videos.comments.pin.useMutation();
  const reactComment = trpc.videos.comments.react.useMutation();
  const deleteComment = trpc.videos.comments.delete.useMutation();
  const comments = commentsQuery.data ?? [];
  type CommentRow = NonNullable<(typeof commentsQuery.data)>[number];
  const utils = trpc.useUtils();
  // Threaded replies: only the threads the member opened are fetched, in
  // COMMENT_REPLY_BATCH-sized batches, straight from videos.comments.list.
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const [repliesByParent, setRepliesByParent] = useState<
    Record<number, CommentRow[]>
  >({});
  const [threadMeta, setThreadMeta] = useState<
    Record<number, { loading: boolean; exhausted: boolean }>
  >({});
  // Authoritative parent map: the server's `parentId` plus the parent recorded
  // when this session created the reply. Rows with a known parent are never
  // eligible to render as root comments and always stay in that parent's thread.
  const [replyParentByCommentId, setReplyParentByCommentId] = useState<
    Record<number, number>
  >({});
  const parentOf = (row: CommentRow): number | null =>
    row.parentId ?? replyParentByCommentId[row.id] ?? null;
  // Replies for one parent: the fetched batch plus any reply row that arrived
  // in the listing, deduped, so a parent's children always stay grouped.
  const repliesFor = (parentId: number): CommentRow[] => {
    const batch = repliesByParent[parentId] ?? [];
    const strays = comments.filter(row => parentOf(row) === parentId);
    if (!strays.length) return batch;
    const seen = new Set(batch.map(row => row.id));
    return [...batch, ...strays.filter(row => !seen.has(row.id))].sort(
      (a, b) => (a.createdAt < b.createdAt ? 1 : -1)
    );
  };

  // Which comment the shared reaction surface is acting on: set when a pill is
  // tapped or when a long-press is recovered from a rendered row above.
  const loadReplies = async (parentId: number, offset: number) => {
    setThreadMeta(prev => ({
      ...prev,
      [parentId]: {
        loading: true,
        exhausted: prev[parentId]?.exhausted ?? false,
      },
    }));
    try {
      const batch = await utils.videos.comments.list.fetch({
        videoId: postId,
        parentId,
        limit: COMMENT_REPLY_BATCH,
        offset,
      });
      setRepliesByParent(prev => {
        const existing = offset > 0 ? (prev[parentId] ?? []) : [];
        const seen = new Set(existing.map(item => item.id));
        return {
          ...prev,
          [parentId]: [
            ...existing,
            ...batch.filter(item => !seen.has(item.id)),
          ],
        };
      });
      setThreadMeta(prev => ({
        ...prev,
        [parentId]: {
          loading: false,
          exhausted: batch.length < COMMENT_REPLY_BATCH,
        },
      }));
    } catch (error) {
      setThreadMeta(prev => ({
        ...prev,
        [parentId]: {
          loading: false,
          exhausted: prev[parentId]?.exhausted ?? false,
        },
      }));
      notifyError(error);
    }
  };

  const toggleThread = (commentId: number) => {
    if (expandedIds.includes(commentId)) {
      setExpandedIds(prev => prev.filter(id => id !== commentId));
      setRepliesByParent(prev => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
      setThreadMeta(prev => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
      return;
    }
    setExpandedIds(prev => [...prev, commentId]);
    void loadReplies(commentId, 0);
  };

  // Re-reads every open thread so mutations stay correct without refetching
  // all replies. `growFor` widens one batch by one row (a newly created reply).
  const refreshThreads = async (growFor?: number | null) => {
    await Promise.all(
      expandedIds.map(async parentId => {
        const current = repliesByParent[parentId] ?? [];
        const limit = Math.min(
          Math.max(current.length, COMMENT_REPLY_BATCH) +
            (growFor === parentId ? 1 : 0),
          COMMENT_REPLY_BATCH_MAX
        );
        try {
          const batch = await utils.videos.comments.list.fetch({
            videoId: postId,
            parentId,
            limit,
            offset: 0,
          });
          setRepliesByParent(prev => ({ ...prev, [parentId]: batch }));
          setThreadMeta(prev => ({
            ...prev,
            [parentId]: { loading: false, exhausted: batch.length < limit },
          }));
        } catch {
          // Roots refetch below still refreshes reply counters.
        }
      })
    );
  };

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const submitComment = async (
    audioUrl: string | null,
    audioDuration: number | null
  ) => {
    if (!auth.isAuthenticated) return auth.openAuth();
    const replyParentId = replyTo?.id;
    const previousReplyTo = replyTo;
    const draft = body;
    const text = draft.trim();
    const needsExpand =
      replyParentId != null && !expandedIds.includes(replyParentId);
    // A new top-level comment is easiest to find under "Newest".
    if (replyParentId == null && sort !== "new") {
      setSort("new");
      setRootLimit(COMMENT_ROOT_PAGE);
    }
    // Text-only comments appear instantly ("Sending…") while the request runs.
    const optimistic: PendingComment | null =
      !audioUrl && text
        ? {
            tempId: -Date.now() - Math.floor(Math.random() * 1000),
            parentId: replyParentId ?? null,
            body: text,
          }
        : null;
    if (optimistic) {
      setPending(prev => [...prev, optimistic]);
      setBody("");
      setReplyTo(null);
      closeMentionPicker();
    }
    try {
      const created = await createComment.mutateAsync({
        videoId: postId,
        body: text,
        audioUrl,
        audioDuration,
        parentId: replyParentId,
      });
      // Pin the new reply to its parent for this session so it can never fall
      // back to the root list, even before the refetch lands.
      const createdId = created?.id ?? null;
      if (replyParentId != null && createdId != null) {
        setReplyParentByCommentId(prev => ({
          ...prev,
          [createdId]: replyParentId,
        }));
      }
      if (!optimistic) {
        setBody("");
        setReplyTo(null);
        closeMentionPicker();
      }
      if (replyParentId != null && needsExpand) {
        setExpandedIds(prev =>
          prev.includes(replyParentId) ? prev : [...prev, replyParentId]
        );
      }
      await Promise.all([
        commentsQuery.refetch(),
        needsExpand && replyParentId != null
          ? loadReplies(replyParentId, 0)
          : Promise.resolve(),
        refreshThreads(replyParentId),
      ]);
    } catch (error) {
      // Give the text (and reply target) back so nothing the member typed is lost.
      if (optimistic) {
        setBody(draft);
        setReplyTo(previousReplyTo);
      }
      throw error;
    } finally {
      if (optimistic) {
        setPending(prev => prev.filter(item => item.tempId !== optimistic.tempId));
      }
    }
  };

  const saveEdit = async () => {
    if (!editing || editComment.isPending) return;
    const text = editing.text.trim();
    if (!text) return;
    try {
      await editComment.mutateAsync({ commentId: editing.id, body: text });
      setEditing(null);
      await Promise.all([commentsQuery.refetch(), refreshThreads()]);
    } catch (error) {
      notifyError(error);
    }
  };

  const togglePin = async (commentId: number, pinned: boolean) => {
    if (pinComment.isPending) return;
    try {
      await pinComment.mutateAsync({ commentId, pinned });
      await commentsQuery.refetch();
      toast.success(pinned ? "Comment pinned to the top." : "Comment unpinned.");
    } catch (error) {
      notifyError(error);
    }
  };

  const reactToComment = async (
    commentId: number,
    reaction: ConversationReactionId
  ) => {
    if (!auth.isAuthenticated) return auth.openAuth();
    if (reactingId !== null) return;
    setReactingId(commentId);
    try {
      await reactComment.mutateAsync({ commentId, reaction });
      await Promise.all([commentsQuery.refetch(), refreshThreads()]);
    } catch (error) {
      notifyError(error);
    } finally {
      setReactingId(null);
    }
  };

  const removeComment = async (commentId: number) => {
    if (!auth.isAuthenticated || deleteComment.isPending) return;
    try {
      await deleteComment.mutateAsync({ commentId });
      if (replyTo?.id === commentId) setReplyTo(null);
      setRepliesByParent(prev => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
      await Promise.all([commentsQuery.refetch(), refreshThreads()]);
    } catch (error) {
      notifyError(error);
    }
  };

  const closeMentionPicker = () => {
    setMentionPickerOpen(false);
    setMentionToken(null);
    setMentionSource(null);
  };

  // Typing "@" (or moving the caret into an existing token) opens the picker
  // in typing mode: the token query drives the results and the composer keeps
  // focus. Backspacing past the "@" closes it again.
  const handleComposerInputChange = (value: string, cursor: number) => {
    const token = findMentionToken(value, cursor);
    setMentionToken(prev => {
      if (prev === token) return prev;
      if (
        prev &&
        token &&
        prev.start === token.start &&
        prev.end === token.end &&
        prev.query === token.query
      ) {
        return prev;
      }
      return token;
    });
    if (token) {
      setMentionPickerOpen(true);
      setMentionSource("typing");
    } else if (mentionSource === "typing") {
      setMentionPickerOpen(false);
      setMentionSource(null);
    }
  };

  const handleComposerKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "Escape") {
      if (mentionPickerOpen) {
        event.preventDefault();
        closeMentionPicker();
      }
      return;
    }
    if (!mentionPickerOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      mentionPickerRef.current?.moveHighlight(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      mentionPickerRef.current?.moveHighlight(-1);
    } else if (event.key === "Enter") {
      // Enter picks the highlighted person instead of submitting; with an
      // empty list it falls through so the comment still submits.
      if (mentionPickerRef.current?.selectHighlighted()) {
        event.preventDefault();
      }
    }
  };

  const insertMention = (user: {
    id: number;
    name: string | null;
    username: string | null;
  }) => {
    const username = user.username?.trim();
    // Usernames are the normal stable mention token. When a member has no
    // username, preserve the selected member's real ID so the saved comment
    // remains a clickable profile mention instead of plain display text.
    const handle = username ? `@${username}` : `@${user.id}`;
    if (!handle) return;
    const input = inputRef.current;
    const token = mentionToken;
    if (token) {
      const next = applyMentionPick(body, token, handle, 500);
      setBody(next.text);
      closeMentionPicker();
      requestAnimationFrame(() => {
        input?.focus();
        input?.setSelectionRange(next.cursor, next.cursor);
      });
      return;
    }
    // Button mode: insert at the live caret (or append) with clean spacing.
    const cursor = Math.min(input?.selectionStart ?? body.length, body.length);
    const before = body.slice(0, cursor);
    const after = body.slice(cursor);
    const glue = before.length === 0 || /\s$/.test(before) ? "" : " ";
    const tail = after.length === 0 || !/^\s/.test(after) ? " " : "";
    const insertion = `${glue}${handle}${tail}`;
    const nextText = `${before}${insertion}${after}`.slice(0, 500);
    const nextCursor = Math.min(before.length + insertion.length, 500);
    setBody(nextText);
    closeMentionPicker();
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  // A text comment that is still being sent: shown at once, dimmed, no menu.
  const renderPending = (item: PendingComment): ReactNode => (
    <div
      className="conv-comment-thread conv-comment-thread--pending"
      key={`pending-${item.tempId}`}
    >
      <article className="conv-comment conv-comment--pending" aria-busy="true">
        <span className="conv-comment-avatar" aria-hidden="true">
          <UserRound size={16} />
        </span>
        <div className="conv-comment-main">
          <div className="conv-comment-head">
            <div className="conv-comment-meta">
              <span className="conv-comment-author">You</span>
              <span className="conv-comment-time">Sending…</span>
            </div>
          </div>
          <p className="conv-comment-body">
            <MentionText text={item.body} />
          </p>
        </div>
      </article>
    </div>
  );

  const renderComment = (
    comment: (typeof comments)[number],
    depth = 0
  ): ReactNode => {
    const username = comment.author.username?.trim() || "member";
    const displayNameValue = displayName(comment.author.name, comment.author.username);
    const canDelete =
      auth.user?.id === comment.author.id || auth.user?.id === postOwnerId;
    const isOwn = auth.user?.id === comment.author.id;
    const isPostOwner = auth.user?.id === postOwnerId;
    const authorIsCreator =
      Boolean(comment.author.isCreator) || comment.author.id === postOwnerId;
    const isEditingThis = editing?.id === comment.id;
    const canEdit =
      isOwn &&
      Boolean(comment.body) &&
      Date.now() - new Date(comment.createdAt).getTime() <=
        COMMENT_EDIT_WINDOW_MS;
    const avatarUrl = comment.author.photoUrl
      ? resolveMediaUrl(comment.author.photoUrl, "avatars")
      : null;
    const pendingReplies = pending.filter(item => item.parentId === comment.id);
    const isExpanded = expandedIds.includes(comment.id);
    const showThread = isExpanded || pendingReplies.length > 0;
    // Server batch first, then any listing row already attributed to this
    // parent — a reply can only ever render inside its parent's thread.
    const replies = repliesFor(comment.id);
    const replyCount = Math.max(comment.replyCount ?? 0, replies.length);
    const threadState = threadMeta[comment.id];
    const authorLabel = `@${username}`;

    // Shared conversation reaction surface: backend returns merged
    // multi-reaction entries (comment_reactions ∪ legacy comment_likes "like").
    const reactionEntries = commentReactionEntries(comment);

    const activeReaction =
      reactionEntries.find(row => row.reactedByMe)?.reaction ?? null;

    const menuActions: ConversationAction[] = [
      {
        id: "reply",
        label: "Reply",
        icon: <CornerUpLeft size={14} />,
        run: () => setReplyTo({ id: comment.id, username }),
      },
      {
        id: "react",
        label: activeReaction ? "Remove reaction" : "React",
        icon: <span aria-hidden="true">❤️</span>,
        run: () => void reactToComment(comment.id, activeReaction ?? "love"),
      },
      {
        id: "copy",
        label: "Copy text",
        icon: <Copy size={14} />,
        run: () => {
          if (comment.body) {
            void navigator.clipboard?.writeText(comment.body).catch(() => {});
          }
        },
      },
    ];
    if (canEdit) {
      menuActions.push({
        id: "edit",
        label: "Edit",
        icon: <Pencil size={14} />,
        run: () => setEditing({ id: comment.id, text: comment.body ?? "" }),
      });
    }
    if (isPostOwner && depth === 0) {
      menuActions.push({
        id: "pin",
        label: comment.isPinned ? "Unpin" : "Pin to top",
        icon: <Pin size={14} />,
        run: () => void togglePin(comment.id, !comment.isPinned),
      });
    }
    if (canDelete) {
      menuActions.push({
        id: "delete",
        label: "Delete",
        icon: <Trash2 size={14} />,
        run: () => void removeComment(comment.id),
        danger: true,
      });
    }
    if (!isOwn) {
      menuActions.push({
        id: "report",
        label: "Report author",
        icon: <Flag size={14} />,
        run: () => {
          // Reports target supported types only — user is valid.
          window.dispatchEvent(
            new CustomEvent("kinba:report-user", {
              detail: { userId: comment.author.id, name: displayNameValue },
            })
          );
        },
        danger: true,
      });
    }

    return (
      <div
        className={`conv-comment-thread${depth ? " conv-comment-thread--reply" : ""}${comment.isPinned ? " conv-comment-thread--pinned" : ""}`}
        key={comment.id}
      >
        <article className="conv-comment" data-comment-id={comment.id}>
          <a
            className="conv-comment-avatar"
            href={`/profile/${comment.author.id}`}
            tabIndex={-1}
            aria-hidden="true"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              navigateToProfile(event, comment.author.id);
            }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" loading="lazy" />
            ) : (
              <span>
                {(displayNameValue.replace(/^@/, "").charAt(0) || "J").toUpperCase()}
              </span>
            )}
          </a>
          <div className="conv-comment-main">
            <div className="conv-comment-head">
              <div className="conv-comment-meta">
                <a
                  className="conv-comment-author"
                  href={`/profile/${comment.author.id}`}
                  onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    navigateToProfile(event, comment.author.id);
                  }}
                  aria-label={`Open ${displayNameValue} profile`}
                >
                  {displayNameValue}
                </a>
                {authorIsCreator ? (
                  <span className="conv-badge conv-badge--creator">Creator</span>
                ) : null}
                {comment.isPinned ? (
                  <span className="conv-badge conv-badge--pin">
                    <Pin size={10} aria-hidden="true" /> Pinned
                  </span>
                ) : null}
                <span className="conv-comment-time">
                  {relativeTime(comment.createdAt)}
                  {comment.isEdited ? " · edited" : ""}
                </span>
              </div>
              <ActionMenu actions={menuActions} ariaLabel="Comment actions" />
            </div>
            {isEditingThis && editing ? (
              <div className="conv-comment-edit">
                <textarea
                  value={editing.text}
                  maxLength={COMMENT_MAX_LENGTH}
                  rows={2}
                  autoFocus
                  aria-label="Edit your comment"
                  onChange={event =>
                    setEditing({ id: comment.id, text: event.target.value })
                  }
                  onKeyDown={event => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditing(null);
                    } else if (
                      event.key === "Enter" &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault();
                      void saveEdit();
                    }
                  }}
                />
                <div className="conv-comment-edit-foot">
                  <span
                    className={`conv-char-count${editing.text.length >= COMMENT_MAX_LENGTH ? " is-max" : editing.text.length >= 450 ? " is-near" : ""}`}
                  >
                    {editing.text.length}/{COMMENT_MAX_LENGTH}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    disabled={editComment.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="is-primary"
                    onClick={() => void saveEdit()}
                    disabled={
                      editComment.isPending ||
                      !editing.text.trim() ||
                      editing.text.trim() === (comment.body ?? "").trim()
                    }
                  >
                    {editComment.isPending ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : comment.body ? (
              <p className="conv-comment-body">
                <MentionText text={comment.body} />
              </p>
            ) : null}
            {comment.audioUrl ? (
              <CommentAudioPlayer
                src={comment.audioUrl}
                duration={comment.audioDuration}
              />
            ) : null}
            <div className="conv-comment-foot">
              <ReactionBar
                reactions={reactionEntries}
                onReact={reaction => void reactToComment(comment.id, reaction)}
                disabled={reactingId !== null}
                busy={reactingId === comment.id}
                ariaLabel="Comment reactions"
                total={totalReactionCount(reactionEntries)}
                active={activeReaction}
                longPress={longPress}
                onTotalClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  setReactionTargetId(comment.id);
                  setReactorsOpen(true);
                }}
              />
              {comment.creatorReacted && !authorIsCreator ? (
                <span
                  className="conv-creator-liked"
                  title="Liked by the creator"
                >
                  <Heart size={11} fill="currentColor" aria-hidden="true" />{" "}
                  by creator
                </span>
              ) : null}
              <button
                type="button"
                className="conv-comment-reply-count"
                onClick={() => setReplyTo({ id: comment.id, username })}
                aria-label={`Reply to ${authorLabel}`}
              >
                Reply
              </button>
              {replyCount > 0 ? (
                <button
                  type="button"
                  className={`conv-comment-reply-count conv-comment-reply-toggle${isExpanded ? " is-open" : ""}`}
                  aria-expanded={isExpanded}
                  aria-label={
                    isExpanded
                      ? `Hide replies to ${authorLabel}`
                      : `View replies to ${authorLabel}`
                  }
                  onClick={event => {
                    event.stopPropagation();
                    toggleThread(comment.id);
                  }}
                >
                  ↳ {replyCountLabel(replyCount)}
                </button>
              ) : null}
              {replyTo?.id === comment.id ? (
                <span className="video-comment-replying">
                  Replying to {authorLabel}
                </span>
              ) : null}
            </div>
          </div>
        </article>
        {showThread ? (
          <div className="conv-comment-reply-thread">
            {pendingReplies.map(item => renderPending(item))}
            {threadState?.loading && replies.length === 0 ? (
              <span className="conv-comment-reply-status">Loading replies…</span>
            ) : (
              replies.map(reply => renderComment(reply, depth + 1))
            )}
            {threadState && !threadState.exhausted ? (
              <button
                type="button"
                className="conv-comment-more-replies"
                disabled={threadState.loading}
                onClick={() =>
                  // Page by the server batch only — listing rows already
                  // attributed here are not part of the server's offset.
                  void loadReplies(
                    comment.id,
                    (repliesByParent[comment.id] ?? []).length
                  )
                }
              >
                {threadState.loading ? "Loading…" : "View more replies"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const visualViewport = window.visualViewport;
    const updateKeyboardOffset = () => {
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const keyboardOffset = Math.max(
        0,
        window.innerHeight - viewportHeight - viewportTop
      );
      document.documentElement.style.setProperty(
        "--kinba-keyboard-offset",
        `${keyboardOffset}px`
      );
    };
    document.body.style.overflow = "hidden";
    updateKeyboardOffset();
    visualViewport?.addEventListener("resize", updateKeyboardOffset);
    visualViewport?.addEventListener("scroll", updateKeyboardOffset);
    return () => {
      document.body.style.overflow = previousOverflow;
      visualViewport?.removeEventListener("resize", updateKeyboardOffset);
      visualViewport?.removeEventListener("scroll", updateKeyboardOffset);
      document.documentElement.style.removeProperty("--kinba-keyboard-offset");
    };
  }, [open]);

  if (!open) return null;
  // Roots are only rows with no known parent — a reply never qualifies.
  const roots = comments.filter(comment => parentOf(comment) == null);
  const pendingRoots = pending.filter(item => item.parentId == null);
  const canLoadMore =
    !commentsQuery.isPending &&
    !commentsQuery.isError &&
    comments.length >= rootLimit &&
    rootLimit < COMMENT_ROOT_MAX;
  const changeSort = (mode: CommentSortMode) => {
    if (mode === sort) return;
    setSort(mode);
    setRootLimit(COMMENT_ROOT_PAGE);
  };
  return createPortal(
    <div className="comment-drawer-layer" role="presentation">
      <button
        type="button"
        className="comment-drawer-backdrop"
        aria-label="Close comments"
        onClick={onClose}
      />
      <section
        className="comment-drawer"
        aria-live="polite"
        role="dialog"
        aria-modal="true"
        aria-label="Comments"
      >
        <div className="comment-sheet-header">
          <span aria-hidden="true" />
          <strong>Comments</strong>
          <button type="button" onClick={onClose} aria-label="Close comments">
            <X size={18} />
          </button>
        </div>
        {roots.length > 1 || sort === "top" ? (
          <div className="comment-sort" role="tablist" aria-label="Sort comments">
            {(["new", "top"] as const).map(mode => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={sort === mode}
                className={sort === mode ? "is-active" : undefined}
                onClick={() => changeSort(mode)}
              >
                {mode === "new" ? "Newest" : "Top"}
              </button>
            ))}
          </div>
        ) : null}
        <div className="comment-drawer-list">
          {commentsQuery.isPending ? (
            <div
              className="comment-skeletons"
              role="status"
              aria-label="Loading comments"
            >
              {[0, 1, 2].map(index => (
                <div className="comment-skeleton" key={index}>
                  <span />
                  <div>
                    <i />
                    <i />
                  </div>
                </div>
              ))}
            </div>
          ) : commentsQuery.isError ? (
            <div className="comment-loading">
              Comments are temporarily unavailable.
            </div>
          ) : roots.length || pendingRoots.length ? (
            <>
              {pendingRoots.map(item => renderPending(item))}
              {roots.map(comment => renderComment(comment))}
              {canLoadMore ? (
                <button
                  type="button"
                  className="comment-load-more"
                  disabled={commentsQuery.isFetching}
                  onClick={() =>
                    setRootLimit(limit =>
                      Math.min(limit + COMMENT_ROOT_PAGE, COMMENT_ROOT_MAX)
                    )
                  }
                >
                  {commentsQuery.isFetching ? "Loading…" : "Load more comments"}
                </button>
              ) : null}
            </>
          ) : (
            <div className="comment-empty">
              <MessageCircle size={28} aria-hidden="true" />
              <strong>No comments yet</strong>
              <span>Start the conversation.</span>
            </div>
          )}
        </div>
        {replyTo ? (
          <ReplyBanner
            label={`@${replyTo.username}`}
            onCancel={() => setReplyTo(null)}
          />
        ) : null}
        {mentionPickerOpen && auth.isAuthenticated ? (
          <MentionPicker
            ref={mentionPickerRef}
            viewerId={auth.user?.id ?? null}
            onPick={insertMention}
            query={
              mentionSource === "typing" ? (mentionToken?.query ?? "") : undefined
            }
          />
        ) : null}
        {body.length >= 400 ? (
          <div
            className={`conv-char-count conv-char-count--composer${body.length >= COMMENT_MAX_LENGTH ? " is-max" : body.length >= 450 ? " is-near" : ""}`}
            aria-live="polite"
          >
            {body.length}/{COMMENT_MAX_LENGTH}
          </div>
        ) : null}
        <div className="conv-composer-row">
          <button
            type="button"
            className={
              mentionPickerOpen
                ? "conv-mention-toggle conv-mention-toggle--on"
                : "conv-mention-toggle"
            }
            aria-label="Mention someone"
            aria-pressed={mentionPickerOpen}
            title="Mention"
            disabled={!auth.isAuthenticated}
            onClick={() => {
              if (!auth.isAuthenticated) return auth.openAuth();
              if (mentionPickerOpen) {
                closeMentionPicker();
              } else {
                setMentionPickerOpen(true);
                setMentionSource("button");
                setMentionToken(null);
              }
            }}
          >
            @
          </button>
          <VoiceCommentComposer
            body={body}
            onBodyChange={setBody}
            onSend={submitComment}
            disabled={createComment.isPending}
            inputRef={inputRef}
            onInputChange={handleComposerInputChange}
            onInputKeyDown={handleComposerKeyDown}
            placeholder={
              auth.isAuthenticated
                ? replyTo
                  ? "Write a reply…"
                  : "Write a comment…"
                : "Sign in to comment"
            }
          />
        </div>
      </section>
      {reactionTargetId != null ? (
        <ReactorList
          open={reactorsOpen}
          title="Comment reactions"
          source={{ kind: "comment", commentId: reactionTargetId }}
          onClose={() => setReactorsOpen(false)}
        />
      ) : null}
    </div>,
    document.body
  );
}


function getRawPulseVoterKey() {
  if (typeof window === "undefined") return "server-render-voter-key";
  const storageKey = "kinba.raw-pulse.voter-key";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;
  const generated = `anon-${crypto.randomUUID()}`;
  window.localStorage.setItem(storageKey, generated);
  return generated;
}

function RawPulseCard({ videoId }: { videoId: number }) {
  const voterKey = useMemo(getRawPulseVoterKey, []);
  const query = trpc.rawPulse.get.useQuery(
    { videoId, voterKey },
    { refetchInterval: 5000, refetchOnWindowFocus: true, staleTime: 2000 }
  );
  const voteMutation = trpc.rawPulse.vote.useMutation();
  const [votingOptionId, setVotingOptionId] = useState<number | null>(null);
  if (!query.data) return null;
  const pulse = query.data;
  const vote = async (optionId: number) => {
    if (pulse.isClosed || voteMutation.isPending) return;
    setVotingOptionId(optionId);
    try {
      await voteMutation.mutateAsync({ pollId: pulse.id, optionId, voterKey });
      await query.refetch();
    } catch (error) {
      notifyError(error);
    } finally {
      setVotingOptionId(null);
    }
  };
  return (
    <section className="raw-pulse" aria-label="Raw Pulse anonymous poll">
      <div className="raw-pulse__heading">
        <span className="eyebrow">Raw Pulse</span>
        <span>
          {pulse.isClosed ? "Closed" : `${pulse.totalVotes} anonymous votes`}
        </span>
      </div>
      <h3>{pulse.question}</h3>
      <div className="raw-pulse__options">
        {pulse.options.map(option => {
          const percentage = pulse.totalVotes
            ? Math.round((option.votes / pulse.totalVotes) * 100)
            : 0;
          return (
            <button
              key={option.id}
              type="button"
              className={`raw-pulse__option${option.selected ? " is-selected" : ""}`}
              onClick={() => void vote(option.id)}
              disabled={pulse.isClosed || voteMutation.isPending}
              aria-pressed={option.selected}
            >
              <span
                className="raw-pulse__bar"
                style={{ width: `${percentage}%` }}
              />
              <span className="raw-pulse__label">{option.label}</span>
              <span className="raw-pulse__result">
                {votingOptionId === option.id ? "…" : `${percentage}%`}
              </span>
            </button>
          );
        })}
      </div>
      <p className="raw-pulse__note">
        Anonymous on this device · You can change your vote.
      </p>
    </section>
  );
}

function PostManagementMenu({
  video,
  onUpdated,
  onDeleted,
}: {
  video: VideoRecord;
  onUpdated: (description: string) => void;
  onDeleted: () => void;
}) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [description, setDescription] = useState(video.description);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const updateMutation = trpc.videos.updateDescription.useMutation();
  const deleteMutation = trpc.videos.delete.useMutation();
  const [caption, setCaption] = useState(postCaption(video.title, video.description));

  const saveCaption = async () => {
    try {
      const captionText = caption.trim();
      const result = await updateMutation.mutateAsync({
        videoId: video.id,
        description: captionText,
      });
      onUpdated(result.description);
      setEditing(false);
      setOpen(false);
      await utils.home.feed.invalidate();
      toast.success("Caption updated.");
    } catch (error) {
      notifyError(error);
    }
  };
  const removePost = async () => {
    try {
      await deleteMutation.mutateAsync({ videoId: video.id });
      await utils.home.feed.invalidate();
      toast.success("Post deleted.");
      onDeleted();
    } catch (error) {
      notifyError(error);
    }
  };
  const toggleMenu = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(value => !value);
    setEditing(false);
    setConfirming(false);
  };
  const closeAll = () => {
    setOpen(false);
    setEditing(false);
    setConfirming(false);
  };
  useEffect(() => {
    if (!open && !editing && !confirming) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };
    const onClickOutside = (event: Event) => {
      const target = (event as any).target as HTMLElement;
      if (target.closest(".post-management, .post-management__menu, .post-management__dialog")) return;
      closeAll();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onClickOutside);
    };
  }, [open, editing, confirming]);

  if (auth.user?.id !== video.owner.id) return null;

  const menuContent = (open || editing || confirming) ? createPortal(
    <>
      {open && !editing && !confirming && (
        <div
          className="post-management__menu"
          role="menu"
          style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 2147483000 }}
        >
          <button
            type="button"
            onClick={() => setEditing(true)}
            role="menuitem"
          >
            Edit Caption
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={() => setConfirming(true)}
            role="menuitem"
          >
            Delete Post
          </button>
        </div>
      )}
      {editing && (
        <div
          className="post-management__dialog"
          role="dialog"
          aria-label="Edit caption"
          style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 2147483000 }}
        >
          <strong>Edit Caption</strong>
          <textarea
            value={caption}
            maxLength={2000}
            onChange={event => setCaption(event.target.value)}
            autoFocus
          />
          <span className="post-management__count">{caption.length} / 2000</span>
          <div className="post-management__dialog-actions">
            <button
              type="button"
              onClick={() => { setEditing(false); setOpen(false); }}
              disabled={updateMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => void saveCaption()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
      {confirming && (
        <div
          className="post-management__dialog"
          role="alertdialog"
          aria-label="Confirm post deletion"
          style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 2147483000 }}
        >
          <strong>Delete this post?</strong>
          <p>This permanently removes the post and its stored media.</p>
          <div className="post-management__dialog-actions">
            <button
              type="button"
              onClick={() => { setConfirming(false); setOpen(false); }}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={() => void removePost()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </>,
    document.body
  ) : null;
  return (
    <div className="post-management" onClick={event => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className="feed-post-more"
        aria-label="Post options"
        onClick={toggleMenu}
      >
        <MoreHorizontal size={18} />
      </button>
      {menuContent}
    </div>
  );
}

function PhotoCarousel({
  video,
  onOpenViewer,
}: {
  video: VideoRecord;
  onOpenViewer?: () => void;
}) {
  const images = video.gallery?.length
    ? video.gallery
    : [{ url: video.videoUrl, width: video.width, height: video.height }];
  const [index, setIndex] = useState(0);
  const pointerStartRef = useRef<{ x: number; pointerId: number } | null>(null);
  const suppressClickRef = useRef(false);
  const current = images[Math.min(index, images.length - 1)];
  const moveBy = (delta: number) => {
    setIndex(currentIndex => (currentIndex + delta + images.length) % images.length);
  };
  return (
    <div
      className="k-post__carousel"
      onClick={event => {
        event.stopPropagation();
        if (suppressClickRef.current) suppressClickRef.current = false;
      }}
      onPointerDown={event => {
        if (event.pointerType !== "touch" || !event.isPrimary) return;
        pointerStartRef.current = { x: event.clientX, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerUp={event => {
        const start = pointerStartRef.current;
        pointerStartRef.current = null;
        if (event.pointerType !== "touch" || !start || start.pointerId !== event.pointerId) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        const delta = event.clientX - start.x;
        if (Math.abs(delta) < 40) return;
        suppressClickRef.current = true;
        moveBy(delta < 0 ? 1 : -1);
      }}
      onPointerCancel={() => { pointerStartRef.current = null; }}
    >
      <img
        src={resolveMediaUrl(current.url) ?? current.url}
        alt={`${video.title || "Post"} · image ${index + 1} of ${images.length}`}
        loading="lazy"
        draggable={false}
        onClick={event => {
          event.stopPropagation();
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          onOpenViewer?.();
        }}
        onKeyDown={event => {
          if (event.key === "ArrowLeft") moveBy(-1);
          if (event.key === "ArrowRight") moveBy(1);
        }}
        tabIndex={0}
      />
      {images.length > 1 ? (
        <>
          <button type="button" className="k-post__carousel-nav is-prev" onClick={() => moveBy(-1)} aria-label="Previous image"><ChevronLeft size={22} /></button>
          <button type="button" className="k-post__carousel-nav is-next" onClick={() => moveBy(1)} aria-label="Next image"><ChevronRight size={22} /></button>
          <span className="k-post__carousel-count" aria-live="polite">{index + 1} / {images.length}</span>
          <div className="k-post__carousel-dots" aria-label="Choose image">
            {images.map((image, imageIndex) => (
              <button type="button" key={image.url} className={imageIndex === index ? "is-active" : ""} onClick={() => setIndex(imageIndex)} aria-label={`Show image ${imageIndex + 1}`} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function VideoCard({
  video,
  active = true,
  showDetailsOverlay = false,
  socialLayout = false,
  onOpenViewer,
  renderVideo,
}: {
  video: VideoRecord;
  active?: boolean;
  showDetailsOverlay?: boolean;
  socialLayout?: boolean;
  onOpenViewer?: () => void;
  showHeader?: boolean;
  renderVideo?: (video: VideoRecord, active: boolean, onFirstPlay: () => void) => ReactNode;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [description, setDescription] = useState(video.description);
  const [isEdited, setIsEdited] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const auth = useAuth();
  const [bookmarked, setBookmarked] = useState(video.viewerBookmarked ?? false);
  const bookmarkMutation = trpc.videos.bookmark.useMutation();
  const toggleBookmark = async () => {
    if (!auth.isAuthenticated) return auth.openAuth();
    if (bookmarkMutation.isPending) return;
    try {
      const engagement = await bookmarkMutation.mutateAsync({
        videoId: video.id,
      });
      setBookmarked(engagement.viewerBookmarked);
    } catch (error) {
      notifyError(error);
    }
  };
  const [views, setViews] = useState(video.viewCount);
  const viewMutation = trpc.videos.view.useMutation();
  const { current, react, share, pending } = useOptimisticEngagement(video);
  const [reactorsOpen, setReactorsOpen] = useState(false);
  // Single reaction (Pookie/Love): tap toggles; long-press opens who reacted.
  const longPress = useLongPress({
    onLongPress: () => setReactorsOpen(true),
  });
  // Double-tap to like: the first tap arms a short window; a second tap inside
  // it shows a heart burst and likes (without opening the viewer). Otherwise
  // the single tap opens the viewer after the window elapses.
  const tapTimerRef = useRef<number | null>(null);
  const lastTapRef = useRef(0);
  const [heartBurstKey, setHeartBurstKey] = useState(0);
  useEffect(
    () => () => {
      if (tapTimerRef.current != null) window.clearTimeout(tapTimerRef.current);
    },
    []
  );
  const handleMediaTap = (event: MouseEvent<HTMLElement>) => {
    if (!onOpenViewer) {
      openViewer(event);
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      if (tapTimerRef.current != null) {
        window.clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      setHeartBurstKey(key => key + 1);
      if (!current.viewerReacted && !pending) void react();
      return;
    }
    lastTapRef.current = now;
    const target = event.target;
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null;
      if (
        target instanceof HTMLElement &&
        target.closest("button, a, input, textarea, select")
      )
        return;
      onOpenViewer();
    }, 300);
  };
  const openViewer = (event: MouseEvent<HTMLElement>) => {
    if (!onOpenViewer) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("button, a, input, textarea, select")
    )
      return;
    console.log("[KINBA DIAGNOSTIC] FEED VIDEO OPEN REQUEST", {
      videoId: video.id,
      mediaType: video.mediaType,
      component: "VideoCard",
      source: event.target instanceof HTMLElement ? event.target.tagName : "unknown",
      timestamp: Date.now(),
    });
    onOpenViewer();
  };
  const recordView = () => {
    if (viewMutation.isPending) return;
    void viewMutation
      .mutateAsync({ videoId: video.id })
      .then(result => setViews(result.viewCount))
      .catch(() => undefined);
  };
  // Phase 5: impression tracking — fire once when the card enters the
  // viewport. Server dedups per viewer+content+day; bots and self-views
  // are excluded there.
  const impressionMutation = trpc.analytics.trackImpression.useMutation();
  const cardRef = useRef<HTMLElement | null>(null);
  const impressionFiredRef = useRef(false);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || impressionFiredRef.current) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && !impressionFiredRef.current) {
          impressionFiredRef.current = true;
          void impressionMutation
            .mutateAsync({ contentId: video.id })
            .catch(() => {
              impressionFiredRef.current = false;
            });
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);
  if (deleted) return null;
  if (socialLayout) {
    const isText = video.mediaType === "TEXT";
    const isImage = video.mediaType === "IMAGE";
    const ownerName = displayName(video.owner.name, video.owner.username);

    return (
      <article
        id={`feed-video-${video.id}`}
        ref={cardRef}
        className={`k-post${isText ? " k-post--text" : ""}`}
      >
        <div className="k-post__creator">
          <a
            className="k-post__avatar"
            href={`/profile/${video.owner.id}`}
            onClick={event => navigateToProfile(event, video.owner.id)}
            aria-label={`Open ${ownerName} profile`}
          >
            {video.owner.photoUrl ? (
              <img
                src={resolveMediaUrl(video.owner.photoUrl, "avatars")}
                alt=""
              />
            ) : (
              <UserRound size={18} />
            )}
          </a>
          <div className="k-post__identity">
            <a
              className="k-post__name"
              href={`/profile/${video.owner.id}`}
              onClick={event => navigateToProfile(event, video.owner.id)}
            >
              {ownerName}
              {video.owner.isVerified && (
                <BadgeCheck size={14} className="verified-badge" aria-label="Verified profile" />
              )}
            </a>
            <span className="k-post__meta-line">
              {relativeTime(video.createdAt)}
              {!isText && ` · ${isImage ? "Photo" : "Video"}`}
              {isEdited ? <em className="cp-edited-badge"> · Edited</em> : null}
              {video.campaignId != null && (
                <>
                  <span> · </span>
                  <SponsoredBadge />
                </>
              )}
            </span>
          </div>
          <PostManagementMenu
            video={video}
            onUpdated={nextDescription => {
              setDescription(nextDescription);
              setIsEdited(true);
            }}
            onDeleted={() => setDeleted(true)}
          />
        </div>

        {isText ? (
          <div className="k-post__bottom">
            {description ? (
              <Caption text={description} maxLines={4} className="k-post__caption" />
            ) : video.title ? (
              <h3 className="k-post__title">{video.title}</h3>
            ) : null}
            <p className="k-post__stats">
              <span>{formatCount(views)} views</span>
              <span>{relativeTime(video.createdAt)}</span>
            </p>
          </div>
        ) : (
          <>
            <div
              className={`k-post__media${isImage ? " k-post__media--image" : " k-post__media--video"}`}
              role={onOpenViewer ? "button" : undefined}
              tabIndex={onOpenViewer ? 0 : undefined}
              aria-label={onOpenViewer ? "Open post" : undefined}
              onClick={handleMediaTap}
              onKeyDown={event => {
                if (!onOpenViewer || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                onOpenViewer();
              }}
            >
              {heartBurstKey > 0 && (
                <span
                  key={heartBurstKey}
                  className="k-post__heart-burst"
                  aria-hidden="true"
                >
                  <Heart size={76} fill="currentColor" />
                </span>
              )}
              {isImage ? (
                <PhotoCarousel video={video} onOpenViewer={onOpenViewer} />
              ) : renderVideo ? (
                renderVideo(video, active, recordView)
              ) : (
                <InlineVideoPlayer video={video} active={active} onFirstPlay={recordView} autoplayOnVisible />
              )}
            </div>
            <div className="k-post__bottom">
              {(() => {
                const captionText = postCaption(video.title, description);
                return captionText ? (
                  <Caption text={captionText} maxLines={3} className="k-post__caption" />
                ) : null;
              })()}
              <p className="k-post__stats">
                <span>{formatCount(views)} views</span>
                <span>{relativeTime(video.createdAt)}</span>
              </p>
            </div>
          </>
        )}

        <div className="k-post__actions">
          <button
            type="button"
            className={`media-engagement-actions__pookie${current.viewerReacted ? " is-active" : ""}`}
            {...longPress}
            onClick={react}
            disabled={!!pending}
            aria-pressed={current.viewerReacted}
            aria-label={current.viewerReacted ? "Remove Pookie" : "Pookie video"}
          >
            <Heart size={16} fill={current.viewerReacted ? "currentColor" : "none"} />
            <span>{current.viewerReacted ? "Pookied" : "Pookie"}</span>
          </button>
          <ReactionSummaryPill
            count={current.reactionCount}
            active={current.viewerReaction}
            disabled={!!pending}
            ariaLabel="See who reacted"
            title="See who reacted"
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              setReactorsOpen(true);
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (!auth.isAuthenticated) return auth.openAuth();
              setCommentsOpen(v => !v);
            }}
          >
            <MessageCircle size={16} />
            <span>Comment</span>
          </button>
          <button type="button" onClick={share} disabled={!!pending}>
            <Share2 size={16} />
            <span>Share</span>
          </button>
          <button
            type="button"
            className={bookmarked ? "is-active" : ""}
            onClick={toggleBookmark}
          >
            <Bookmark size={16} fill={bookmarked ? "currentColor" : "none"} />
            <span>Save</span>
          </button>
        </div>

        <CommentDrawer
          postId={video.id}
          postOwnerId={video.owner.id}
          open={commentsOpen}
          onClose={() => setCommentsOpen(false)}
        />
        <ReactorList
          open={reactorsOpen}
          title="Video reactions"
          source={{ kind: "video", videoId: video.id }}
          onClose={() => setReactorsOpen(false)}
        />
      </article>
    );
  }
  return null;
}
const MemoVideoCard = memo(VideoCard);

function FeedSkeleton({ short = false }: { short?: boolean }) {
  return (
    <div
      className={
        short ? "feed-skeleton feed-skeleton--short" : "feed-skeleton-grid"
      }
      aria-busy="true"
      aria-label="Loading feed"
    >
      <span />
      <span />
      <span />
    </div>
  );
}

function FeedRecovery({ onRetry }: { onRetry?: () => void } = {}) {
  return (
    <div className="media-empty" role="status">
      <h3>This feed is temporarily empty.</h3>
      <p>Navigation is still available. Try another tab or reload this feed.</p>
      <button
        type="button"
        className="primary-btn"
        onClick={() => (onRetry ? onRetry() : window.location.reload())}
      >
        <RotateCcw size={16} /> {onRetry ? "Try again" : "Reload feed"}
      </button>
    </div>
  );
}

/** Filename used when saving an image to the device gallery/Downloads. */
function resolveImageDownloadName(source: string, mimeType: string) {
  const extensionByType: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
  };
  let base = "image";
  try {
    const pathname = new URL(
      source,
      typeof window !== "undefined" ? window.location.origin : "http://localhost"
    ).pathname;
    const last = pathname.split("/").filter(Boolean).pop() ?? "";
    base = decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, "") || base;
  } catch {
    // Keep the generic name when the source is not parseable.
  }
  return `${base}${extensionByType[mimeType.toLowerCase()] ?? ""}`;
}

export function FeedPhotoLightbox({
  attachments = [],
  index,
  onClose,
  onChange,
  imageUrl,
  alt = "Expanded photo",
  owner,
  engagementVideo,
}: {
  attachments?: FeedAttachment[];
  index?: number;
  onClose: () => void;
  onChange?: (index: number) => void;
  imageUrl?: string | null;
  alt?: string;
  owner?: {
    id: number;
    name: string | null;
    username?: string | null;
    photoUrl: string | null;
  };
  engagementVideo?: VideoRecord;
}) {
  const auth = useAuth();
  const [sharing, setSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [internalIndex, setInternalIndex] = useState(0);
  const pointerStartRef = useRef<{ x: number; pointerId: number } | null>(null);
  const suppressClickRef = useRef(false);
  const imageAttachments = attachments.filter(
    item => item.mediaType === "IMAGE"
  );
  const activeIndex = index ?? internalIndex;
  const current = imageAttachments[activeIndex];
  const goTo = (nextIndex: number) => {
    if (!imageAttachments.length) return;
    const next = (nextIndex + imageAttachments.length) % imageAttachments.length;
    if (onChange) onChange(next);
    else setInternalIndex(next);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && imageAttachments.length > 1)
        goTo(activeIndex - 1);
      if (event.key === "ArrowRight" && imageAttachments.length > 1)
        goTo(activeIndex + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, imageAttachments.length, onClose]);
  if (!current && !imageUrl) return null;
  const photoUrl = current?.mediaUrl ?? imageUrl;
  const resolvedPhotoUrl = resolveMediaUrl(photoUrl ?? "") ?? photoUrl ?? "";

  /**
   * Saves the full-resolution image to the device.
   * - Android app: writes into the gallery (Pictures/JHILIK) through the
   *   native MediaStore plugin — the Capacitor WebView has no download
   *   listener, so blob/anchor saves silently do nothing there. Success is
   *   only toasted after the native save resolves; failures show the real
   *   native message (permission denied, not an image, network/storage error).
   * - Web: blob + anchor keeps the original bytes (no re-encode), with a
   *   window.open fallback handed to the browser's save flow.
   * Images only — this component never renders videos or Shorts, and the
   * file is never added to the in-app Saved library.
   */
  const downloadImage = async () => {
    if (!resolvedPhotoUrl || downloading) return;
    setDownloading(true);
    try {
      if (isAndroidApp()) {
        await saveImageToGallery(resolvedPhotoUrl);
        toast.success("Saved to your gallery.");
        return;
      }
      const response = await fetch(resolvedPhotoUrl, { mode: "cors" });
      if (!response.ok) throw new Error("Could not download this image.");
      const blob = await response.blob();
      if (blob.type && !blob.type.startsWith("image/")) {
        throw new Error("That link is not an image.");
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = resolveImageDownloadName(resolvedPhotoUrl, blob.type);
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      toast.success("Image downloaded to your device.");
    } catch (error) {
      if (isAndroidApp()) {
        // No window.open fallback on Android — report why the save failed.
        notifyError(error);
      } else {
        const opened = window.open(resolvedPhotoUrl, "_blank", "noopener");
        if (opened) {
          toast.message(
            "Opened the full-size image — save it from your browser's menu."
          );
        } else {
          notifyError(error);
        }
      }
    } finally {
      setDownloading(false);
      setMenuOpen(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-[9999] bg-black flex items-center justify-center feed-photo-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onPointerDown={event => {
        if (event.pointerType !== "touch" || !event.isPrimary) return;
        pointerStartRef.current = { x: event.clientX, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerUp={event => {
        const start = pointerStartRef.current;
        pointerStartRef.current = null;
        if (event.pointerType !== "touch" || !start || start.pointerId !== event.pointerId) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        const delta = event.clientX - start.x;
        if (Math.abs(delta) < 40) return;
        event.stopPropagation();
        suppressClickRef.current = true;
        goTo(delta < 0 ? activeIndex + 1 : activeIndex - 1);
      }}
      onPointerCancel={() => { pointerStartRef.current = null; }}
      onClick={() => {
        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
        setMenuOpen(false);
        onClose();
      }}
    >
      <div
        className="feed-photo-lightbox-backdrop"
        aria-hidden="true"
        style={
          resolvedPhotoUrl
            ? { backgroundImage: `url(${JSON.stringify(resolvedPhotoUrl)})` }
            : undefined
        }
      />
      <button
        type="button"
        className="absolute top-4 right-4 feed-photo-lightbox-close"
        onClick={onClose}
        aria-label="Close photo viewer"
      >
        <X size={24} />
      </button>
      <div className="feed-photo-lightbox-menu">
        <button
          type="button"
          className="feed-photo-lightbox-menu-trigger"
          aria-label="Photo options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={event => {
            event.stopPropagation();
            setMenuOpen(value => !value);
          }}
        >
          <MoreHorizontal size={24} />
        </button>
        {menuOpen ? (
          <div className="feed-photo-lightbox-menu-pop" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={downloading}
              onClick={event => {
                event.stopPropagation();
                void downloadImage();
              }}
            >
              <Download size={16} />
              {downloading ? "Downloading…" : "Download image"}
            </button>
          </div>
        ) : null}
      </div>
      {imageAttachments.length > 1 && (
        <span className="feed-photo-lightbox-counter">
          {activeIndex + 1} of {imageAttachments.length}
        </span>
      )}
      {imageAttachments.length > 1 && (
        <button
          type="button"
          className="feed-photo-lightbox-nav feed-photo-lightbox-nav--prev"
          onClick={event => {
            event.stopPropagation();
            goTo(activeIndex - 1);
          }}
          aria-label="Previous photo"
        >
          <ChevronLeft size={32} />
        </button>
      )}
      <img
        className="max-w-full object-contain"
        src={resolveMediaUrl(photoUrl ?? "")}
        alt={alt}
        onClick={event => event.stopPropagation()}
      />
      {owner && (
        <a
          className="absolute bottom-8 left-4 feed-photo-lightbox-owner profile-link"
          href={`/profile/${owner.id}`}
          onClick={event => event.stopPropagation()}
          aria-label={`Open ${displayName(owner.name, owner.username)} profile`}
        >
          <span className="video-owner-avatar">
            {owner.photoUrl ? (
              <img src={resolveMediaUrl(owner.photoUrl, "avatars")} alt="" />
            ) : (
              <UserRound size={18} />
            )}
          </span>
          <span>
            <strong>{displayName(owner.name, owner.username)}</strong>
            <small>
              {owner.username ? `@${owner.username}` : "JHILIK member"}
            </small>
          </span>
        </a>
      )}
      {imageAttachments.length > 1 && (
        <button
          type="button"
          className="feed-photo-lightbox-nav feed-photo-lightbox-nav--next"
          onClick={event => {
            event.stopPropagation();
            goTo(activeIndex + 1);
          }}
          aria-label="Next photo"
        >
          <ChevronRight size={32} />
        </button>
      )}
      {photoUrl && (
        <button
          type="button"
          className="feed-photo-lightbox-share"
          onClick={event => {
            event.stopPropagation();
            if (!auth.isAuthenticated) return auth.openAuth();
            if (sharing) return;
            setSharing(true);
            const img = event.currentTarget.closest(".feed-photo-lightbox")?.querySelector("img");
            const w = img?.naturalWidth || 800;
            const h = img?.naturalHeight || 600;
            void (async () => {
              try {
                const session = await supabase.auth.getSession();
                const token = session.data.session?.access_token;
                if (!token) throw new Error("Please sign in to share.");
                const response = await fetch(apiUrl("/api/photos/create"), {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  credentials: "include",
                  body: JSON.stringify({
                    title: alt || "Shared photo",
                    description: "",
                    imageUrl: photoUrl,
                    width: w,
                    height: h,
                  }),
                });
                if (!response.ok) {
                  const payload = await response.json().catch(() => ({}));
                  throw new Error(
                    (payload as { error?: string }).error || "Share failed."
                  );
                }
                toast.success("Photo shared as a new post.");
                onClose();
              } catch (error) {
                notifyError(error);
              } finally {
                setSharing(false);
              }
            })();
          }}
          aria-label="Share photo as post"
        >
          <Share2 size={16} />
          {sharing ? "Sharing…" : "Share as post"}
        </button>
      )}
      {engagementVideo ? (
        <PhotoLightboxActions video={engagementVideo} />
      ) : null}
    </div>
  );
}

function PhotoLightboxActions({ video }: { video: VideoRecord }) {
  const auth = useAuth();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [bookmarked, setBookmarked] = useState(video.viewerBookmarked ?? false);
  const bookmarkMutation = trpc.videos.bookmark.useMutation();
  const { current, react, pending } = useOptimisticEngagement(video);
  const toggleBookmark = async () => {
    if (!auth.isAuthenticated) return auth.openAuth();
    if (bookmarkMutation.isPending) return;
    try {
      const result = await bookmarkMutation.mutateAsync({ videoId: video.id });
      setBookmarked(result.viewerBookmarked);
    } catch (error) {
      notifyError(error);
    }
  };
  return (
    <>
      <div
        className="feed-photo-lightbox-actions"
        onClick={event => event.stopPropagation()}
        aria-label="Photo actions"
      >
        <button type="button" onClick={() => void react()} disabled={!!pending} aria-pressed={current.viewerReacted}>
          <Heart size={17} fill={current.viewerReacted ? "currentColor" : "none"} />
          <span>Pookie {formatCount(current.reactionCount)}</span>
        </button>
        <button type="button" onClick={() => {
          if (!auth.isAuthenticated) return auth.openAuth();
          setCommentsOpen(true);
        }}>
          <MessageCircle size={17} />
          <span>Comment {formatCount(current.commentCount)}</span>
        </button>
        <button type="button" className={bookmarked ? "is-active" : ""} onClick={() => void toggleBookmark()}>
          <Bookmark size={17} fill={bookmarked ? "currentColor" : "none"} />
          <span>{bookmarked ? "Saved" : "Save"}</span>
        </button>
      </div>
      <CommentDrawer
        postId={video.id}
        postOwnerId={video.owner.id}
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
      />
    </>
  );
}

function HomeFeedPanel({
  tab,
  active = true,
  showDetailsOverlay = true,
  showHeader = true,
  onOpenShort,
  onOpenShortVideo,
  onOpenPhoto,
  onOpenVideo,
  onBrowseForYou,
}: {
  tab: Exclude<HomeTab, "spotlight">;
  active?: boolean;
  showDetailsOverlay?: boolean;
  showHeader?: boolean;
  onOpenShort?: (videoId: number) => void;
  onOpenShortVideo?: (video: VideoRecord) => void;
  onOpenPhoto?: (video: VideoRecord) => void;
  onOpenVideo?: (video: VideoRecord) => void;
  onBrowseForYou?: () => void;
}) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const useForYouPlayer = tab === "videos";
  const query = trpc.home.feed.useQuery(
    { tab },
    {
      enabled: tab !== "following" || auth.isAuthenticated,
      retry: 1,
      throwOnError: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );
  const followingQuery = trpc.home.feed.useQuery(
    { tab: "following" },
    {
      enabled: useForYouPlayer && auth.isAuthenticated,
      retry: 1,
      throwOnError: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );
  const videos = (query.data ?? []) as VideoRecord[];
  const followingVideos = (followingQuery.data ?? []) as VideoRecord[];
  // Pull-to-refresh: drag down from the very top of the feed, release past
  // the threshold to refetch. Purely additive — no change to query config.
  const pullStartYRef = useRef<number | null>(null);
  const [pullY, setPullY] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const handleFeedTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (window.scrollY <= 0 && !query.isPending && !query.isFetching && !pullRefreshing) {
      pullStartYRef.current = event.touches[0].clientY;
    }
  };
  const handleFeedTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    if (pullStartYRef.current == null) return;
    const dy = event.touches[0].clientY - pullStartYRef.current;
    if (dy > 0 && window.scrollY <= 0) {
      setPullY(Math.min(dy * 0.5, 110));
    } else {
      pullStartYRef.current = null;
      setPullY(0);
    }
  };
  const handleFeedTouchEnd = () => {
    if (pullStartYRef.current == null) return;
    pullStartYRef.current = null;
    if (pullY >= 45) {
      setPullRefreshing(true);
      void query
        .refetch()
        .finally(() => {
          setPullRefreshing(false);
          setPullY(0);
        });
    } else {
      setPullY(0);
    }
  };
  const trending = trpc.hashtag.trending.useQuery({}, { staleTime: 60_000, refetchOnWindowFocus: false });
  const toggleTrendingFollow = trpc.hashtag.toggleFollow.useMutation({ onSuccess: () => void trending.refetch() });
  const newestUpdates = useForYouPlayer
    ? followingVideos.slice(0, 6).map(video => ({
        id: video.id,
        user: {
          name: displayName(video.owner.name, video.owner.username),
          avatar: video.owner.photoUrl
            ? resolveMediaUrl(video.owner.photoUrl, "avatars")
            : undefined,
        },
        timeAgo: relativeTime(video.createdAt),
        type:
          video.mediaType === "IMAGE"
            ? "photo"
            : video.mediaType === "VIDEO"
              ? "video"
              : "text",
        text: postCaption(video.title, video.description),
        thumb:
          video.mediaType === "TEXT"
            ? undefined
            : resolveMediaUrl(video.thumbnailUrl || video.videoUrl),
        unseen: false,
        source: video,
      }))
    : [];
  const shortsHighlights = useForYouPlayer
    ? videos
        .filter(video => video.kind === "SHORT")
        .slice(0, 8)
        .map(video => ({
          id: video.id,
          title: video.title || postCaption(video.title, video.description),
          thumb: resolveMediaUrl(video.thumbnailUrl || video.videoUrl),
          likes: video.reactionCount,
          comments: video.commentCount,
          source: video,
        }))
    : [];
  const shortsInsertionAfter = useMemo(() => {
    if (!useForYouPlayer || !shortsHighlights.length) return null;
    return 8 + Math.floor(Math.random() * 3);
  }, [useForYouPlayer, shortsHighlights.length]);
  const openForYouItem = (item: { source?: VideoRecord }) => {
    const video = item.source;
    if (!video) return;
    if (video.kind === "SHORT" && onOpenShortVideo) return onOpenShortVideo(video);
    if (video.mediaType === "IMAGE" && onOpenPhoto) return onOpenPhoto(video);
    if (video.mediaType === "VIDEO" && onOpenVideo) return onOpenVideo(video);
  };
  const openNewestUpdate = (item: { source?: VideoRecord }) => {
    const video = item.source;
    if (!video?.owner?.id) return;
    window.history.pushState(
      {},
      "",
      `/profile/${video.owner.id}#post-${video.id}`
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  const forYouVideoRenderer = useForYouPlayer
    ? (v: VideoRecord, a: boolean, onFirstPlay: () => void) => (
        <ForYouVideoPlayer video={v} active={a} onFirstPlay={onFirstPlay} />
      )
    : undefined;
  return (
    <section
      className="media-section home-feed-section w-full max-w-full overflow-hidden box-border"
      aria-labelledby="home-feed-heading"
      onTouchStart={handleFeedTouchStart}
      onTouchMove={handleFeedTouchMove}
      onTouchEnd={handleFeedTouchEnd}
    >
      <div
        className="feed-pull-indicator"
        style={{ height: pullRefreshing ? 46 : pullY }}
        aria-hidden={pullY <= 8 && !pullRefreshing}
      >
        <RotateCcw size={18} className={pullRefreshing ? "spin" : undefined} />
        <span>
          {pullRefreshing ? "Refreshing…" : pullY >= 45 ? "Release to refresh" : "Pull to refresh"}
        </span>
      </div>
      {showHeader && (
        <div className="media-section-heading">
          <div>
            <p className="eyebrow">
              {tabOptions.find(option => option.id === tab)?.caption}
            </p>
            <h2 id="home-feed-heading">
              {tab === "icons"
                ? "Signals from trusted voices."
                : tab === "following"
                  ? "Your following, in motion."
                  : tab === "trendy"
                    ? "What the network is watching."
                    : "Watch what matters."}
            </h2>
          </div>
          <span>
            {tab === "icons"
              ? "Verified creators & companies"
              : "Real-time database feed"}
          </span>
        </div>
      )}
      {useForYouPlayer && (newestUpdates.length > 0 || shortsHighlights.length > 0) && (
        <div className="kf" aria-label="For You highlights">
          <NewestUpdates
            items={newestUpdates}
            onOpen={openNewestUpdate}
            onViewAll={() => undefined}
          />
        </div>
      )}
      {tab === "videos" && trending.data?.length ? (
        <div className="trending-topics" aria-label="Trending now">
          <strong>Trending now</strong>
          <div className="trending-topics__list">
            {trending.data.slice(0, 6).map(topic => (
              <button key={topic.id} type="button" className="trending-topic" onClick={() => void toggleTrendingFollow.mutateAsync({ tag: topic.tag })}>
                <span>#{topic.displayTag || topic.tag}</span>
                <small>{topic.postCount} posts · {topic.following ? "Following" : "Follow"}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {query.isError ? (
        <FeedRecovery onRetry={() => void query.refetch()} />
      ) : tab === "following" && !auth.isAuthenticated ? (
        <div className="media-empty feed-empty-state" role="status">
          <Play size={18} />
          <h3>Sign in to see Following.</h3>
          <p>Follow creators to see their new posts here.</p>
          <button type="button" className="primary-btn" onClick={auth.openAuth}>
            Sign in or create an account
          </button>
        </div>
      ) : query.isPending ? (
        <FeedSkeleton />
      ) : videos.length ? (
        <div className="unified-feed-list feed-video-list feed-card-list gap-6 w-full max-w-full box-border">
          {videos.map((video, index) => (
            <Fragment key={video.id}>
              <MemoVideoCard
                video={video}
                active={active}
                showDetailsOverlay={showDetailsOverlay}
                socialLayout
                renderVideo={
                  useForYouPlayer && video.mediaType === "VIDEO"
                    ? forYouVideoRenderer
                    : undefined
                }
                onOpenViewer={
                  video.kind === "SHORT" && onOpenShortVideo
                    ? () => onOpenShortVideo(video)
                    : video.kind === "SHORT" && onOpenShort
                      ? () => onOpenShort(video.id)
                      : video.mediaType === "IMAGE" && onOpenPhoto
                        ? () => onOpenPhoto(video)
                        : video.mediaType === "VIDEO" && onOpenVideo
                          ? () => onOpenVideo(video)
                          : undefined
                }
              />
              {shortsInsertionAfter !== null &&
                index + 1 === shortsInsertionAfter && (
                  <ShortsRow
                    items={shortsHighlights}
                    onOpen={openForYouItem}
                    onSeeAll={() => {
                      const firstShort = shortsHighlights[0]?.source;
                      if (firstShort && onOpenShortVideo) onOpenShortVideo(firstShort);
                    }}
                  />
                )}
            </Fragment>
          ))}
        </div>
      ) : (
        <div className="media-empty feed-empty-state">
          <Play size={18} />
          <h3>
            {tab === "following"
              ? "No posts from people you follow yet."
              : tab === "trendy"
                ? "No trending posts yet."
                : tab === "icons"
                  ? "No trusted-voice posts yet."
                  : "No posts to show yet."}
          </h3>
          {tab === "following" ? (
            <>
              <p>Follow creators from their profiles, or explore public posts in For You.</p>
              {onBrowseForYou ? (
                <button type="button" className="primary-btn" onClick={onBrowseForYou}>
                  Explore For You
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
function ShortVideoCard({
  video,
  index,
  active,
  compact = false,
  preload = "none",
  onOpenViewer,
}: {
  video: VideoRecord;
  index: number;
  active: boolean;
  compact?: boolean;
  preload?: "none" | "metadata" | "auto";
  onOpenViewer?: () => void;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [description, setDescription] = useState(video.description);
  const [deleted, setDeleted] = useState(false);
  const [shortMuted, setShortMuted] = useState(readShortsMutePreference);
  const auth = useAuth();
  const viewMutation = trpc.videos.view.useMutation();
  const viewedRef = useRef(false);
  const [bookmarked, setBookmarked] = useState(video.viewerBookmarked ?? false);
  const bookmarkMutation = trpc.videos.bookmark.useMutation();
  const toggleBookmark = async () => {
    if (!auth.isAuthenticated) return auth.openAuth();
    if (bookmarkMutation.isPending) return;
    try {
      const engagement = await bookmarkMutation.mutateAsync({
        videoId: video.id,
      });
      setBookmarked(engagement.viewerBookmarked);
    } catch (error) {
      notifyError(error);
    }
  };
  const { current, react, share, pending } = useOptimisticEngagement(video);
  const setMutePreference = (muted: boolean) => {
    setShortMuted(muted);
    writeShortsMutePreference(muted);
  };
  const recordView = () => {
    if (viewedRef.current || viewMutation.isPending) return;
    viewedRef.current = true;
    void viewMutation.mutateAsync({ videoId: video.id }).catch(() => {
      viewedRef.current = false;
    });
  };
  if (deleted) return null;
  return (
    <article
      className={`short-card feed-card-item${compact ? " short-card--compact" : ""} snap-start h-[100dvh] w-full relative overflow-hidden box-border`}
      data-short-index={index}
      aria-current={active ? "true" : undefined}
      aria-label={`${displayName(video.owner.name, video.owner.username)} Short ${index + 1}`}
      role={onOpenViewer ? "button" : undefined}
      tabIndex={onOpenViewer ? 0 : undefined}
      onClick={event => {
        if (!onOpenViewer) return;
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest("button, a, input, textarea, select")
        )
          return;
        onOpenViewer();
      }}
      onKeyDown={event => {
        if (!onOpenViewer || (event.key !== "Enter" && event.key !== " "))
          return;
        event.preventDefault();
        onOpenViewer();
      }}
    >
      {video.mediaType === "IMAGE" ? (
        <img
          src={resolveMediaUrl(video.videoUrl)}
          className="w-full h-auto object-contain"
          alt={video.title || "Post"}
        />
      ) : (
        <QualityVideoPlayer
          video={video}
          vertical
          active={active}
          preload={preload}
          muted={shortMuted}
          onMutedChange={setMutePreference}
          onFirstPlay={recordView}
        />
      )}
      <div className="absolute right-3 top-4 z-20">
        <PostManagementMenu
          video={video}
          onUpdated={setDescription}
          onDeleted={() => setDeleted(true)}
        />
      </div>
      <div className="short-overlay">
        <div className="short-overlay-details">
          <div className="media-owner">
            <a
              className="profile-link"
              href={`/profile/${video.owner.id}`}
              onClick={event => navigateToProfile(event, video.owner.id)}
              aria-label={`Open ${displayName(video.owner.name, video.owner.username)} profile`}
            >
              <div className="video-owner-identity">
                <div className="video-owner-avatar">
                  {video.owner.photoUrl ? (
                    <img
                      src={resolveMediaUrl(video.owner.photoUrl, "avatars")}
                      alt=""
                    />
                  ) : (
                    <UserRound size={16} />
                  )}
                </div>
                <div>
                  <strong className="video-owner-name">
                    <span>
                      {displayName(video.owner.name, video.owner.username)}
                    </span>
                    {video.owner.isVerified && (
                      <BadgeCheck
                        className="verified-badge"
                        size={14}
                        aria-label="Verified profile"
                      />
                    )}
                    {video.campaignId != null && <SponsoredBadge dark />}
                  </strong>
                  <span>
                    {ownerHandle(video.owner.name, video.owner.username)}
                  </span>
                </div>
              </div>
            </a>
          </div>
          <Caption text={postCaption(video.title, description)} maxLines={3} className="short-caption" />
          <p className="media-caption-tags">
            {hashtagsFromDescription(video.description)}
          </p>
          <p className="media-sound-track">
            <Volume2 size={14} aria-hidden="true" /> Original sound
          </p>
        </div>
        <div className="shorts-overlay-actions">
          <EngagementActions
            engagement={current}
            videoId={video.id}
            onReact={react}
            onShare={share}
            onComments={() => {
              if (!auth.isAuthenticated) return auth.openAuth();
              setCommentsOpen(value => !value);
            }}
            pending={pending}
            overlay={!compact}
            feedStyle={compact}
            bookmarked={bookmarked}
            onBookmark={toggleBookmark}
            owner={video.owner}
            shorts={true}
          />
          <button
            type="button"
            className="shorts-mute-btn"
            data-short-no-swipe
            onClick={e => {
              e.stopPropagation();
              setMutePreference(!shortMuted);
            }}
            aria-label={shortMuted ? "Unmute video" : "Mute video"}
          >
            {shortMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>
      <CommentDrawer
        postId={video.id}
        postOwnerId={video.owner.id}
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
      />
    </article>
  );
}

const MemoShortVideoCard = memo(ShortVideoCard);

type ShortsMode = "for-you" | "popular";

export function ShortsFeed({
  active = true,
  initialVideoId,
  viewerMode = false,
  standaloneVideo,
  source,
  onBack,
}: {
  active?: boolean;
  initialVideoId?: number;
  viewerMode?: boolean;
  standaloneVideo?: VideoRecord;
  source?: "videos" | "profile" | "search";
  onBack?: () => void;
}) {
  const query = trpc.home.feed.useQuery(
    { tab: "shorts" },
    {
      retry: 1,
      throwOnError: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    tracking: boolean;
  } | null>(null);
  const gestureLockRef = useRef(false);
  const gestureUnlockTimerRef = useRef<number | null>(null);
  const activeIndexRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [shortsMode, setShortsMode] = useState<ShortsMode>("for-you");
  const rawVideos = (query.data ?? []) as VideoRecord[];
  const filteredVideos = useMemo(() => {
    if (shortsMode === "for-you") return rawVideos;
    return [...rawVideos].sort(
      (left, right) =>
        right.reactionCount + right.viewCount - (left.reactionCount + left.viewCount)
    );
  }, [rawVideos, shortsMode]);
  const videos = useMemo(() => {
    if (!standaloneVideo || !initialVideoId) return filteredVideos;
    if (filteredVideos.some(v => v.id === initialVideoId)) return filteredVideos;
    return [standaloneVideo, ...filteredVideos];
  }, [filteredVideos, standaloneVideo, initialVideoId]);
  useEffect(() => {
    if (initialVideoId === undefined || !videos.length) return;
    const nextIndex = Math.max(
      0,
      videos.findIndex(video => video.id === initialVideoId)
    );
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
    requestAnimationFrame(() => {
      viewportRef.current
        ?.querySelector<HTMLElement>(`[data-short-index="${nextIndex}"]`)
        ?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }, [initialVideoId, videos.length]);
  useEffect(() => {
    activeIndexRef.current = 0;
    setActiveIndex(0);
    requestAnimationFrame(() =>
      viewportRef.current?.scrollTo({ top: 0, behavior: "auto" })
    );
  }, [shortsMode]);
  const goTo = (index: number, behavior: ScrollBehavior = "smooth") => {
    const viewport = viewportRef.current;
    const clamped = Math.max(
      0,
      Math.min(index, Math.max(videos.length - 1, 0))
    );
    const card = viewport?.querySelector<HTMLElement>(
      `[data-short-index="${clamped}"]`
    );
    if (viewport && card) {
      viewport.scrollTo({ top: card.offsetTop, behavior });
    }
    activeIndexRef.current = clamped;
    setActiveIndex(clamped);
  };
  const onViewportKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      goTo(activeIndexRef.current + 1);
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      goTo(activeIndexRef.current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      goTo(0, "auto");
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(videos.length - 1, "auto");
    }
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        "button, a, input, textarea, select, [data-short-no-swipe]"
      )
    )
      return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      tracking: true,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY)) {
      gesture.tracking = false;
      return;
    }
    if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
      gesture.tracking = true;
    }
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!gesture || gesture.pointerId !== event.pointerId || !gesture.tracking)
      return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const isVerticalSwipe =
      Math.abs(deltaY) >= 56 && Math.abs(deltaY) > Math.abs(deltaX) * 1.15;
    if (!isVerticalSwipe || gestureLockRef.current) return;
    event.preventDefault();
    gestureLockRef.current = true;
    goTo(activeIndexRef.current + (deltaY < 0 ? 1 : -1));
    if (gestureUnlockTimerRef.current !== null)
      window.clearTimeout(gestureUnlockTimerRef.current);
    gestureUnlockTimerRef.current = window.setTimeout(() => {
      gestureLockRef.current = false;
      gestureUnlockTimerRef.current = null;
    }, 650);
  };
  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    gestureRef.current = null;
  };
  useEffect(
    () => () => {
      if (gestureUnlockTimerRef.current !== null)
        window.clearTimeout(gestureUnlockTimerRef.current);
    },
    []
  );
  const onScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport || gestureLockRef.current) return;
    const cards = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-short-index]")
    );
    const count = Math.max(videos.length, 1);
    const step = viewport.scrollHeight / count;
    const indexFromScroll = Math.max(
      0,
      Math.min(
        Math.round(viewport.scrollTop / Math.max(step, 1)),
        Math.max(videos.length - 1, 0)
      )
    );
    activeIndexRef.current = indexFromScroll;
    setActiveIndex(indexFromScroll);
    if (!cards.length) return;
    const nextIndex = cards.reduce(
      (closest, card, index) =>
        Math.abs(card.offsetTop - viewport.scrollTop) <
        Math.abs(cards[closest].offsetTop - viewport.scrollTop)
          ? index
          : closest,
      0
    );
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
  };
  return (
    <section
      className={`media-section shorts-section shorts-surface ${viewerMode ? "shorts-detail-feed" : "shorts-list-feed"} w-full max-w-full overflow-hidden box-border`}
      aria-labelledby="shorts-heading"
    >
      {!viewerMode && (
        <div className="media-section-heading shorts-header">
          <div>
            {onBack ? (
              <button
                type="button"
                className="shorts-back-btn"
                onClick={onBack}
                aria-label="Go back"
              >
                <ChevronLeft size={20} />
                <span>Back</span>
              </button>
            ) : (
              <h2 id="shorts-heading">Shorts</h2>
            )}
          </div>
          <div
            className="shorts-discovery-controls"
            role="tablist"
            aria-label="Shorts discovery"
          >
            <button
              type="button"
              role="tab"
              aria-selected={shortsMode === "for-you"}
              aria-controls="shorts-viewport"
              tabIndex={shortsMode === "for-you" ? 0 : -1}
              className={shortsMode === "for-you" ? "is-active" : undefined}
              onClick={() => setShortsMode("for-you")}
            >
              For You
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={shortsMode === "popular"}
              aria-controls="shorts-viewport"
              tabIndex={shortsMode === "popular" ? 0 : -1}
              className={shortsMode === "popular" ? "is-active" : undefined}
              onClick={() => setShortsMode("popular")}
            >
              Popular
            </button>
          </div>
        </div>
      )}
      {query.isError ? (
        <FeedRecovery onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <FeedSkeleton short />
      ) : videos.length ? (
        <div
          id="shorts-viewport"
          tabIndex={0}
          aria-label="Shorts video feed. Use up and down arrow keys to navigate."
          onKeyDown={onViewportKeyDown}
          className={`shorts-viewport ${viewerMode ? "shorts-detail-viewport" : "shorts-list-viewport"} media-feed-scroll overflow-y-scroll snap-y snap-mandatory bg-black w-full max-w-full box-border relative`}
          ref={viewportRef}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {videos.map((video, index) => (
            <MemoShortVideoCard
              key={video.id}
              video={video}
              index={index}
              active={active && index === activeIndex}
              preload={index === activeIndex + 1 ? "metadata" : "none"}
            />
          ))}
        </div>
      ) : (
        <div className="media-empty feed-empty-state">
          <Play size={18} />
          <h3>
            {shortsMode === "popular"
              ? "No popular Shorts to show yet."
              : "No Shorts to show yet."}
          </h3>
          <p>Check back soon for new vertical videos.</p>
          {onBack && (
            <button type="button" className="primary-btn" onClick={onBack}>
              Browse videos
            </button>
          )}
        </div>
      )}
    </section>
  );
}
function AnnouncementComposer({ onCreated }: { onCreated: () => void }) {
  const [body, setBody] = useState("");
  const [images, setImages] = useState<ImageSelection[]>([]);
  const [video, setVideo] = useState<AnnouncementVideoSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const createAnnouncement = trpc.community.create.useMutation();
  const clearImages = () => {
    images.forEach(image => URL.revokeObjectURL(image.previewUrl));
    setImages([]);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };
  const clearVideo = () => {
    if (video) URL.revokeObjectURL(video.previewUrl);
    setVideo(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
  };
  const chooseImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length + images.length > 10) {
      toast.error("Choose up to 10 images for one announcement.");
      return;
    }
    try {
      files.forEach(validateImageFile);
      setImages(current => [
        ...current,
        ...files.map(file => ({ file, previewUrl: URL.createObjectURL(file) })),
      ]);
    } catch (error) {
      notifyError(error);
    }
  };
  const chooseVideo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const metadata = await getVideoMetadata(file, {
        maxDurationSeconds: MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS,
      });
      clearVideo();
      setVideo({ file, previewUrl: URL.createObjectURL(file), metadata });
    } catch (error) {
      notifyError(error);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!body.trim() && !images.length && !video) {
      toast.error("Add text, an image, or a video first.");
      return;
    }
    setBusy(true);
    try {
      const uploadedImages = await Promise.all(
        images.map(async (image, index) => ({
          mediaType: "IMAGE" as const,
          mediaUrl: await uploadImage("post", image.file),
          sortOrder: index,
          width: null,
          height: null,
          durationSeconds: null,
        }))
      );
      const uploadedVideo = video
        ? [
            {
              mediaType: "VIDEO" as const,
              mediaUrl: await uploadVideo(video.file, "ANNOUNCEMENT"),
              sortOrder: images.length,
              width: video.metadata.width,
              height: video.metadata.height,
              durationSeconds: video.metadata.durationSeconds,
            },
          ]
        : [];
      await createAnnouncement.mutateAsync({
        body: body.trim(),
        attachments: [...uploadedImages, ...uploadedVideo],
      });
      clearImages();
      clearVideo();
      setBody("");
      onCreated();
      toast.success("Community announcement published.");
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Publish failed.";
      if (msg.includes("verified") || msg.includes("Only")) {
        console.warn("[Announcement] Server rejected:", msg);
        toast.error(msg + " Check your verification status on your profile.");
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="announcement-composer" onSubmit={submit}>
      <label>
        Announcement
        <textarea
          value={body}
          onChange={event => setBody(event.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Share an official update with your community"
        />
      </label>
      <div className="announcement-picker-row">
        <button
          type="button"
          className="secondary-media-btn"
          onClick={() => imageInputRef.current?.click()}
        >
          Add images · {images.length}/10
        </button>
        <button
          type="button"
          className="secondary-media-btn"
          onClick={() => videoInputRef.current?.click()}
        >
          Add video · 5 min max
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={chooseImages}
          className="sr-only"
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          onChange={chooseVideo}
          className="sr-only"
        />
      </div>
      {images.length || video ? (
        <div className="announcement-selection">
          {images.map(image => (
            <img
              key={image.previewUrl}
              src={image.previewUrl}
              alt="Announcement preview"
            />
          ))}
          {video && (
            <video
              src={video.previewUrl}
              controls
              controlsList="nofullscreen noplaybackrate"
              disablePictureInPicture
              muted
              playsInline
            />
          )}
          <button
            type="button"
            className="muted-btn"
            onClick={() => {
              clearImages();
              clearVideo();
            }}
          >
            Clear media
          </button>
        </div>
      ) : null}
      <p className="media-form-hint">
        Verified creators and companies can combine up to 10 images with one
        video.
      </p>
      <button className="primary-btn" type="submit" disabled={busy}>
        {busy ? (
          <Loader2 className="spin" size={16} />
        ) : (
          <Megaphone size={16} />
        )}{" "}
        {busy ? "Publishing" : "Publish announcement"}
      </button>
    </form>
  );
}
function AnnouncementComments({
  announcementId,
  commentCount = 0,
}: {
  announcementId: number;
  commentCount?: number;
}) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sort, setSort] = useState<"new" | "top">("new");
  const [limit, setLimit] = useState(20);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const commentsQuery = trpc.community.comments.list.useQuery(
    { announcementId, sort, limit },
    { enabled: open, refetchOnWindowFocus: false, placeholderData: keepPreviousData }
  );
  const createComment = trpc.community.comments.create.useMutation();
  const editComment = trpc.community.comments.edit.useMutation();
  const pinComment = trpc.community.comments.pin.useMutation();
  const likeComment = trpc.community.comments.like.useMutation();
  const visibleCount = commentsQuery.data?.length ?? commentCount;
  const refresh = async () => {
    await Promise.all([
      commentsQuery.refetch(),
      utils.community.list.invalidate(),
    ]);
  };
  const submitComment = async (audioUrl: string | null, audioDuration: number | null) => {
    if (!auth.isAuthenticated) return auth.openAuth();
    await createComment.mutateAsync({
      announcementId,
      body: body.trim(),
      audioUrl,
      audioDuration,
      parentId: replyTo,
    });
    setBody("");
    setReplyTo(null);
    await refresh();
  };
  const saveEdit = async () => {
    if (!editing) return;
    await editComment.mutateAsync({ commentId: editing.id, body: editing.body });
    setEditing(null);
    await refresh();
  };
  return (
    <div className="announcement-comments">
      <button
        type="button"
        className={`announcement-comment-toggle${open ? " is-active" : ""}`}
        onClick={() => {
          if (!auth.isAuthenticated) return auth.openAuth();
          setOpen(value => !value);
        }}
        aria-expanded={open}
      >
        <MessageCircle size={16} /> Comment <strong>{formatCount(visibleCount)}</strong>
      </button>
      {open && (
        <div className="announcement-comments__panel" aria-live="polite">
          <div className="comment-sort-row">
            <button type="button" className={sort === "new" ? "is-active" : ""} onClick={() => { setSort("new"); setLimit(20); }}>Newest</button>
            <button type="button" className={sort === "top" ? "is-active" : ""} onClick={() => { setSort("top"); setLimit(20); }}>Top</button>
          </div>
          {commentsQuery.isPending ? <div className="comment-loading">Loading comments…</div> : commentsQuery.isError ? <div className="comment-loading">Comments are temporarily unavailable.</div> : commentsQuery.data?.length ? commentsQuery.data.map(comment => (
            <div className="video-comment" key={comment.id}>
              <a className="profile-link" href={`/profile/${comment.author.id}`} onClick={event => navigateToProfile(event, comment.author.id)}>
                <strong>{displayName(comment.author.name, comment.author.username)}</strong>
              </a>
              {comment.author.isCreator && <span className="conv-badge conv-badge--creator">Creator</span>}
              {comment.isPinned && <span className="comment-pin-label"><Pin size={12} /> Pinned</span>}
              {comment.isEdited && <span className="conv-comment-time">edited</span>}
              {editing?.id === comment.id ? (
                <div className="comment-edit-box">
                  <input value={editing.body} maxLength={500} onChange={event => setEditing({ ...editing, body: event.target.value })} />
                  <button type="button" onClick={() => void saveEdit()} disabled={editComment.isPending}>Save</button>
                  <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : comment.body ? <span><MentionText text={comment.body} /></span> : null}
              {comment.audioUrl && <CommentAudioPlayer src={comment.audioUrl} duration={comment.audioDuration} />}
              <div className="comment-row-actions">
                <button type="button" onClick={() => void likeComment.mutateAsync({ commentId: comment.id }).then(refresh)}>{comment.viewerLiked ? "Pookied" : "Pookie"} {formatCount(comment.likeCount)}</button>
                <button type="button" onClick={() => { setReplyTo(comment.id); setExpanded(comment.id); }}>Reply {comment.replyCount ? `(${comment.replyCount})` : ""}</button>
                {auth.user?.id === comment.author.id && <button type="button" onClick={() => setEditing({ id: comment.id, body: comment.body ?? "" })}><Pencil size={12} /> Edit</button>}
                {auth.user?.id === comment.postOwnerId && <button type="button" onClick={() => void pinComment.mutateAsync({ commentId: comment.id, pinned: !comment.isPinned }).then(refresh)}>{comment.isPinned ? "Unpin" : "Pin"}</button>}
              </div>
              {expanded === comment.id && comment.replyCount > 0 && <CommunityCommentReplies announcementId={announcementId} parentId={comment.id} />}
            </div>
          )) : <div className="comment-loading">No comments yet. Start the conversation.</div>}
          {commentsQuery.data && commentsQuery.data.length >= limit && limit < 200 && <button type="button" className="comment-load-more" onClick={() => setLimit(value => Math.min(200, value + 20))}>Load more comments</button>}
          <VoiceCommentComposer body={body} onBodyChange={setBody} onSend={submitComment} disabled={createComment.isPending} placeholder={auth.isAuthenticated ? (replyTo ? "Write a reply…" : "Write a comment…") : "Sign in to comment"} />
        </div>
      )}
    </div>
  );
}
function CommunityCommentReplies({ announcementId, parentId }: { announcementId: number; parentId: number }) {
  const query = trpc.community.comments.list.useQuery({ announcementId, parentId, limit: 50 }, { refetchOnWindowFocus: false });
  if (query.isPending) return <div className="comment-loading">Loading replies…</div>;
  return <div className="comment-replies">{query.data?.map(reply => <div className="video-comment" key={reply.id}><strong>{displayName(reply.author.name, reply.author.username)}</strong>{reply.body && <span><MentionText text={reply.body} /></span>}{reply.audioUrl && <CommentAudioPlayer src={reply.audioUrl} duration={reply.audioDuration} />}</div>)}</div>;
}
function AnnouncementManagementMenu({
  announcement,
}: {
  announcement: { id: number; body: string; author: { id: number } };
}) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [body, setBody] = useState(announcement.body);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const updateMutation = trpc.community.update.useMutation();
  const deleteMutation = trpc.community.delete.useMutation();

  const refreshFeed = async () => {
    await Promise.all([
      utils.community.list.invalidate(),
      utils.community.mine.invalidate(),
    ]);
  };

  const saveBody = async () => {
    try {
      await updateMutation.mutateAsync({
        announcementId: announcement.id,
        body: body.trim(),
      });
      await refreshFeed();
      setEditing(false);
      setOpen(false);
      toast.success("Announcement updated.");
    } catch (error) {
      notifyError(error);
    }
  };

  const removeAnnouncement = async () => {
    try {
      await deleteMutation.mutateAsync({ announcementId: announcement.id });
      await refreshFeed();
      setConfirming(false);
      setOpen(false);
      toast.success("Announcement deleted.");
    } catch (error) {
      notifyError(error);
    }
  };

  const toggleMenu = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(value => !value);
    setEditing(false);
    setConfirming(false);
  };

  const closeAll = () => {
    setOpen(false);
    setEditing(false);
    setConfirming(false);
  };

  const openEditor = () => {
    setBody(announcement.body);
    setOpen(false);
    setEditing(true);
  };

  useEffect(() => {
    if (!open && !editing && !confirming) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };
    const onClickOutside = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          ".post-management, .post-management__menu, .post-management__dialog"
        )
      )
        return;
      closeAll();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onClickOutside);
    };
  }, [open, editing, confirming]);

  if (auth.user?.id !== announcement.author.id) return null;

  const menuContent =
    open || editing || confirming
      ? createPortal(
          <>
            {open && !editing && !confirming && (
              <div
                className="post-management__menu"
                role="menu"
                style={{
                  position: "fixed",
                  top: menuPos.top,
                  right: menuPos.right,
                  zIndex: 2147483000,
                }}
              >
                <button type="button" onClick={openEditor} role="menuitem">
                  Edit Announcement
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    setOpen(false);
                    setConfirming(true);
                  }}
                  role="menuitem"
                >
                  Delete Announcement
                </button>
              </div>
            )}
            {editing && (
              <div
                className="post-management__dialog"
                role="dialog"
                aria-label="Edit announcement"
                style={{
                  position: "fixed",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  zIndex: 2147483000,
                }}
              >
                <strong>Edit Announcement</strong>
                <textarea
                  value={body}
                  maxLength={5000}
                  onChange={event => setBody(event.target.value)}
                  autoFocus
                />
                <div className="post-management__dialog-actions">
                  <button
                    type="button"
                    onClick={closeAll}
                    disabled={updateMutation.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="is-primary"
                    onClick={() => void saveBody()}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
            {confirming && (
              <div
                className="post-management__dialog"
                role="alertdialog"
                aria-label="Confirm announcement deletion"
                style={{
                  position: "fixed",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  zIndex: 2147483000,
                }}
              >
                <strong>Delete this announcement?</strong>
                <p>
                  This permanently removes the announcement, its attachments,
                  and its comments.
                </p>
                <div className="post-management__dialog-actions">
                  <button type="button" onClick={closeAll} disabled={deleteMutation.isPending}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => void removeAnnouncement()}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            )}
          </>,
          document.body
        )
      : null;

  return (
    <div className="post-management" onClick={event => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className="feed-post-more"
        aria-label="Announcement options"
        onClick={toggleMenu}
      >
        <MoreHorizontal size={18} />
      </button>
      {menuContent}
    </div>
  );
}

function announcementState(row: {
  reactionCount: number;
  viewerReacted: boolean;
  viewerReaction: ReactionType | null;
}): SingleReactionState {
  return {
    reactionCount: row.reactionCount,
    viewerReacted: row.viewerReacted,
    viewerReaction: row.viewerReaction,
  };
}

/**
 * Announcement reactions: a single Pookie/Love reaction — the count pill is
 * the always-available tap target that toggles it, and a long-press opens the
 * reactor list. State lives in the `community.list` cache — nothing is
 * painted that the server did not confirm.
 */
function AnnouncementReactionBar({
  announcement,
}: {
  announcement: {
    id: number;
    reactionCount: number;
    viewerReacted: boolean;
    viewerReaction: ReactionType | null;
  };
}) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const [reactorsOpen, setReactorsOpen] = useState(false);
  const longPress = useLongPress({
    onLongPress: () => setReactorsOpen(true),
  });
  const reactMut = trpc.community.react.useMutation();
  const state = announcementState(announcement);

  const commit = async (type: ReactionType) => {
    if (!auth.isAuthenticated) {
      auth.openAuth();
      return;
    }
    const before = state;
    utils.community.list.setData(undefined, rows =>
      rows?.map(row =>
        row.id === announcement.id
          ? { ...row, ...applySingleReaction(announcementState(row), type) }
          : row
      )
    );
    try {
      const result = await reactMut.mutateAsync({
        announcementId: announcement.id,
        reaction: type,
      });
      utils.community.list.setData(undefined, rows =>
        rows?.map(row =>
          row.id === announcement.id
            ? { ...row, ...adoptSingleReaction(before, type, result) }
            : row
        )
      );
    } catch (error) {
      notifyError(error);
    } finally {
      await utils.community.list.invalidate();
    }
  };

  return (
    <div
      className="announcement-reactions"
      role="group"
      aria-label="Announcement reactions"
      {...longPress}
    >
      <ReactionSummaryPill
        count={state.reactionCount}
        active={state.viewerReaction}
        disabled={reactMut.isPending}
        ariaLabel={
          state.viewerReacted ? "Remove Pookie" : "Pookie this announcement"
        }
        title="Pookie"
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          void commit(tappedReactionType(state.viewerReaction));
        }}
      />
      <ReactorList
        open={reactorsOpen}
        title="Announcement reactions"
        source={{ kind: "community", announcementId: announcement.id }}
        onClose={() => setReactorsOpen(false)}
      />
    </div>
  );
}

export function CommunityAnnouncements() {
  const auth = useAuth();
  const profileQuery = trpc.profile.me.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const query = trpc.community.list.useQuery(undefined, {
    retry: 1,
    throwOnError: false,
    refetchOnWindowFocus: false,
  });
  const canPost = Boolean(
    profileQuery.data?.profile?.isVerified &&
    ["creator", "company"].includes(profileQuery.data.profile.accountType)
  );
  const announcements = query.data ?? [];
  return (
    <section
      className="media-section community-section"
      aria-labelledby="community-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Community announcements</p>
          <h2 id="community-heading">Official word from the network.</h2>
        </div>
        <span>Verified creators & companies</span>
      </div>
      {!auth.isAuthenticated ? (
        <div className="verification-gate">
          <p>Sign in to access verified community announcements.</p>
          <a className="primary-btn" href="/profile">
            Sign in / Get Verified
          </a>
        </div>
      ) : !canPost ? (
        <div className="verification-gate">
          <Megaphone size={18} />
          <h3>Get Verified to publish.</h3>
          <p>
            Verified creators and companies can publish official announcements.
          </p>
          <a className="primary-btn" href="/profile">
            Get Verified
          </a>
        </div>
      ) : (
        <AnnouncementComposer onCreated={() => query.refetch()} />
      )}
      {query.isPending ? (
        <FeedSkeleton />
      ) : announcements.length ? (
        <div className="announcement-list">
          {announcements.map(announcement => (
            <article className="announcement-card" key={announcement.id}>
              <div className="announcement-author">
                <a
                  className="profile-link announcement-author-identity"
                  href={`/profile/${announcement.author.id}`}
                  onClick={event =>
                    navigateToProfile(event, announcement.author.id)
                  }
                  aria-label={`Open ${announcement.author.name ?? "JHILIK organization"} profile`}
                >
                  <div className="announcement-author-avatar">
                    {announcement.author.photoUrl ? (
                      <img
                        src={resolveMediaUrl(
                          announcement.author.photoUrl,
                          "avatars"
                        )}
                        alt=""
                      />
                    ) : (
                      <Megaphone size={16} />
                    )}
                  </div>
                  <div>
                    <strong className="announcement-author-name">
                      <span>
                        {announcement.author.name ?? "JHILIK organization"}
                      </span>
                      <BadgeCheck
                        className="verified-badge"
                        size={14}
                        aria-label="Verified profile"
                      />
                    </strong>
                    <span>{announcement.author.accountType} · verified</span>
                  </div>
                </a>
                <time dateTime={new Date(announcement.createdAt).toISOString()}>
                  {new Date(announcement.createdAt).toLocaleDateString()}
                </time>
                <AnnouncementManagementMenu announcement={announcement} />
              </div>
              {announcement.body && <p>{announcement.body}</p>}
              <div
                className={`announcement-attachments ${announcement.attachments.length > 1 ? "has-grid" : ""}`}
              >
                {announcement.attachments.map(attachment =>
                  attachment.mediaType === "IMAGE" ? (
                    <img
                      key={attachment.id}
                      src={resolveMediaUrl(attachment.mediaUrl)}
                      alt="Community announcement attachment"
                      loading="lazy"
                    />
                  ) : (
                    <video
                      key={attachment.id}
                      src={resolveMediaUrl(attachment.mediaUrl)}
                      controls
                      controlsList="nofullscreen noplaybackrate"
                      disablePictureInPicture
                      playsInline
                      {...({ "webkit-playsinline": "true" } as Record<
                        string,
                        string
                      >)}
                      preload="metadata"
                      crossOrigin="anonymous"
                    />
                  )
                )}
              </div>
              <AnnouncementReactionBar announcement={announcement} />
              <AnnouncementComments
                announcementId={announcement.id}
                commentCount={announcement.commentCount}
              />
            </article>
          ))}
        </div>
      ) : (
        <div className="media-empty">
          <Megaphone size={18} />
          <h3>No announcements yet.</h3>
          <p>Verified creators and companies will appear here.</p>
        </div>
      )}
    </section>
  );
}
export type FeedSection =
  | HomeTab
  | "shorts"
  | "announcements"
  | "publish"
  | "search"
  | "notifications"
  | "settings"
  | "wallet"
  | "qr"
  | "offline"
  | "messages";

export function SearchFeed({
  onOpenVideo,
}: {
  onOpenVideo?: (video: VideoRecord) => void;
} = {}) {
  const [rawTerm, setRawTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedTerm(rawTerm), 300);
    return () => clearTimeout(id);
  }, [rawTerm]);

  const query = trpc.home.searchAll.useQuery(
    { term: debouncedTerm },
    {
      enabled: debouncedTerm.trim().length >= 2,
      retry: 1,
      throwOnError: false,
      refetchOnWindowFocus: false,
    }
  );

  const term = debouncedTerm;
  const hasQuery = term.trim().length >= 2;
  const isLoading = query.isPending && hasQuery;
  const isError = query.isError && hasQuery;
  const data = query.data as
    | { users: SearchUserResult[]; videos: VideoRecord[] }
    | undefined;
  const users = data?.users ?? [];
  const videos = (data?.videos ?? []).filter(
    (v: VideoRecord) => !isReportedLegacyMedia(v)
  );
  const hasResults = users.length > 0 || videos.length > 0;

  return (
    <section
      className="search-section"
      aria-labelledby="search-heading"
    >
      <div className="search-bar-wrapper">
        <div className="search-bar">
          <Search size={18} className="search-bar-icon" />
          <input
            ref={inputRef}
            value={rawTerm}
            onChange={e => setRawTerm(e.target.value)}
            placeholder="Search people, videos, creators..."
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
          />
          {rawTerm && (
            <button
              type="button"
              className="search-bar-clear"
              onClick={() => {
                setRawTerm("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="search-results">
        {!hasQuery && (
          <div className="search-empty-state">
            <Search size={32} strokeWidth={1.5} />
            <h3>Search JHILIK</h3>
            <p>Find creators, videos, and content.</p>
          </div>
        )}

        {hasQuery && rawTerm !== term && (
          <div className="search-loading-hint">
            <Loader2 size={14} className="spin" />
            <span>Searching...</span>
          </div>
        )}

        {isError && (
          <div className="search-empty-state">
            <p>Something went wrong. Try again.</p>
          </div>
        )}

        {hasQuery && !isLoading && !isError && !hasResults && (
          <div className="search-empty-state">
            <p>No results for &ldquo;{term}&rdquo;</p>
            <p className="search-empty-hint">Try different keywords or check spelling.</p>
          </div>
        )}

        {isLoading && (
          <div className="search-skeleton">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="search-skeleton-row">
                <div className="search-skeleton-avatar" />
                <div className="search-skeleton-text">
                  <div className="search-skeleton-line w-[40%]" />
                  <div className="search-skeleton-line w-[25%]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && !isError && users.length > 0 && (
          <div className="search-group">
            <h4 className="search-group-title">People</h4>
            <div className="search-people-list">
              {users.map(user => (
                <SearchUserRow key={user.id} user={user} />
              ))}
            </div>
          </div>
        )}

        {!isLoading && !isError && videos.length > 0 && (
          <div className="search-group">
            <h4 className="search-group-title">Content</h4>
            <div className="search-content-grid">
              {videos.map(video => (
                <SearchVideoCard key={video.id} video={video} onOpenVideo={onOpenVideo} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

type SearchUserResult = {
  id: number;
  name: string | null;
  username: string | null;
  photoUrl: string | null;
  isVerified: boolean;
  followersCount: number;
};

function SearchUserRow({ user }: { user: SearchUserResult }) {
  return (
    <a
      className="search-user-row"
      href={`/profile/${user.id}`}
      onClick={e => navigateToProfile(e, user.id)}
    >
      <div className="search-user-avatar">
        {user.photoUrl ? (
          <img
            src={resolveMediaUrl(user.photoUrl, "avatars")}
            alt=""
            loading="lazy"
          />
        ) : (
          <UserRound size={18} />
        )}
      </div>
      <div className="search-user-info">
        <span className="search-user-name">
          {displayName(user.name, null)}
          {user.isVerified && (
            <BadgeCheck size={14} className="verified-badge" />
          )}
        </span>
        {user.username && (
          <span className="search-user-handle">@{user.username}</span>
        )}
      </div>
      <span className="search-user-followers">
        {formatCount(user.followersCount)} followers
      </span>
    </a>
  );
}

function SearchVideoCard({ video, onOpenVideo }: { video: VideoRecord; onOpenVideo?: (v: VideoRecord) => void }) {
  const openViewer = (event: React.MouseEvent<HTMLElement>) => {
    if (!onOpenVideo) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("a")
    )
      return;
    onOpenVideo(video);
  };

  return (
    <article className="search-video-card">
      <div
        className="search-video-thumb"
        role={onOpenVideo ? "button" : undefined}
        tabIndex={onOpenVideo ? 0 : undefined}
        onClick={openViewer}
        onKeyDown={event => {
          if (!onOpenVideo || (event.key !== "Enter" && event.key !== " "))
            return;
          event.preventDefault();
          onOpenVideo(video);
        }}
      >
        {video.mediaType === "IMAGE" ? (
          <img
            src={isAbsoluteHttpUrl(video.videoUrl) ? video.videoUrl : ""}
            alt={video.title || "Post"}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <InlineVideoPlayer
            video={video}
            active={false}
          />
        )}
      </div>
      <div className="search-video-info">
        <div className="search-video-author">
          <a
            className="search-video-author-link"
            href={`/profile/${video.owner.id}`}
            onClick={e => navigateToProfile(e, video.owner.id)}
          >
            <div className="search-video-author-avatar">
              {video.owner.photoUrl ? (
                <img
                  src={resolveMediaUrl(video.owner.photoUrl, "avatars")}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <UserRound size={14} />
              )}
            </div>
            <span className="search-video-author-name">
              {displayName(video.owner.name, video.owner.username)}
              {video.owner.isVerified && (
                <BadgeCheck size={14} className="verified-badge" />
              )}
            </span>
          </a>
        </div>
        <Caption text={postCaption(video.title, video.description)} maxLines={2} className="search-video-caption" />
        <span className="search-video-meta">
          {formatCount(video.viewCount)} views · {relativeTime(video.createdAt)}
          {video.campaignId != null && (
            <>
              {" · "}
              <SponsoredBadge />
            </>
          )}
        </span>
      </div>
    </article>
  );
}

export default function MediaHub({
  section = "videos",
  onSectionChange,
  showTabs = true,
  initialShortId,
  initialShortVideo,
  onBack,
  onOpenShort,
}: {
  section?: FeedSection;
  onSectionChange?: (section: FeedSection) => void;
  showTabs?: boolean;
  initialShortId?: number;
  initialShortVideo?: VideoRecord;
  onBack?: () => void;
  onOpenShort?: (video: VideoRecord) => void;
}) {
  const [selectedSection, setSelectedSection] = useState<FeedSection>(section);
  const [photoViewer, setPhotoViewer] = useState<VideoRecord | null>(null);

  useEffect(() => {
    setSelectedSection(section);
  }, [section]);

  const activeSection =
    selectedSection === "publish" || selectedSection === "search"
      ? "videos"
      : selectedSection;
  const select = (next: FeedSection) => {
    // Update the visual state immediately, then let the parent synchronize the URL.
    setSelectedSection(next);
    onSectionChange?.(next);
  };
  const focusHighlight = (highlight: SpotlightHighlight) => {
    select("videos");
    window.setTimeout(() => {
      document
        .getElementById(
          highlight.sourceType === "video"
            ? `feed-video-${highlight.postId}`
            : `feed-post-${highlight.postId}`
        )
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  };
  return (
    <div className="media-hub">
      {showTabs && (
        <nav
          className="home-feed-tabs"
          aria-label="Home feed tabs"
          role="tablist"
          onKeyDown={event => {
            const tabButtons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
            );
            const currentIndex = tabButtons.indexOf(event.target as HTMLButtonElement);
            if (currentIndex < 0 || tabButtons.length === 0) return;

            let nextIndex: number;
            if (event.key === "ArrowRight") {
              nextIndex = (currentIndex + 1) % tabButtons.length;
            } else if (event.key === "ArrowLeft") {
              nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
            } else if (event.key === "Home") {
              nextIndex = 0;
            } else if (event.key === "End") {
              nextIndex = tabButtons.length - 1;
            } else {
              return;
            }

            event.preventDefault();
            tabButtons[nextIndex].focus();
            tabButtons[nextIndex].click();
          }}
        >
          {(
            [
              ["videos", "For You"],
              ["following", "Following"],
              ["spotlight", "Spotlight"],
              ["shorts", "Shorts"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={activeSection === id ? "active" : ""}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                select(id);
              }}
              aria-selected={activeSection === id}
              tabIndex={activeSection === id ? 0 : -1}
              role="tab"
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {activeSection === "spotlight" && (
        <div className="media-tab-panel">
          <SpotlightHighlights onSelect={focusHighlight} />
        </div>
      )}
      {activeSection === "videos" && (
        <div className="media-tab-panel">
          <ErrorBoundary fallback={<FeedRecovery />}>
            <HomeFeedPanel
              tab="videos"
              active
              showDetailsOverlay={false}
              showHeader={false}
              onOpenShort={(id) => { select("shorts"); }}
              onOpenShortVideo={(v) => {
                if (onOpenShort) onOpenShort(v);
                select("shorts");
              }}
              onOpenPhoto={setPhotoViewer}
              onOpenVideo={(v) => {
                if (onOpenShort) onOpenShort(v);
                select("shorts");
              }}
            />
          </ErrorBoundary>
        </div>
      )}
      {activeSection === "following" && (
        <div className="media-tab-panel">
          <ErrorBoundary fallback={<FeedRecovery />}>
            <HomeFeedPanel
              tab="following"
              active
              showDetailsOverlay={false}
              showHeader={false}
              onBrowseForYou={() => select("videos")}
              onOpenPhoto={setPhotoViewer}
              onOpenVideo={video => {
                if (onOpenShort) onOpenShort(video);
                select("shorts");
              }}
              onOpenShortVideo={video => {
                if (onOpenShort) onOpenShort(video);
                select("shorts");
              }}
            />
          </ErrorBoundary>
        </div>
      )}
      {activeSection === "shorts" && (
        <div className="media-tab-panel shorts-tab-panel">
          <ErrorBoundary fallback={<FeedRecovery />}>
            <ShortsFeed
              active
              initialVideoId={initialShortId}
              standaloneVideo={initialShortVideo}
              source={initialShortId ? "videos" : undefined}
              onBack={onBack}
            />
          </ErrorBoundary>
        </div>
      )}

      {activeSection === "announcements" && <CommunityAnnouncements />}
      {photoViewer && (
        <FeedPhotoLightbox
          imageUrl={photoViewer.videoUrl}
          attachments={(photoViewer.gallery ?? []).map((image, imageIndex) => ({
            id: imageIndex,
            mediaType: "IMAGE" as const,
            mediaUrl: image.url,
            sortOrder: imageIndex,
            width: image.width,
            height: image.height,
          }))}
          alt={photoViewer.title || "Post"}
          owner={photoViewer.owner}
          engagementVideo={photoViewer}
          onClose={() => setPhotoViewer(null)}
        />
      )}
    </div>
  );
}

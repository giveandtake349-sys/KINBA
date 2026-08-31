import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BadgeCheck,
  Bookmark,
  Check,
  ChevronDown,
  Heart,
  Loader2,
  MessageCircle,
  Megaphone,
  Pause,
  Play,
  Plus,
  Share2,
  Search,
  RotateCcw,
  Upload,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  getVideoMetadata,
  MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS,
  MAX_LONG_VIDEO_DURATION_SECONDS,
  MAX_SHORT_VIDEO_DURATION_SECONDS,
  publishVideo,
  uploadImage,
  uploadVideo,
  validateImageFile,
  type VideoMetadata,
} from "@/lib/mediaUpload";
import ErrorBoundary from "./ErrorBoundary";
import "./mediaHub.css";
import "./kinbaModern.css";

type HomeTab = "videos" | "trendy" | "following" | "icons";
type VideoKind = "LONG" | "SHORT";
type Quality = "ORIGINAL" | "1080P" | "720P" | "480P" | "240P";
type VideoSource = { quality: Quality; videoUrl: string };
type VideoRecord = {
  id: number;
  title: string;
  description: string;
  videoUrl: string;
  thumbnailUrl: string | null;
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
  viewerShared: boolean;
  bookmarkCount: number;
  viewerBookmarked: boolean;
  owner: {
    id: number;
    name: string | null;
    username: string | null;
    photoUrl: string | null;
    accountType: "member" | "creator" | "company";
    isVerified: boolean;
  };
};
type Engagement = {
  reactionCount: number;
  shareCount: number;
  commentCount: number;
  viewerReacted: boolean;
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
  fallback = "KINBA member"
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
    (source ?? "kinba_creator")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "kinba_creator"
  }`;
}
function hashtagsFromDescription(description: string) {
  const tags = description.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  return tags.slice(0, 3).join(" ") || "#kinba";
}
function isReportedLegacyMedia(
  video: Pick<VideoRecord, "title" | "description">
) {
  const copy = `${video.title} ${video.description}`
    .toLowerCase()
    .replace(/\s+/g, " ");
  return copy.includes("hey, well-connected") && copy.includes("platform");
}

function notifyError(error: unknown) {
  toast.error(
    error instanceof Error
      ? error.message
      : "The operation could not be completed."
  );
}
function useOptimisticEngagement(video: VideoRecord) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const [override, setOverride] = useState<Engagement | null>(null);
  const [pending, setPending] = useState<"react" | "share" | null>(null);
  const reactMutation = trpc.videos.react.useMutation();
  const shareMutation = trpc.videos.share.useMutation();
  const current = override ?? {
    reactionCount: video.reactionCount,
    shareCount: video.shareCount,
    commentCount: video.commentCount,
    viewerReacted: video.viewerReacted,
    viewerShared: video.viewerShared,
  };
  const react = async () => {
    if (!auth.isAuthenticated) return auth.openAuth();
    const previous = current;
    setOverride({
      ...previous,
      viewerReacted: !previous.viewerReacted,
      reactionCount: previous.reactionCount + (previous.viewerReacted ? -1 : 1),
    });
    setPending("react");
    try {
      setOverride(await reactMutation.mutateAsync({ videoId: video.id }));
      await utils.home.feed.invalidate();
      await utils.videos.list.invalidate();
    } catch (error) {
      setOverride(previous);
      notifyError(error);
    } finally {
      setPending(null);
    }
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
      const previous = current;
      setOverride({
        ...previous,
        viewerShared: true,
        shareCount: previous.shareCount + (previous.viewerShared ? 0 : 1),
      });
      setPending("share");
      setOverride(await shareMutation.mutateAsync({ videoId: video.id }));
      await utils.home.feed.invalidate();
      await utils.videos.list.invalidate();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notifyError(error);
    } finally {
      setPending(null);
    }
  };
  return { current, react, share, pending };
}

function QualityVideoPlayer({
  video,
  vertical = false,
  active = true,
  onFirstPlay,
}: {
  video: VideoRecord;
  vertical?: boolean;
  active?: boolean;
  onFirstPlay?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const positionRef = useRef(0);
  const resumeRef = useRef(false);
  const viewedRef = useRef(false);
  const sourceMap = useMemo(
    () =>
      new Map(video.sources.map(source => [source.quality, source.videoUrl])),
    [video.sources]
  );
  const sourceUrl = sourceMap.get("ORIGINAL") ?? video.videoUrl;
  const shouldPlay = active && isInView;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        setIsInView(
          Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.7)
        );
      },
      { threshold: 0.7 }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    setPlaybackError(null);
    element.src = sourceUrl;
    element.load();
    return () => {
      element.removeAttribute("src");
      element.load();
    };
  }, [sourceUrl]);

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
  return (
    <div
      ref={containerRef}
      className={
        vertical
          ? "media-video-frame media-video-frame--short w-full h-full object-cover aspect-[9/16]"
          : "media-video-frame media-video-frame--square w-full h-full object-cover"
      }
    >
      <video
        className={`w-full h-full object-cover ${vertical ? "aspect-[9/16]" : ""}`}
        ref={ref}
        crossOrigin="anonymous"
        controls
        controlsList="nofullscreen noplaybackrate"
        disablePictureInPicture
        playsInline
        preload="metadata"
        muted={muted}
        onLoadedMetadata={restorePlayback}
        onError={() =>
          setPlaybackError(
            "This video stream could not be loaded. Please try again."
          )
        }
        onPlay={() => {
          setPlaying(true);
          if (!viewedRef.current) {
            viewedRef.current = true;
            onFirstPlay?.();
          }
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className="media-video-controls">
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
          onClick={() => setMuted(value => !value)}
          aria-label={muted ? "Unmute video" : "Mute video"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <label className="media-quality-control">
          <ChevronDown size={13} />
          <span className="sr-only">Video quality</span>
          <span className="media-quality-label">Original</span>
        </label>
        <span>{formatDuration(video.durationSeconds)}</span>
      </div>
      {playbackError && (
        <p
          className="media-processing-status media-processing-status--error"
          role="alert"
        >
          {playbackError}
        </p>
      )}
    </div>
  );
}

function EngagementActions({
  engagement,
  onReact,
  onShare,
  onComments,
  pending,
  overlay = false,
  bookmarked = false,
  onBookmark,
  owner,
}: {
  engagement: Engagement;
  onReact: () => void;
  onShare: () => void;
  onComments: () => void;
  pending: "react" | "share" | null;
  overlay?: boolean;
  bookmarked?: boolean;
  onBookmark?: () => void;
  owner?: VideoRecord["owner"];
}) {
  const auth = useAuth();
  const utils = trpc.useUtils();
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
      className={`media-engagement-actions${overlay ? " media-engagement-actions--overlay absolute right-3 bottom-4 z-30 flex flex-col items-center gap-3" : ""}`}
    >
      {overlay && owner && !isOwnVideo && (
        <button
          type="button"
          className={`creator-follow-action${following ? " is-following" : ""}`}
          onClick={followOwner}
          disabled={toggleFollow.isPending}
          aria-label={following ? "Unfollow creator" : "Follow creator"}
          aria-pressed={following}
        >
          <span className="creator-follow-avatar">
            {owner.photoUrl ? (
              <img src={owner.photoUrl} alt="" />
            ) : (
              <UserRound size={19} />
            )}
          </span>
          <span className="creator-follow-badge" aria-hidden="true">
            {following ? <Check size={12} /> : <Plus size={13} />}
          </span>
          <span>{following ? "Following" : "Follow"}</span>
        </button>
      )}
      <button
        type="button"
        className={engagement.viewerReacted ? "is-active" : ""}
        onClick={onReact}
        disabled={pending === "react"}
        aria-pressed={engagement.viewerReacted}
        aria-label={engagement.viewerReacted ? "Unlike video" : "Like video"}
      >
        <Heart
          size={overlay ? 27 : 16}
          fill={engagement.viewerReacted ? "currentColor" : "none"}
        />
        <span>{engagement.viewerReacted ? "Liked" : "React/Like"}</span>
        <strong>{formatCount(engagement.reactionCount)}</strong>
      </button>
      <button type="button" onClick={onComments} aria-label="Open comments">
        <MessageCircle size={overlay ? 27 : 16} /> <span>Comments</span>
        <strong>{formatCount(engagement.commentCount)}</strong>
      </button>
      {!overlay && (
        <button
          type="button"
          className={bookmarked ? "is-active" : ""}
          onClick={onBookmark}
          aria-pressed={bookmarked}
        >
          <Bookmark size={16} fill={bookmarked ? "currentColor" : "none"} />
          <span>Bookmark</span>
        </button>
      )}
      <button
        type="button"
        className={engagement.viewerShared ? "is-active" : ""}
        onClick={onShare}
        disabled={pending === "share"}
        aria-label="Share video"
      >
        <Share2 size={overlay ? 28 : 16} />
        <span>{pending === "share" ? "Sharing" : "Share"}</span>
        <strong>{formatCount(engagement.shareCount)}</strong>
      </button>
    </div>
  );
}
function CommentsPanel({
  videoId,
  open,
  overlay = false,
  onClose,
}: {
  videoId: number;
  open: boolean;
  overlay?: boolean;
  onClose?: () => void;
}) {
  const auth = useAuth();
  const [body, setBody] = useState("");
  const commentsQuery = trpc.videos.comments.list.useQuery(
    { videoId },
    { enabled: open, refetchOnWindowFocus: false }
  );
  const createComment = trpc.videos.comments.create.useMutation();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!body.trim()) return;
    if (!auth.isAuthenticated) return auth.openAuth();
    try {
      await createComment.mutateAsync({ videoId, body: body.trim() });
      setBody("");
      await commentsQuery.refetch();
    } catch (error) {
      notifyError(error);
    }
  };
  if (!open) return null;
  return (
    <div
      className={`video-comments${overlay ? " video-comments--overlay" : ""}`}
      aria-live="polite"
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay || undefined}
      aria-label={overlay ? "Comments" : undefined}
    >
      {overlay && (
        <div className="comment-sheet-header">
          <span aria-hidden="true" />
          <strong>Comments</strong>
          <button type="button" onClick={onClose} aria-label="Close comments">
            <X size={19} />
          </button>
        </div>
      )}
      {commentsQuery.isPending ? (
        <div className="comment-loading">Loading comments…</div>
      ) : commentsQuery.isError ? (
        <div className="comment-loading">
          Comments are temporarily unavailable.
        </div>
      ) : commentsQuery.data?.length ? (
        commentsQuery.data.map(comment => (
          <div className="video-comment" key={comment.id}>
            <strong>
              {displayName(comment.author.name, comment.author.username)}
            </strong>
            <span>{comment.body}</span>
          </div>
        ))
      ) : (
        <div className="comment-loading">
          No comments yet. Start the conversation.
        </div>
      )}
      <form onSubmit={submit} className="comment-form">
        <input
          value={body}
          onChange={event => setBody(event.target.value)}
          maxLength={500}
          placeholder={
            auth.isAuthenticated ? "Write a comment…" : "Sign in to comment"
          }
          aria-label="Write a comment"
        />
        <button
          type="submit"
          className="primary-btn"
          disabled={createComment.isPending || !body.trim()}
        >
          Post
        </button>
      </form>
    </div>
  );
}

function VideoCard({
  video,
  active = true,
  showDetailsOverlay = false,
}: {
  video: VideoRecord;
  active?: boolean;
  showDetailsOverlay?: boolean;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
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
  const recordView = () => {
    if (viewMutation.isPending) return;
    void viewMutation
      .mutateAsync({ videoId: video.id })
      .then(result => setViews(result.viewCount))
      .catch(() => undefined);
  };
  return (
    <article className="long-video-card w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4 overflow-hidden box-border">
      <div className="media-fullscreen-frame">
        <QualityVideoPlayer
          video={video}
          active={active}
          onFirstPlay={recordView}
        />
        {showDetailsOverlay && (
          <div className="media-overlay-copy">
            <div className="media-overlay-details">
              <div className="media-owner">
                <div className="video-owner-identity">
                  <div className="video-owner-avatar">
                    {video.owner.photoUrl ? (
                      <img src={video.owner.photoUrl} alt="" />
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
                          size={12}
                          aria-label="Verified profile"
                        />
                      )}
                    </strong>
                    <span>
                      {ownerHandle(video.owner.name, video.owner.username)}
                    </span>
                  </div>
                </div>
              </div>
              <h3>{video.title}</h3>
              <p>{video.description}</p>
              <p className="media-caption-tags">
                {ownerHandle(video.owner.name, video.owner.username)} · {hashtagsFromDescription(video.description)}
              </p>
              <p className="media-sound-track">
                <Volume2 size={14} aria-hidden="true" /> Original sound · {ownerHandle(video.owner.name, video.owner.username)}
              </p>
              <div className="media-meta-line" aria-label="Video metadata">
                <span>{formatCount(views)} views</span>
                <span>{relativeTime(video.createdAt)}</span>
                <span>{video.kind === "SHORT" ? "Short" : "Video"}</span>
              </div>
            </div>
            <EngagementActions
              engagement={current}
              onReact={react}
              onShare={share}
              onComments={() => setCommentsOpen(value => !value)}
              pending={pending}
              overlay
              bookmarked={bookmarked}
              onBookmark={toggleBookmark}
              owner={video.owner}
            />
          </div>
        )}
      </div>
      {!showDetailsOverlay && (
        <div className="video-card-details">
          <div className="media-owner">
            <div className="video-owner-identity">
              <div className="video-owner-avatar">
                {video.owner.photoUrl ? (
                  <img src={video.owner.photoUrl} alt="" />
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
                      size={12}
                      aria-label="Verified profile"
                    />
                  )}
                </strong>
                <span>
                  {ownerHandle(video.owner.name, video.owner.username)}
                </span>
              </div>
            </div>
          </div>
          <h3>{video.title}</h3>
          <p>{video.description}</p>
          <div className="media-meta-line" aria-label="Video metadata">
            <span>{formatCount(views)} views</span>
            <span>{relativeTime(video.createdAt)}</span>
            <span>{video.kind === "SHORT" ? "Short" : "Video"}</span>
          </div>
          <EngagementActions
            engagement={current}
            onReact={react}
            onShare={share}
            onComments={() => setCommentsOpen(value => !value)}
            pending={pending}
            bookmarked={bookmarked}
            onBookmark={toggleBookmark}
          />
        </div>
      )}
      <CommentsPanel
        videoId={video.id}
        open={commentsOpen}
        overlay={showDetailsOverlay}
        onClose={() => setCommentsOpen(false)}
      />
    </article>
  );
}
function UploadVideoPanel({
  onPublished,
  detailsRef,
}: {
  onPublished: () => void;
  detailsRef: { current: HTMLDetailsElement | null };
}) {
  const [kind, setKind] = useState<VideoKind>("LONG");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    event.target.value = "";
    if (!nextFile) return;
    try {
      const nextMetadata = await getVideoMetadata(nextFile, {
        maxDurationSeconds:
          kind === "LONG"
            ? MAX_LONG_VIDEO_DURATION_SECONDS
            : MAX_SHORT_VIDEO_DURATION_SECONDS,
      });
      setFile(nextFile);
      setMetadata(nextMetadata);
    } catch (error) {
      notifyError(error);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || !metadata || !title.trim()) {
      toast.error("Add an original video and title first.");
      return;
    }
    setBusy(true);
    try {
      await publishVideo(file, kind, title.trim(), description.trim());
      await onPublished();
      setTitle("");
      setDescription("");
      setFile(null);
      setMetadata(null);
      toast.success(
        "Video received. It will play in Auto mode while 1080p, 720p, 480p, and 240p streams are prepared."
      );
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setFile(null);
    setMetadata(null);
  }, [kind]);
  return (
    <details ref={detailsRef} className="media-publish-panel">
      <summary>
        <Upload size={17} /> Publish a video
      </summary>
      <form onSubmit={submit} className="media-publish-form">
        <div
          className="media-kind-switch"
          role="tablist"
          aria-label="Video format"
        >
          <button
            type="button"
            className={kind === "LONG" ? "active" : ""}
            onClick={() => setKind("LONG")}
            role="tab"
            aria-selected={kind === "LONG"}
          >
            Main video · 30 min
          </button>
          <button
            type="button"
            className={kind === "SHORT" ? "active" : ""}
            onClick={() => setKind("SHORT")}
            role="tab"
            aria-selected={kind === "SHORT"}
          >
            Short · 1 min
          </button>
        </div>
        <p className="media-form-hint">
          Upload one original video. KINBA securely creates the available HLS
          qualities automatically after the upload finishes.
        </p>
        <label>
          Title
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            minLength={3}
            maxLength={180}
            required
            placeholder="Give your video a clear title"
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            maxLength={2400}
            rows={3}
            placeholder="Tell viewers what this video is about"
          />
        </label>
        <div className="quality-upload-grid">
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={selectFile}
          />
          <button
            type="button"
            className="secondary-media-btn"
            onClick={() => inputRef.current?.click()}
          >
            Choose original video · required
          </button>
          {file && (
            <span className="selected-file">
              {file.name}
              <button
                type="button"
                className="muted-btn"
                onClick={() => {
                  setFile(null);
                  setMetadata(null);
                }}
              >
                Remove
              </button>
            </span>
          )}
        </div>
        <button
          className="primary-btn"
          type="submit"
          disabled={!file || !metadata || !title.trim() || busy}
        >
          {busy ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}{" "}
          {busy ? "Uploading" : "Upload and prepare qualities"}
        </button>
      </form>
    </details>
  );
}
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

function FeedRecovery() {
  return (
    <div className="media-empty" role="status">
      <h3>This feed is temporarily empty.</h3>
      <p>Navigation is still available. Try another tab or reload this feed.</p>
      <button
        type="button"
        className="primary-btn"
        onClick={() => window.location.reload()}
      >
        <RotateCcw size={15} /> Reload feed
      </button>
    </div>
  );
}

function HomeFeedPanel({
  tab,
  active = true,
  autoOpenUpload = false,
  showDetailsOverlay = true,
}: {
  tab: HomeTab;
  active?: boolean;
  autoOpenUpload?: boolean;
  showDetailsOverlay?: boolean;
}) {
  const auth = useAuth();
  const utils = trpc.useUtils();
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
  const videos = ((query.data ?? []) as VideoRecord[]).filter(
    video => !isReportedLegacyMedia(video)
  );
  const uploadDetailsRef = useRef<HTMLDetailsElement>(null);
  const openUploader = () => {
    uploadDetailsRef.current?.setAttribute("open", "");
    uploadDetailsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };
  useEffect(() => {
    if (autoOpenUpload) openUploader();
  }, [autoOpenUpload]);
  return (
    <section
      className="media-section home-feed-section w-full max-w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4 overflow-hidden box-border"
      aria-labelledby="home-feed-heading"
    >
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
      {query.isPending ? (
        <FeedSkeleton />
      ) : videos.length ? (
        <div className="long-video-grid media-feed-scroll h-screen overflow-y-scroll scrollbar-hide snap-y snap-mandatory w-full max-w-full box-border">
          {videos.map(video => (
            <VideoCard
              key={video.id}
              video={video}
              active={active}
              showDetailsOverlay={showDetailsOverlay}
            />
          ))}
        </div>
      ) : (
        <div className="media-empty">
          <Play size={18} />
          <h3>
            {tab === "following" && !auth.isAuthenticated
              ? "Sign in to see Following."
              : "No videos available yet. Be the first creator!"}
          </h3>
          <p>
            {tabOptions.find(option => option.id === tab)?.caption}. Publish a
            video and it will appear here.
          </p>
          <button type="button" className="primary-btn" onClick={openUploader}>
            <Upload size={15} /> Upload Video
          </button>
        </div>
      )}
      <UploadVideoPanel
        detailsRef={uploadDetailsRef}
        onPublished={async () => {
          await Promise.all([
            utils.home.feed.invalidate(),
            utils.videos.list.invalidate(),
          ]);
        }}
      />
    </section>
  );
}
function ShortVideoCard({
  video,
  index,
  active,
}: {
  video: VideoRecord;
  index: number;
  active: boolean;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
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
  const { current, react, share, pending } = useOptimisticEngagement(video);
  return (
    <article
      className="short-card w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4 overflow-hidden box-border"
      data-short-index={index}
    >
      <QualityVideoPlayer video={video} vertical active={active} />
      <div className="short-overlay">
        <div className="short-overlay-details">
          <div className="media-owner">
            <div className="video-owner-identity">
              <div className="video-owner-avatar">
                {video.owner.photoUrl ? (
                  <img src={video.owner.photoUrl} alt="" />
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
                      size={12}
                      aria-label="Verified profile"
                    />
                  )}
                </strong>
                <span>
                  {ownerHandle(video.owner.name, video.owner.username)}
                </span>
              </div>
            </div>
          </div>
          <strong className="short-title">{video.title}</strong>
          <p>{video.description}</p>
          <p className="media-caption-tags">
            {ownerHandle(video.owner.name, video.owner.username)} · {hashtagsFromDescription(video.description)}
          </p>
          <p className="media-sound-track">
            <Volume2 size={14} aria-hidden="true" /> Original sound · {ownerHandle(video.owner.name, video.owner.username)}
          </p>
        </div>
        <EngagementActions
          engagement={current}
          onReact={react}
          onShare={share}
          onComments={() => setCommentsOpen(value => !value)}
          pending={pending}
          overlay
          bookmarked={bookmarked}
          onBookmark={toggleBookmark}
          owner={video.owner}
        />
      </div>
      <CommentsPanel
        videoId={video.id}
        open={commentsOpen}
        overlay
        onClose={() => setCommentsOpen(false)}
      />
    </article>
  );
}

function ShortsFeed({ active = true }: { active?: boolean }) {
  const query = trpc.videos.list.useQuery(
    { kind: "SHORT" },
    {
      retry: 1,
      throwOnError: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const videos = ((query.data ?? []) as VideoRecord[]).filter(
    video => !isReportedLegacyMedia(video)
  );
  const goTo = (index: number) => {
    const clamped = Math.max(
      0,
      Math.min(index, Math.max(videos.length - 1, 0))
    );
    viewportRef.current
      ?.querySelector<HTMLElement>(`[data-short-index="${clamped}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setActiveIndex(clamped);
  };
  const onScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setActiveIndex(
      Math.max(
        0,
        Math.min(
          Math.round(viewport.scrollTop / Math.max(viewport.clientHeight, 1)),
          Math.max(videos.length - 1, 0)
        )
      )
    );
  };
  return (
    <section
      className="media-section shorts-section w-full max-w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4 overflow-hidden box-border"
      aria-labelledby="shorts-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Shorts</p>
          <h2 id="shorts-heading">One minute. One idea.</h2>
        </div>
        <div className="shorts-controls">
          <button
            type="button"
            onClick={() => goTo(activeIndex - 1)}
            disabled={!videos.length || activeIndex === 0}
            aria-label="Previous Short"
          >
            ↑
          </button>
          <span>
            {videos.length ? `${activeIndex + 1} / ${videos.length}` : "0 / 0"}
          </span>
          <button
            type="button"
            onClick={() => goTo(activeIndex + 1)}
            disabled={!videos.length || activeIndex === videos.length - 1}
            aria-label="Next Short"
          >
            ↓
          </button>
        </div>
      </div>
      {query.isPending ? (
        <FeedSkeleton short />
      ) : videos.length ? (
        <div
          className="shorts-viewport media-feed-scroll h-screen overflow-y-scroll scrollbar-hide snap-y snap-mandatory w-full max-w-full box-border"
          ref={viewportRef}
          onScroll={onScroll}
        >
          {videos.map((video, index) => (
            <ShortVideoCard
              key={video.id}
              video={video}
              index={index}
              active={active}
            />
          ))}
        </div>
      ) : (
        <div className="media-empty">
          <Play size={18} />
          <h3>No Shorts yet.</h3>
          <p>Publish a video of 60 seconds or less to start the Shorts feed.</p>
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
      notifyError(error);
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
  const commentsQuery = trpc.community.comments.list.useQuery(
    { announcementId },
    { enabled: open, refetchOnWindowFocus: false }
  );
  const createComment = trpc.community.comments.create.useMutation();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    if (!auth.isAuthenticated) return auth.openAuth();
    try {
      await createComment.mutateAsync({ announcementId, body: trimmed });
      setBody("");
      await Promise.all([
        commentsQuery.refetch(),
        utils.community.list.invalidate(),
      ]);
    } catch (error) {
      notifyError(error);
    }
  };
  const visibleCount = commentsQuery.data?.length ?? commentCount;
  return (
    <div className="announcement-comments">
      <button
        type="button"
        className={`announcement-comment-toggle${open ? " is-active" : ""}`}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
      >
        <MessageCircle size={15} />
        Comments <strong>{formatCount(visibleCount)}</strong>
      </button>
      {open && (
        <div className="announcement-comments__panel" aria-live="polite">
          {commentsQuery.isPending ? (
            <div className="comment-loading">Loading comments…</div>
          ) : commentsQuery.isError ? (
            <div className="comment-loading">
              Comments are temporarily unavailable.
            </div>
          ) : commentsQuery.data?.length ? (
            commentsQuery.data.map(comment => (
              <div className="video-comment" key={comment.id}>
                <strong>
                  {displayName(comment.author.name, comment.author.username)}
                </strong>
                <span>{comment.body}</span>
              </div>
            ))
          ) : (
            <div className="comment-loading">
              No comments yet. Start the conversation.
            </div>
          )}
          <form onSubmit={submit} className="comment-form">
            <input
              value={body}
              onChange={event => setBody(event.target.value)}
              maxLength={500}
              placeholder={
                auth.isAuthenticated ? "Write a comment…" : "Sign in to comment"
              }
              aria-label="Write a comment on this post"
            />
            <button
              type="submit"
              className="primary-btn"
              disabled={createComment.isPending || !body.trim()}
            >
              {createComment.isPending ? "Posting…" : "Post"}
            </button>
          </form>
        </div>
      )}
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
                <div className="announcement-author-avatar">
                  {announcement.author.photoUrl ? (
                    <img src={announcement.author.photoUrl} alt="" />
                  ) : (
                    <Megaphone size={16} />
                  )}
                </div>
                <div>
                  <strong className="announcement-author-name">
                    <span>
                      {announcement.author.name ?? "KINBA organization"}
                    </span>
                    <BadgeCheck
                      className="verified-badge"
                      size={13}
                      aria-label="Verified profile"
                    />
                  </strong>
                  <span>{announcement.author.accountType} · verified</span>
                </div>
                <time dateTime={new Date(announcement.createdAt).toISOString()}>
                  {new Date(announcement.createdAt).toLocaleDateString()}
                </time>
              </div>
              {announcement.body && <p>{announcement.body}</p>}
              <div
                className={`announcement-attachments ${announcement.attachments.length > 1 ? "has-grid" : ""}`}
              >
                {announcement.attachments.map(attachment =>
                  attachment.mediaType === "IMAGE" ? (
                    <img
                      key={attachment.id}
                      src={attachment.mediaUrl}
                      alt="Community announcement attachment"
                      loading="lazy"
                    />
                  ) : (
                    <video
                      key={attachment.id}
                      src={attachment.mediaUrl}
                      controls
                      controlsList="nofullscreen noplaybackrate"
                      disablePictureInPicture
                      playsInline
                      preload="metadata"
                    />
                  )
                )}
              </div>
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
  | "wheels"
  | "all"
  | "shorts"
  | "announcements"
  | "publish"
  | "search"
  | "notifications"
  | "settings"
  | "wallet"
  | "qr"
  | "offline";

export function SearchFeed() {
  const [term, setTerm] = useState("");
  const query = trpc.home.search.useQuery(
    { term },
    {
      enabled: term.trim().length >= 2,
      retry: 1,
      throwOnError: false,
      refetchOnWindowFocus: false,
    }
  );
  const results = ((query.data ?? []) as VideoRecord[]).filter(
    video => !isReportedLegacyMedia(video)
  );
  return (
    <section
      className="media-section search-section"
      aria-labelledby="search-heading"
    >
      <div className="media-section-heading">
        <div>
          <p className="eyebrow">Search</p>
          <h2 id="search-heading">Find your next signal.</h2>
        </div>
        <span>Searches published videos</span>
      </div>
      <form
        className="feed-search-form"
        onSubmit={event => event.preventDefault()}
      >
        <Search size={17} />
        <input
          value={term}
          onChange={event => setTerm(event.target.value)}
          placeholder="Search videos, creators, or topics"
          aria-label="Search videos, creators, or topics"
        />
      </form>
      {!term.trim() ? (
        <div className="media-empty">
          <Search size={18} />
          <h3>Search the KINBA feed.</h3>
          <p>Try a creator name, title, or topic.</p>
        </div>
      ) : term.trim().length < 2 ? (
        <div className="media-empty">
          <p>Enter at least two characters to search.</p>
        </div>
      ) : query.isPending ? (
        <FeedSkeleton />
      ) : results.length ? (
        <div className="long-video-grid media-feed-scroll h-screen overflow-y-scroll scrollbar-hide snap-y snap-mandatory w-full max-w-full box-border">
          {results.map(video => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      ) : (
        <div className="media-empty">
          <h3>No videos found.</h3>
          <p>Try another creator, title, or topic.</p>
        </div>
      )}
    </section>
  );
}

export default function MediaHub({
  section = "all",
  onSectionChange,
  showTabs = true,
  wheels,
}: {
  section?: FeedSection;
  onSectionChange?: (section: FeedSection) => void;
  showTabs?: boolean;
  wheels?: ReactNode;
}) {
  const [selectedSection, setSelectedSection] = useState<FeedSection>(section);

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
  return (
    <div className="media-hub">
      {showTabs && (
        <nav
          className="home-feed-tabs"
          aria-label="Home feed tabs"
          role="tablist"
        >
          {(
            [
              ["wheels", "Wheels"],
              ["all", "All Feed"],
              ["videos", "Videos"],
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
              role="tab"
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      <div
        hidden={activeSection !== "wheels"}
        className={`media-tab-panel${
          activeSection === "wheels" ? " media-tab-panel--wheels" : ""
        }`}
      >
        <div className="wheels-feed-layout">
          <HomeFeedPanel tab="videos" active={activeSection === "wheels"} />
          <div className="wheels-sponsor-panel">
            {wheels ?? (
              <div className="media-empty">
                <h3>Wheels are unavailable.</h3>
              </div>
            )}
          </div>
        </div>
      </div>
      <div hidden={activeSection !== "all"} className="media-tab-panel">
        <ErrorBoundary fallback={<FeedRecovery />}>
          <ShortsFeed active={activeSection === "all"} />
          <HomeFeedPanel
            tab="videos"
            active={activeSection === "all"}
            autoOpenUpload={false}
          />
        </ErrorBoundary>
      </div>
      <div hidden={activeSection !== "videos"} className="media-tab-panel">
        <ErrorBoundary fallback={<FeedRecovery />}>
          <HomeFeedPanel
            tab="videos"
            active={activeSection === "videos"}
            autoOpenUpload={section === "publish"}
            showDetailsOverlay={false}
          />
        </ErrorBoundary>
      </div>
      <div hidden={activeSection !== "shorts"} className="media-tab-panel">
        <ErrorBoundary fallback={<FeedRecovery />}>
          <ShortsFeed active={activeSection === "shorts"} />
        </ErrorBoundary>
      </div>
      {activeSection === "announcements" && <CommunityAnnouncements />}
    </div>
  );
}

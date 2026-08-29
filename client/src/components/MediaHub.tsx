import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BadgeCheck,
  ChevronDown,
  Heart,
  Loader2,
  MessageCircle,
  Megaphone,
  Pause,
  Play,
  Share2,
  Search,
  Upload,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  getVideoMetadata,
  MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS,
  MAX_LONG_VIDEO_DURATION_SECONDS,
  MAX_SHORT_VIDEO_DURATION_SECONDS,
  uploadImage,
  uploadVideo,
  validateImageFile,
  type VideoMetadata,
} from "@/lib/mediaUpload";
import "./mediaHub.css";

type HomeTab = "videos" | "trendy" | "following" | "icons";
type VideoKind = "LONG" | "SHORT";
type Quality = "ORIGINAL" | "1080P" | "720P" | "480P";
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
  createdAt: Date | string;
  viewCount: number;
  reactionCount: number;
  commentCount: number;
  shareCount: number;
  viewerReacted: boolean;
  viewerShared: boolean;
  owner: {
    id: number;
    name: string | null;
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
const qualityLabels: Record<Quality, string> = {
  ORIGINAL: "Auto",
  "1080P": "1080p",
  "720P": "720p",
  "480P": "480p",
};
const qualityFileLabels: { quality: Quality; label: string }[] = [
  { quality: "ORIGINAL", label: "Original / Auto" },
  { quality: "1080P", label: "1080p source" },
  { quality: "720P", label: "720p source" },
  { quality: "480P", label: "480p source" },
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
function ownerHandle(name: string | null) {
  return `@${
    (name ?? "kinba_creator")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "kinba_creator"
  }`;
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
  onFirstPlay,
}: {
  video: VideoRecord;
  vertical?: boolean;
  onFirstPlay?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [quality, setQuality] = useState<Quality>("ORIGINAL");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const positionRef = useRef(0);
  const resumeRef = useRef(false);
  const viewedRef = useRef(false);
  const sourceMap = useMemo(
    () =>
      new Map(video.sources.map(source => [source.quality, source.videoUrl])),
    [video.sources]
  );
  const sourceUrl =
    quality === "ORIGINAL"
      ? (sourceMap.get("ORIGINAL") ?? video.videoUrl)
      : (sourceMap.get(quality) ?? sourceMap.get("ORIGINAL") ?? video.videoUrl);
  const switchQuality = (next: Quality) => {
    if (next !== "ORIGINAL" && !sourceMap.has(next)) return;
    positionRef.current = ref.current?.currentTime ?? 0;
    resumeRef.current = Boolean(ref.current && !ref.current.paused);
    setQuality(next);
  };
  const restorePlayback = () => {
    const element = ref.current;
    if (!element) return;
    element.currentTime = Math.min(
      positionRef.current,
      Number.isFinite(element.duration) ? element.duration : positionRef.current
    );
    if (resumeRef.current) void element.play().catch(() => undefined);
  };
  return (
    <div
      className={
        vertical
          ? "media-video-frame media-video-frame--short"
          : "media-video-frame media-video-frame--square"
      }
    >
      <video
        ref={ref}
        key={sourceUrl}
        src={sourceUrl}
        poster={video.thumbnailUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        muted={muted}
        onLoadedMetadata={restorePlayback}
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
          <select
            value={quality}
            onChange={event => switchQuality(event.target.value as Quality)}
            aria-label="Video quality"
          >
            <option value="ORIGINAL">Auto</option>
            {(["1080P", "720P", "480P"] as Quality[]).map(option => (
              <option
                key={option}
                value={option}
                disabled={!sourceMap.has(option)}
              >
                {qualityLabels[option]}
                {sourceMap.has(option) ? "" : " (not available)"}
              </option>
            ))}
          </select>
        </label>
        <span>{formatDuration(video.durationSeconds)}</span>
      </div>
    </div>
  );
}

function EngagementActions({
  engagement,
  onReact,
  onShare,
  onComments,
  pending,
}: {
  engagement: Engagement;
  onReact: () => void;
  onShare: () => void;
  onComments: () => void;
  pending: "react" | "share" | null;
}) {
  return (
    <div className="media-engagement-actions">
      <button
        type="button"
        className={engagement.viewerReacted ? "is-active" : ""}
        onClick={onReact}
        disabled={pending === "react"}
        aria-pressed={engagement.viewerReacted}
      >
        <Heart
          size={16}
          fill={engagement.viewerReacted ? "currentColor" : "none"}
        />{" "}
        <span>{engagement.viewerReacted ? "Liked" : "React/Like"}</span>{" "}
        <strong>{engagement.reactionCount}</strong>
      </button>
      <button type="button" onClick={onComments}>
        <MessageCircle size={16} /> <span>Comments</span>{" "}
        <strong>{engagement.commentCount}</strong>
      </button>
      <button
        type="button"
        className={engagement.viewerShared ? "is-active" : ""}
        onClick={onShare}
        disabled={pending === "share"}
      >
        <Share2 size={16} />{" "}
        <span>{pending === "share" ? "Sharing" : "Share"}</span>{" "}
        <strong>{engagement.shareCount}</strong>
      </button>
    </div>
  );
}
function CommentsPanel({ videoId, open }: { videoId: number; open: boolean }) {
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
    <div className="video-comments" aria-live="polite">
      {commentsQuery.isPending ? (
        <div className="comment-loading">Loading comments…</div>
      ) : commentsQuery.isError ? (
        <div className="comment-loading">
          Comments are temporarily unavailable.
        </div>
      ) : commentsQuery.data?.length ? (
        commentsQuery.data.map(comment => (
          <div className="video-comment" key={comment.id}>
            <strong>{comment.author.name ?? "KINBA member"}</strong>
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

function VideoCard({ video }: { video: VideoRecord }) {
  const [commentsOpen, setCommentsOpen] = useState(false);
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
    <article className="long-video-card">
      <QualityVideoPlayer video={video} onFirstPlay={recordView} />
      <div className="long-video-copy">
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
              <strong>{video.owner.name ?? "KINBA member"}</strong>
              <span>
                {ownerHandle(video.owner.name)} ·{" "}
                {relativeTime(video.createdAt)}{" "}
                {video.owner.isVerified && (
                  <>
                    <BadgeCheck size={12} /> {video.owner.accountType}
                  </>
                )}
              </span>
            </div>
          </div>
          <span>{formatDuration(video.durationSeconds)}</span>
        </div>
        <h3>{video.title}</h3>
        <p>{video.description}</p>
        <div className="video-meta-line">
          <span>{formatCount(views)} views</span>
          <span>{formatCount(current.reactionCount)} reactions</span>
          <span>{formatCount(current.commentCount)} comments</span>
        </div>
        <EngagementActions
          engagement={current}
          onReact={react}
          onShare={share}
          onComments={() => setCommentsOpen(value => !value)}
          pending={pending}
        />
        <CommentsPanel videoId={video.id} open={commentsOpen} />
      </div>
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
  const [files, setFiles] = useState<Partial<Record<Quality, File>>>({});
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [busy, setBusy] = useState(false);
  const createVideo = trpc.videos.create.useMutation();
  const inputRefs = useRef<Partial<Record<Quality, HTMLInputElement | null>>>(
    {}
  );
  const originalFile = files.ORIGINAL;
  const selectFile = async (
    quality: Quality,
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (!file.type.startsWith("video/"))
        throw new Error("Choose a supported video file.");
      if (quality === "ORIGINAL") {
        const nextMetadata = await getVideoMetadata(file, {
          maxDurationSeconds:
            kind === "LONG"
              ? MAX_LONG_VIDEO_DURATION_SECONDS
              : MAX_SHORT_VIDEO_DURATION_SECONDS,
        });
        setMetadata(nextMetadata);
      }
      setFiles(current => ({ ...current, [quality]: file }));
    } catch (error) {
      notifyError(error);
    }
  };
  const removeFile = (quality: Quality) => {
    setFiles(current => {
      const next = { ...current };
      delete next[quality];
      return next;
    });
    if (quality === "ORIGINAL") setMetadata(null);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!originalFile || !metadata || !title.trim())
      return toast.error("Add an original video and title first.");
    setBusy(true);
    try {
      const uploadEntries = await Promise.all(
        Object.entries(files).map(async ([quality, file]) => ({
          quality: quality as Quality,
          videoUrl: await uploadVideo(file as File, kind),
        }))
      );
      const originalUrl = uploadEntries.find(
        entry => entry.quality === "ORIGINAL"
      )?.videoUrl;
      if (!originalUrl)
        throw new Error("The original video source is required.");
      await createVideo.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        videoUrl: originalUrl,
        thumbnailUrl: null,
        kind,
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        sources: uploadEntries,
      });
      await onPublished();
      setTitle("");
      setDescription("");
      setFiles({});
      setMetadata(null);
      toast.success(
        kind === "LONG"
          ? "Video published to the Home feed."
          : "Short published."
      );
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    setFiles({});
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
          Duration is checked per format. Source dimensions and upload size are
          not restricted.
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
          {qualityFileLabels.map(({ quality, label }) => (
            <div
              className={`quality-upload ${quality === "ORIGINAL" ? "required" : ""}`}
              key={quality}
            >
              <input
                ref={element => {
                  inputRefs.current[quality] = element;
                }}
                type="file"
                accept="video/*"
                className="sr-only"
                onChange={event => selectFile(quality, event)}
              />
              <button
                type="button"
                className="secondary-media-btn"
                onClick={() => inputRefs.current[quality]?.click()}
              >
                {label}
                {quality === "ORIGINAL" ? " · required" : " · optional"}
              </button>
              {files[quality] && (
                <span className="selected-file">
                  {files[quality]?.name}
                  <button
                    type="button"
                    className="muted-btn"
                    onClick={() => removeFile(quality)}
                  >
                    Remove
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
        <button
          className="primary-btn"
          type="submit"
          disabled={!originalFile || !metadata || !title.trim() || busy}
        >
          {busy ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}{" "}
          {busy ? "Publishing" : "Publish video"}
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

function HomeFeedPanel({
  tab,
  autoOpenUpload = false,
}: {
  tab: HomeTab;
  autoOpenUpload?: boolean;
}) {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const query = trpc.home.feed.useQuery(
    { tab },
    {
      enabled: tab !== "following" || auth.isAuthenticated,
      refetchOnWindowFocus: false,
    }
  );
  const videos = (query.data ?? []) as VideoRecord[];
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
      className="media-section home-feed-section"
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
      ) : query.isError ? (
        <div className="media-empty">
          <h3>Unable to load this feed.</h3>
          <p>Try again in a moment.</p>
        </div>
      ) : videos.length ? (
        <div className="long-video-grid">
          {videos.map(video => (
            <VideoCard key={video.id} video={video} />
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
function ShortsFeed() {
  const query = trpc.videos.list.useQuery(
    { kind: "SHORT" },
    { refetchOnWindowFocus: false }
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const goTo = (index: number) => {
    const clamped = Math.max(0, Math.min(index, (query.data?.length ?? 1) - 1));
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
          (query.data?.length ?? 1) - 1
        )
      )
    );
  };
  return (
    <section
      className="media-section shorts-section"
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
            disabled={!query.data?.length || activeIndex === 0}
            aria-label="Previous Short"
          >
            ↑
          </button>
          <span>
            {query.data?.length
              ? `${activeIndex + 1} / ${query.data.length}`
              : "0 / 0"}
          </span>
          <button
            type="button"
            onClick={() => goTo(activeIndex + 1)}
            disabled={
              !query.data?.length ||
              activeIndex === (query.data?.length ?? 1) - 1
            }
            aria-label="Next Short"
          >
            ↓
          </button>
        </div>
      </div>
      {query.isPending ? (
        <FeedSkeleton short />
      ) : query.data?.length ? (
        <div className="shorts-viewport" ref={viewportRef} onScroll={onScroll}>
          {(query.data as VideoRecord[]).map((video, index) => (
            <article
              className="short-card"
              data-short-index={index}
              key={video.id}
            >
              <QualityVideoPlayer video={video} vertical />
              <div className="short-overlay">
                <div>
                  <strong>{video.title}</strong>
                  <p>{video.description}</p>
                  <span>
                    {video.owner.name ?? "KINBA member"} ·{" "}
                    {formatDuration(video.durationSeconds)}
                  </span>
                </div>
              </div>
            </article>
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
    if (files.length + images.length > 10)
      return toast.error("Choose up to 10 images for one announcement.");
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
    if (!body.trim() && !images.length && !video)
      return toast.error("Add text, an image, or a video first.");
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
          {video && <video src={video.previewUrl} controls muted playsInline />}
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
export function CommunityAnnouncements() {
  const auth = useAuth();
  const profileQuery = trpc.profile.me.useQuery(undefined, {
    enabled: auth.isAuthenticated,
    refetchOnWindowFocus: false,
  });
  const query = trpc.community.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const canPost = Boolean(
    profileQuery.data?.profile?.isVerified &&
      ["creator", "company"].includes(profileQuery.data.profile.accountType)
  );
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
      {canPost && <AnnouncementComposer onCreated={() => query.refetch()} />}
      {query.isPending ? (
        <FeedSkeleton />
      ) : query.isError ? (
        <div className="media-empty">
          <h3>Unable to load announcements.</h3>
          <p>Try again in a moment.</p>
        </div>
      ) : query.data?.length ? (
        <div className="announcement-list">
          {query.data.map(announcement => (
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
                  <strong>
                    {announcement.author.name ?? "KINBA organization"}{" "}
                    <BadgeCheck size={13} />
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
                      playsInline
                      preload="metadata"
                    />
                  )
                )}
              </div>
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
  | "all"
  | "shorts"
  | "announcements"
  | "publish"
  | "search"
  | "notifications"
  | "settings";

export function SearchFeed() {
  const [term, setTerm] = useState("");
  const query = trpc.home.search.useQuery(
    { term },
    { enabled: term.trim().length >= 2, refetchOnWindowFocus: false }
  );
  const results = (query.data ?? []) as VideoRecord[];
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
      ) : query.isError ? (
        <div className="media-empty">
          <h3>Search is temporarily unavailable.</h3>
          <p>Try again in a moment.</p>
        </div>
      ) : results.length ? (
        <div className="long-video-grid">
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
}: {
  section?: FeedSection;
  onSectionChange?: (section: FeedSection) => void;
}) {
  const activeSection =
    section === "publish" || section === "search" ? "videos" : section;
  const select = (next: FeedSection) => onSectionChange?.(next);
  return (
    <div className="media-hub">
      <nav
        className="home-feed-tabs"
        aria-label="Home feed tabs"
        role="tablist"
      >
        {(
          [
            ["all", "All Feed"],
            ["videos", "Videos"],
            ["shorts", "Shorts"],
          ] as const
        ).map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={activeSection === id ? "active" : ""}
            onClick={() => select(id)}
            aria-selected={activeSection === id}
            role="tab"
          >
            {label}
          </button>
        ))}
      </nav>
      {activeSection === "all" ? (
        <>
          <ShortsFeed />
          <HomeFeedPanel tab="videos" autoOpenUpload={section === "publish"} />
        </>
      ) : activeSection === "shorts" ? (
        <ShortsFeed />
      ) : activeSection === "announcements" ? (
        <CommunityAnnouncements />
      ) : (
        <HomeFeedPanel
          tab={activeSection as HomeTab}
          autoOpenUpload={section === "publish"}
        />
      )}
    </div>
  );
}

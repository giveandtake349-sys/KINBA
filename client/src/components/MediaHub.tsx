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
  Megaphone,
  Pause,
  Play,
  Share2,
  Upload,
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
  reactionCount: number;
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
}: {
  video: VideoRecord;
  vertical?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [quality, setQuality] = useState<Quality>("ORIGINAL");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const positionRef = useRef(0);
  const resumeRef = useRef(false);
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
        onPlay={() => setPlaying(true)}
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
  pending,
}: {
  engagement: Engagement;
  onReact: () => void;
  onShare: () => void;
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
function VideoCard({ video }: { video: VideoRecord }) {
  const { current, react, share, pending } = useOptimisticEngagement(video);
  return (
    <article className="long-video-card">
      <QualityVideoPlayer video={video} />
      <div className="long-video-copy">
        <div className="media-owner">
          <div>
            <strong>{video.owner.name ?? "KINBA member"}</strong>
            <span>
              {video.owner.isVerified ? (
                <>
                  <BadgeCheck size={12} /> Verified {video.owner.accountType}
                </>
              ) : (
                video.owner.accountType
              )}
            </span>
          </div>
          <span>{formatDuration(video.durationSeconds)}</span>
        </div>
        <h3>{video.title}</h3>
        <p>{video.description}</p>
        <EngagementActions
          engagement={current}
          onReact={react}
          onShare={share}
          pending={pending}
        />
      </div>
    </article>
  );
}
function UploadVideoPanel({ onPublished }: { onPublished: () => void }) {
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
    <details className="media-publish-panel">
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
function HomeFeedPanel({ tab }: { tab: HomeTab }) {
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
      {query.isLoading ? (
        <div className="loading-row">
          <Loader2 className="spin" /> Loading feed
        </div>
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
              : "Nothing here yet."}
          </h3>
          <p>
            {tabOptions.find(option => option.id === tab)?.caption}. New content
            will appear here as it is published.
          </p>
        </div>
      )}
      <UploadVideoPanel
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
      {query.isLoading ? (
        <div className="loading-row">
          <Loader2 className="spin" /> Loading Shorts
        </div>
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
function CommunityAnnouncements() {
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
      {query.isLoading ? (
        <div className="loading-row">
          <Loader2 className="spin" /> Loading announcements
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
export default function MediaHub() {
  const [activeTab, setActiveTab] = useState<HomeTab>("videos");
  return (
    <div className="media-hub">
      <nav className="home-feed-tabs" aria-label="Home feed tabs">
        {tabOptions.map(tab => (
          <button
            type="button"
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
            aria-selected={activeTab === tab.id}
            role="tab"
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <HomeFeedPanel tab={activeTab} />
      <ShortsFeed />
      <CommunityAnnouncements />
    </div>
  );
}

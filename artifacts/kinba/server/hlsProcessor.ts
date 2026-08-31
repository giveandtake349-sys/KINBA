import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  listVideosAwaitingTranscode,
  replaceVideoSources,
  updateVideoProcessing,
  type VideoSourceInput,
} from "./db";
import { storageDownload, storagePut } from "./storage";

const execFileAsync = promisify(execFile);
const segmentDurationSeconds = 6;
const variants = [
  { quality: "1080P" as const, height: 1080, bandwidth: 5_000_000 },
  { quality: "720P" as const, height: 720, bandwidth: 2_800_000 },
  { quality: "480P" as const, height: 480, bandwidth: 1_400_000 },
  { quality: "240P" as const, height: 240, bandwidth: 600_000 },
];
const activeTranscodes = new Set<number>();
let hlsJobQueue: Promise<void> = Promise.resolve();
const recoveryDelayMs = Math.max(
  0,
  Number.parseInt(process.env.HLS_RECOVERY_DELAY_MS || "1500", 10) || 0
);

function sleep(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

type SourceDimensions = { width: number; height: number };

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 1000)
    : "HLS processing failed.";
}

async function probeDimensions(inputPath: string): Promise<SourceDimensions> {
  const sourceStat = await fs.stat(inputPath).catch(() => null);
  if (!sourceStat?.isFile() || sourceStat.size === 0) {
    throw new Error("The source video file is missing or empty.");
  }
  const { stdout } = await execFileAsync(process.env.FFPROBE_BIN || "ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    inputPath,
  ]);
  const result = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
  };
  const stream = result.streams?.[0];
  if (!stream?.width || !stream.height) {
    throw new Error("The uploaded video has no readable video stream.");
  }
  return { width: stream.width, height: stream.height };
}

function variantDimensions(
  source: SourceDimensions,
  targetHeight: number
): SourceDimensions {
  const height = Math.min(targetHeight, source.height);
  const width = Math.max(
    2,
    Math.floor((source.width * height) / source.height / 2) * 2
  );
  return { width, height };
}

async function uploadVariant(
  videoId: number,
  quality: string,
  directory: string
) {
  const playlistPath = path.join(directory, "variant.m3u8");
  let playlist = await fs.readFile(playlistPath, "utf8");
  const lines = playlist.split(/\r?\n/);
  const uploadedSegments = new Map<string, string>();

  for (let index = 0; index < lines.length; index += 1) {
    const segmentName = lines[index].trim();
    if (
      !segmentName ||
      segmentName.startsWith("#") ||
      !segmentName.endsWith(".ts")
    ) {
      continue;
    }
    if (!uploadedSegments.has(segmentName)) {
      const segment = await storagePut(
        `videos/${videoId}/hls/${quality}/${segmentName}`,
        await fs.readFile(path.join(directory, segmentName)),
        "video/mp2t"
      );
      uploadedSegments.set(segmentName, segment.url);
    }
    lines[index] = uploadedSegments.get(segmentName) as string;
  }

  playlist = lines.join("\n");
  const uploadedPlaylist = await storagePut(
    `videos/${videoId}/hls/${quality}/variant.m3u8`,
    playlist,
    "application/vnd.apple.mpegurl"
  );
  return uploadedPlaylist.url;
}

export async function transcodeVideoToHls(videoId: number, sourceUrl: string) {
  if (activeTranscodes.has(videoId)) return;
  activeTranscodes.add(videoId);

  let tempRoot: string | undefined;
  try {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), `kinba-hls-${videoId}-`)
    );
    const inputPath = path.join(tempRoot, "source-video");
    await updateVideoProcessing(videoId, {
      status: "PROCESSING",
      processingError: null,
    });

    const sourceBuffer = await storageDownload(sourceUrl);
    if (!sourceBuffer.length) {
      throw new Error("The source video file is missing or empty.");
    }
    await fs.writeFile(inputPath, sourceBuffer);
    const sourceDimensions = await probeDimensions(inputPath);
    const availableVariants = variants.filter(
      variant => sourceDimensions.height >= variant.height
    );
    if (!availableVariants.length) {
      throw new Error(
        "The source video must be at least 240 pixels high for HLS processing."
      );
    }

    const sources: VideoSourceInput[] = [
      { quality: "ORIGINAL", videoUrl: sourceUrl },
    ];
    const masterLines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-INDEPENDENT-SEGMENTS",
    ];

    for (const variant of availableVariants) {
      const directory = path.join(tempRoot, variant.quality);
      const dimensions = variantDimensions(sourceDimensions, variant.height);
      await fs.mkdir(directory);
      await execFileAsync(
        process.env.FFMPEG_BIN || "ffmpeg",
        [
          "-y",
          "-i",
          inputPath,
          "-map",
          "0:v:0",
          "-map",
          "0:a?",
          "-vf",
          `scale=${dimensions.width}:${dimensions.height}:flags=lanczos,format=yuv420p`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-profile:v",
          "main",
          "-b:v",
          `${variant.bandwidth}`,
          "-maxrate",
          `${Math.round(variant.bandwidth * 1.15)}`,
          "-bufsize",
          `${variant.bandwidth * 2}`,
          "-g",
          `${segmentDurationSeconds * 30}`,
          "-keyint_min",
          `${segmentDurationSeconds * 30}`,
          "-sc_threshold",
          "0",
          "-force_key_frames",
          `expr:gte(t,n_forced*${segmentDurationSeconds})`,
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-f",
          "hls",
          "-hls_time",
          `${segmentDurationSeconds}`,
          "-hls_playlist_type",
          "vod",
          "-hls_flags",
          "independent_segments",
          "-hls_segment_filename",
          path.join(directory, "segment-%03d.ts"),
          path.join(directory, "variant.m3u8"),
        ],
        { maxBuffer: 8 * 1024 * 1024 }
      );

      const playlistUrl = await uploadVariant(
        videoId,
        variant.quality,
        directory
      );
      sources.push({ quality: variant.quality, videoUrl: playlistUrl });
      masterLines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},AVERAGE-BANDWIDTH=${Math.round(variant.bandwidth * 0.85)},RESOLUTION=${dimensions.width}x${dimensions.height}`,
        playlistUrl
      );
    }

    const master = await storagePut(
      `videos/${videoId}/hls/master.m3u8`,
      `${masterLines.join("\n")}\n`,
      "application/vnd.apple.mpegurl"
    );
    await replaceVideoSources(videoId, sources);
    await updateVideoProcessing(videoId, {
      status: "READY",
      hlsMasterUrl: master.url,
      videoUrl: master.url,
      processingError: null,
    });
  } catch (error) {
    try {
      await updateVideoProcessing(videoId, {
        status: "FAILED",
        processingError: errorMessage(error),
      });
    } catch (statusError) {
      console.error(
        `[HLS] Could not mark video ${videoId} as FAILED:`,
        statusError
      );
    }
    console.error(`[HLS] Video ${videoId} processing failed:`, error);
  } finally {
    activeTranscodes.delete(videoId);
    if (tempRoot) {
      await fs
        .rm(tempRoot, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
}

function enqueueVideoTranscode(videoId: number, sourceUrl: string) {
  const queuedJob = hlsJobQueue.then(async () => {
    await transcodeVideoToHls(videoId, sourceUrl);
    if (recoveryDelayMs) await sleep(recoveryDelayMs);
  });
  // Keep the queue alive if an unexpected error escapes a job. The individual
  // job logs and marks normal processing failures itself.
  hlsJobQueue = queuedJob.catch(error => {
    console.error(`[HLS] Queued job ${videoId} crashed unexpectedly:`, error);
  });
  return queuedJob;
}

export function queueVideoTranscode(videoId: number, sourceUrl: string) {
  void enqueueVideoTranscode(videoId, sourceUrl);
}

export async function resumeVideoTranscodes() {
  const pendingVideos = await listVideosAwaitingTranscode();
  for (const video of pendingVideos) {
    void enqueueVideoTranscode(video.id, video.videoUrl);
  }
  if (pendingVideos.length) {
    console.log(
      `[HLS] Queued ${pendingVideos.length} unfinished transcode job(s) sequentially ` +
        `(delay ${recoveryDelayMs}ms).`
    );
  }
}

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { replaceVideoSources, updateVideoProcessing, type VideoSourceInput } from "./db";
import { storagePut } from "./storage";

const execFileAsync = promisify(execFile);
const variants = [
  { quality: "1080P" as const, height: 1080, bandwidth: 5_000_000 },
  { quality: "720P" as const, height: 720, bandwidth: 2_800_000 },
  { quality: "480P" as const, height: 480, bandwidth: 1_400_000 },
  { quality: "240P" as const, height: 240, bandwidth: 600_000 },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1000) : "HLS processing failed.";
}

async function uploadVariant(videoId: number, quality: string, directory: string) {
  const playlistPath = path.join(directory, "variant.m3u8");
  let playlist = await fs.readFile(playlistPath, "utf8");
  const lines = playlist.split(/\r?\n/);
  const uploadedSegments = new Map<string, string>();
  for (let index = 0; index < lines.length; index += 1) {
    const segmentName = lines[index].trim();
    if (!segmentName || segmentName.startsWith("#") || !segmentName.endsWith(".ts")) continue;
    if (!uploadedSegments.has(segmentName)) {
      const segment = await storagePut(`videos/${videoId}/hls/${quality}/${segmentName}`, await fs.readFile(path.join(directory, segmentName)), "video/mp2t");
      uploadedSegments.set(segmentName, segment.url);
    }
    lines[index] = uploadedSegments.get(segmentName) as string;
  }
  playlist = lines.join("\n");
  const uploadedPlaylist = await storagePut(`videos/${videoId}/hls/${quality}/variant.m3u8`, playlist, "application/vnd.apple.mpegurl");
  return uploadedPlaylist.url;
}

export async function transcodeVideoToHls(videoId: number, sourceUrl: string) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `kinba-hls-${videoId}-`));
  const inputPath = path.join(tempRoot, "source-video");
  try {
    await updateVideoProcessing(videoId, { status: "PROCESSING", processingError: null });
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Source video download failed (${response.status}).`);
    await fs.writeFile(inputPath, Buffer.from(await response.arrayBuffer()));
    const sources: VideoSourceInput[] = [{ quality: "ORIGINAL", videoUrl: sourceUrl }];
    const masterLines = ["#EXTM3U", "#EXT-X-VERSION:3"];
    for (const variant of variants) {
      const directory = path.join(tempRoot, variant.quality);
      await fs.mkdir(directory);
      await execFileAsync(process.env.FFMPEG_BIN || "ffmpeg", [
        "-y", "-i", inputPath,
        "-vf", `scale=-2:min(${variant.height},ih)`,
        "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main",
        "-b:v", `${variant.bandwidth}`, "-maxrate", `${Math.round(variant.bandwidth * 1.15)}`, "-bufsize", `${variant.bandwidth * 2}`,
        "-c:a", "aac", "-b:a", "128k", "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
        "-hls_segment_filename", path.join(directory, "segment-%03d.ts"), path.join(directory, "variant.m3u8"),
      ], { maxBuffer: 8 * 1024 * 1024 });
      const playlistUrl = await uploadVariant(videoId, variant.quality, directory);
      sources.push({ quality: variant.quality, videoUrl: playlistUrl });
      masterLines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=0x${variant.height}`, playlistUrl);
    }
    const master = await storagePut(`videos/${videoId}/hls/master.m3u8`, `${masterLines.join("\n")}\n`, "application/vnd.apple.mpegurl");
    await replaceVideoSources(videoId, sources);
    await updateVideoProcessing(videoId, { status: "READY", hlsMasterUrl: master.url, videoUrl: master.url, processingError: null });
  } catch (error) {
    await updateVideoProcessing(videoId, { status: "FAILED", processingError: errorMessage(error) });
    console.error(`[HLS] Video ${videoId} processing failed:`, error);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function queueVideoTranscode(videoId: number, sourceUrl: string) {
  void transcodeVideoToHls(videoId, sourceUrl);
}

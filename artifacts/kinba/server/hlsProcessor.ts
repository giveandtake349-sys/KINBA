/**
 * HLS processing is intentionally disabled for the Render deployment.
 * KINBA stores and plays the original R2 object directly; keeping this module
 * as a compatibility shim avoids breaking older imports or tests.
 */

export function queueVideoTranscode(videoId: number, sourceUrl: string) {
  console.info("[HLS] Disabled; using direct R2 playback", { videoId, sourceUrl });
}

export async function resumeVideoTranscodes() {
  return;
}

export async function transcodeVideoToHls(videoId: number, sourceUrl: string) {
  console.info("[HLS] Disabled; skipping transcode", { videoId, sourceUrl });
}

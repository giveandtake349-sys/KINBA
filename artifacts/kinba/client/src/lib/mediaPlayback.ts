export type PlaybackFailure =
  | "missing-source"
  | "unsupported-codec"
  | "network-failure"
  | "temporary-stream-failure"
  | "unknown";

const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

function isDevelopment() {
  return import.meta.env?.DEV === true;
}

function mediaErrorCodeLabel(code: number | undefined) {
  switch (code) {
    case 1:
      return "aborted";
    case 2:
      return "network";
    case 3:
      return "decode";
    case 4:
      return "unsupported";
    default:
      return "unknown";
  }
}

export function describePlaybackFailure(
  element: HTMLVideoElement | null,
  sourceUrl: string | null | undefined
): { kind: PlaybackFailure; message: string } {
  if (!sourceUrl?.trim()) {
    return {
      kind: "missing-source",
      message: "This video has no playable source.",
    };
  }

  const mediaError = element?.error;
  if (mediaError?.code === MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return {
      kind: "unsupported-codec",
      message:
        "This video format is not supported on this device. An AVC/H.264 version may be required.",
    };
  }
  if (mediaError?.code === MEDIA_ERR_NETWORK) {
    return {
      kind: "network-failure",
      message:
        "The video could not be downloaded. Check your connection and try again.",
    };
  }
  if (mediaError?.code === MEDIA_ERR_ABORTED) {
    return {
      kind: "temporary-stream-failure",
      message: "Video loading was interrupted. Please try again.",
    };
  }
  if (mediaError?.code === MEDIA_ERR_DECODE) {
    return {
      kind: "unsupported-codec",
      message:
        "This video could not be decoded on this device. An AVC/H.264 version may be required.",
    };
  }
  return {
    kind: "unknown",
    message: "This video stream could not be loaded. Please try again.",
  };
}

export function logPlaybackEvent(
  eventName: string,
  element: HTMLVideoElement | null,
  sourceUrl: string | null | undefined,
  details?: Record<string, unknown>
) {
  if (!isDevelopment()) return;
  console.debug("[KINBA playback]", {
    event: eventName,
    sourceUrl: sourceUrl || null,
    readyState: element?.readyState ?? null,
    networkState: element?.networkState ?? null,
    currentTime: element?.currentTime ?? null,
    duration: Number.isFinite(element?.duration) ? element?.duration : null,
    mediaError: element?.error
      ? {
          code: element.error.code,
          message:
            element.error.message || mediaErrorCodeLabel(element.error.code),
        }
      : null,
    ...details,
  });
}

export function logVideoCapabilities(
  element: HTMLVideoElement,
  sourceUrl: string,
  videoId: number
) {
  if (!isDevelopment()) return;
  const nativeHls = element.canPlayType("application/vnd.apple.mpegurl");
  const avc = element.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  const hevc = element.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"');
  logPlaybackEvent("capability-check", element, sourceUrl, {
    videoId,
    nativeHls,
    avc,
    hevc,
    mediaSource: typeof MediaSource !== "undefined",
  });

  const mediaCapabilities = navigator.mediaCapabilities;
  if (!mediaCapabilities?.decodingInfo) return;
  void mediaCapabilities
    .decodingInfo({
      type: "file",
      video: {
        contentType: 'video/mp4; codecs="avc1.42E01E"',
        width: element.videoWidth || 1280,
        height: element.videoHeight || 720,
        bitrate: 2_000_000,
        framerate: 30,
      },
    })
    .then(info => {
      logPlaybackEvent("media-capabilities", element, sourceUrl, {
        videoId,
        supported: info.supported,
        smooth: info.smooth,
        powerEfficient: info.powerEfficient,
      });
    })
    .catch(error => {
      logPlaybackEvent("media-capabilities-error", element, sourceUrl, {
        videoId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function shouldUseHlsJs(
  element: HTMLVideoElement,
  sourceUrl: string,
  hlsSupported: boolean
) {
  if (!/\.m3u8(?:$|\?)/i.test(sourceUrl)) return false;
  if (element.canPlayType("application/vnd.apple.mpegurl")) return false;
  return hlsSupported;
}

export function attachPlaybackDiagnostics(
  element: HTMLVideoElement,
  sourceUrl: string,
  videoId: number
) {
  const events = [
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "playing",
    "stalled",
    "waiting",
    "abort",
    "error",
  ] as const;
  const handlers = events.map(eventName => {
    const handler = () =>
      logPlaybackEvent(eventName, element, sourceUrl, { videoId });
    element.addEventListener(eventName, handler);
    return [eventName, handler] as const;
  });
  logVideoCapabilities(element, sourceUrl, videoId);
  return () => {
    handlers.forEach(([eventName, handler]) =>
      element.removeEventListener(eventName, handler)
    );
  };
}

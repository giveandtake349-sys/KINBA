import { supabase } from "@/lib/supabase";

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_MEDIA_DURATION_SECONDS = 15;
export const MAX_MEDIA_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_LONG_VIDEO_DURATION_SECONDS = 30 * 60;
export const MAX_SHORT_VIDEO_DURATION_SECONDS = 60;
export const MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS = 5 * 60;
export const MAX_VIDEO_DIMENSION = 1080;
export const MAX_ANNOUNCEMENT_VIDEO_DIMENSION = 1920;
export const MAX_VIDEO_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;

const allowedImageTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

type AllowedImageType = keyof typeof allowedImageTypes;
const allowedMediaTypes = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "video/webm",
  "video/mp4",
  "video/quicktime",
  "video/ogg",
]);
type MediaKind = "post" | "chat" | "avatar" | "comment";
export type SignalMediaType = "AUDIO" | "VIDEO";

const mediaBuckets: Record<MediaKind, string> = {
  post: "post-media",
  chat: "chat-media",
  avatar: "avatars",
  comment: "comment-media",
};

export function validateMediaFile(file: File): SignalMediaType {
  if (!allowedMediaTypes.has(file.type))
    throw new Error("Choose a supported audio or video file.");
  if (file.size > MAX_MEDIA_SIZE_BYTES)
    throw new Error("Audio and video files must be 25MB or smaller.");
  return file.type.startsWith("audio/") ? "AUDIO" : "VIDEO";
}

export async function getMediaDuration(file: File): Promise<number> {
  const mediaType = validateMediaFile(file);
  const previewUrl = URL.createObjectURL(file);
  const media = document.createElement(
    mediaType === "AUDIO" ? "audio" : "video"
  );
  media.preload = "metadata";
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      URL.revokeObjectURL(previewUrl);
      media.remove();
    };
    media.onloadedmetadata = () => {
      const duration = media.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0)
        return reject(new Error("The media duration could not be read."));
      if (duration > MAX_MEDIA_DURATION_SECONDS + 0.05)
        return reject(
          new Error("Signal audio and video must be 15 seconds or shorter.")
        );
      resolve(Math.ceil(duration));
    };
    media.onerror = () => {
      cleanup();
      reject(new Error("This media file could not be previewed."));
    };
    media.src = previewUrl;
  });
}

function isAllowedImageType(type: string): type is AllowedImageType {
  return type in allowedImageTypes;
}

export function validateImageFile(file: File): void {
  if (!isAllowedImageType(file.type)) {
    throw new Error("Choose a JPG, PNG, WEBP, or GIF image.");
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Images must be 5MB or smaller.");
  }
}

export type VideoUploadKind = "LONG" | "SHORT" | "ANNOUNCEMENT";
export type VideoMetadata = {
  durationSeconds: number;
  width: number;
  height: number;
};
export async function getVideoMetadata(
  file: File,
  options: {
    maxDurationSeconds: number;
    orientation: "square" | "portrait" | "any";
    maxDimension?: number;
  }
): Promise<VideoMetadata> {
  if (!file.type.startsWith("video/"))
    throw new Error("Choose a supported video file.");
  if (file.size > MAX_VIDEO_UPLOAD_SIZE_BYTES)
    throw new Error("Videos must be 500MB or smaller.");
  const previewUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      URL.revokeObjectURL(previewUrl);
      video.remove();
    };
    video.onloadedmetadata = () => {
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0 || !width || !height)
        return reject(new Error("The video metadata could not be read."));
      if (duration > options.maxDurationSeconds + 0.05)
        return reject(
          new Error(
            `Videos must be ${Math.floor(options.maxDurationSeconds / 60)} minutes or shorter.`
          )
        );
      const maxDimension = options.maxDimension ?? MAX_VIDEO_DIMENSION;
      if (width > maxDimension || height > maxDimension)
        return reject(new Error(`Videos must be ${maxDimension}p or smaller.`));
      if (options.orientation === "square" && width !== height)
        return reject(
          new Error("Long-form videos must use a 1:1 square layout.")
        );
      if (options.orientation === "portrait" && height <= width)
        return reject(new Error("Shorts must use a vertical portrait layout."));
      resolve({ durationSeconds: Math.ceil(duration), width, height });
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("This video could not be previewed."));
    };
    video.src = previewUrl;
  });
}
export async function uploadVideo(
  file: File,
  kind: VideoUploadKind
): Promise<string> {
  if (!file.type.startsWith("video/"))
    throw new Error("Choose a supported video file.");
  if (file.size > MAX_VIDEO_UPLOAD_SIZE_BYTES)
    throw new Error("Videos must be 500MB or smaller.");
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session)
    throw new Error("Please sign in before uploading video.");
  const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const objectPath = `${sessionData.session.user.id}/video-${kind.toLowerCase()}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("signal-media")
    .upload(objectPath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage
    .from("signal-media")
    .getPublicUrl(objectPath);
  if (!data.publicUrl)
    throw new Error(
      "The video uploaded, but its public URL could not be created."
    );
  return data.publicUrl;
}
export async function uploadMedia(
  file: File,
  mediaType: SignalMediaType
): Promise<string> {
  validateMediaFile(file);
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session)
    throw new Error("Please sign in before uploading media.");
  const extension =
    file.name.split(".").pop()?.toLowerCase() ||
    (mediaType === "AUDIO" ? "webm" : "mp4");
  const objectPath = `${sessionData.session.user.id}/signal-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("signal-media")
    .upload(objectPath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage
    .from("signal-media")
    .getPublicUrl(objectPath);
  if (!data.publicUrl)
    throw new Error(
      "The media uploaded, but its public URL could not be created."
    );
  return data.publicUrl;
}

export async function uploadImage(
  kind: MediaKind,
  file: File
): Promise<string> {
  validateImageFile(file);

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session)
    throw new Error("Please sign in before uploading an image.");

  const extension = allowedImageTypes[file.type as AllowedImageType];
  const objectPath = `${sessionData.session.user.id}/${kind}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const bucket = mediaBuckets[kind];
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(objectPath, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  if (!data.publicUrl)
    throw new Error(
      "The image uploaded, but its public URL could not be created."
    );

  return data.publicUrl;
}

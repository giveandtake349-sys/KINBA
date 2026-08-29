import { supabase } from "@/lib/supabase";

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_MEDIA_DURATION_SECONDS = 15;
export const MAX_MEDIA_SIZE_BYTES = 25 * 1024 * 1024;

const allowedImageTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

type AllowedImageType = keyof typeof allowedImageTypes;
const allowedMediaTypes = new Set([
  "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg",
  "video/webm", "video/mp4", "video/quicktime", "video/ogg",
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
  if (!allowedMediaTypes.has(file.type)) throw new Error("Choose a supported audio or video file.");
  if (file.size > MAX_MEDIA_SIZE_BYTES) throw new Error("Audio and video files must be 25MB or smaller.");
  return file.type.startsWith("audio/") ? "AUDIO" : "VIDEO";
}

export async function getMediaDuration(file: File): Promise<number> {
  const mediaType = validateMediaFile(file);
  const previewUrl = URL.createObjectURL(file);
  const media = document.createElement(mediaType === "AUDIO" ? "audio" : "video");
  media.preload = "metadata";
  return new Promise((resolve, reject) => {
    const cleanup = () => { URL.revokeObjectURL(previewUrl); media.remove(); };
    media.onloadedmetadata = () => {
      const duration = media.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) return reject(new Error("The media duration could not be read."));
      if (duration > MAX_MEDIA_DURATION_SECONDS + 0.05) return reject(new Error("Signal audio and video must be 15 seconds or shorter."));
      resolve(Math.ceil(duration));
    };
    media.onerror = () => { cleanup(); reject(new Error("This media file could not be previewed.")); };
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

export async function uploadMedia(file: File, mediaType: SignalMediaType): Promise<string> {
  validateMediaFile(file);
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error("Please sign in before uploading media.");
  const extension = file.name.split(".").pop()?.toLowerCase() || (mediaType === "AUDIO" ? "webm" : "mp4");
  const objectPath = `${sessionData.session.user.id}/signal-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("signal-media").upload(objectPath, file, { cacheControl: "3600", contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from("signal-media").getPublicUrl(objectPath);
  if (!data.publicUrl) throw new Error("The media uploaded, but its public URL could not be created.");
  return data.publicUrl;
}

export async function uploadImage(kind: MediaKind, file: File): Promise<string> {
  validateImageFile(file);

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error("Please sign in before uploading an image.");

  const extension = allowedImageTypes[file.type as AllowedImageType];
  const objectPath = `${sessionData.session.user.id}/${kind}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const bucket = mediaBuckets[kind];
  const { error: uploadError } = await supabase.storage.from(bucket).upload(objectPath, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  if (!data.publicUrl) throw new Error("The image uploaded, but its public URL could not be created.");

  return data.publicUrl;
}

import { supabase } from "@/lib/supabase";

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_LONG_VIDEO_DURATION_SECONDS = 30 * 60;
export const MAX_SHORT_VIDEO_DURATION_SECONDS = 60;
export const MAX_ANNOUNCEMENT_VIDEO_DURATION_SECONDS = 5 * 60;

const allowedImageTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;
type AllowedImageType = keyof typeof allowedImageTypes;
type MediaKind = "post" | "avatar" | "comment";
export type VideoUploadKind = "LONG" | "SHORT" | "ANNOUNCEMENT";
export type VideoMetadata = {
  durationSeconds: number;
  width: number;
  height: number;
};

function isAllowedImageType(type: string): type is AllowedImageType {
  return type in allowedImageTypes;
}

export function validateImageFile(file: File): void {
  if (!isAllowedImageType(file.type))
    throw new Error("Choose a JPG, PNG, WEBP, or GIF image.");
  if (file.size > MAX_IMAGE_SIZE_BYTES)
    throw new Error("Images must be 5MB or smaller.");
}

export async function getVideoMetadata(
  file: File,
  options: { maxDurationSeconds: number }
): Promise<VideoMetadata> {
  if (!file.type.startsWith("video/"))
    throw new Error("Choose a supported video file.");
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
      if (duration > options.maxDurationSeconds + 0.05) {
        const minutes = options.maxDurationSeconds / 60;
        return reject(
          new Error(
            `Videos must be ${minutes === 1 ? "1 minute" : `${minutes} minutes`} or shorter.`
          )
        );
      }
      resolve({ durationSeconds: Math.ceil(duration), width, height });
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("This video could not be previewed."));
    };
    video.src = previewUrl;
  });
}

async function getSessionUserId(message: string) {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error(message);
  return sessionData.session.user.id;
}

export async function publishVideo(
  file: File,
  kind: VideoUploadKind,
  title: string,
  description: string
): Promise<{ videoId: number; status: string }> {
  if (!file.type.startsWith("video/")) throw new Error("Choose a supported video file.");
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const session = sessionData.session;
  if (!session) throw new Error("Please sign in before uploading video.");
  const body = new FormData();
  body.append("video", file, file.name);
  body.append("kind", kind);
  body.append("title", title);
  body.append("description", description);
  const response = await fetch("/api/videos/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as { videoId?: number; status?: string; error?: string };
  if (!response.ok || !payload.videoId) throw new Error(payload.error || "The video could not be published.");
  return { videoId: payload.videoId, status: payload.status || "PROCESSING" };
}

export async function uploadVideo(
  file: File,
  kind: VideoUploadKind
): Promise<string> {
  if (!file.type.startsWith("video/"))
    throw new Error("Choose a supported video file.");
  const userId = await getSessionUserId(
    "Please sign in before uploading video."
  );
  const extension = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const objectPath = `${userId}/video-${kind.toLowerCase()}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
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

export async function uploadImage(
  kind: MediaKind,
  file: File
): Promise<string> {
  validateImageFile(file);
  const userId = await getSessionUserId(
    "Please sign in before uploading an image."
  );
  const extension = allowedImageTypes[file.type as AllowedImageType];
  const objectPath = `${userId}/${kind}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const bucket =
    kind === "avatar"
      ? "avatars"
      : kind === "comment"
        ? "comment-media"
        : "post-media";
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

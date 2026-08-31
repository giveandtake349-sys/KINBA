import { apiUrl } from "@/lib/api";
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

export function validatePhotoFile(file: File): void {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPG, PNG, or WEBP image.");
  if (file.size > MAX_IMAGE_SIZE_BYTES)
    throw new Error("Images must be 5MB or smaller.");
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

async function fetchUploadWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (![502, 503, 504].includes(response.status) || attempt === attempts - 1)
        return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw lastError;
    }
    await new Promise(resolve => window.setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Upload request failed.");
}

async function getUploadSession(message: string) {
  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  if (current.data.session) return current.data.session;
  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error) throw refreshed.error;
  if (!refreshed.data.session) throw new Error(message);
  return refreshed.data.session;
}

async function getSessionUserId(message: string) {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error(message);
  return sessionData.session.user.id;
}

export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  validatePhotoFile(file);
  const previewUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      URL.revokeObjectURL(previewUrl);
      image.remove();
    };
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      cleanup();
      if (!dimensions.width || !dimensions.height)
        return reject(new Error("The image dimensions could not be read."));
      resolve(dimensions);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("This image could not be previewed."));
    };
    image.src = previewUrl;
  });
}

export async function publishPhoto(
  file: File,
  title: string,
  description: string,
  dimensions: { width: number; height: number }
): Promise<{ postId: number; status: string; imageUrl: string }> {
  validatePhotoFile(file);
  const session = await getUploadSession("Please sign in before uploading a photo.");

  const body = new FormData();
  body.append("photo", file, file.name);
  body.append("title", title);
  body.append("description", description);
  body.append("width", String(dimensions.width));
  body.append("height", String(dimensions.height));
  let response: Response;
  try {
    response = await fetchUploadWithRetry(apiUrl("/api/photos/upload"), {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      credentials: "include",
      body,
    });
  } catch {
    throw new Error(
      "The photo upload service could not be reached. Check the Render service URL and CORS_ORIGIN configuration."
    );
  }
  const payload = (await response.json().catch(() => ({}))) as {
    postId?: number;
    status?: string;
    imageUrl?: string;
    error?: string;
  };
  if (!response.ok || !payload.postId || !payload.imageUrl)
    throw new Error(payload.error || "The photo could not be published.");
  return {
    postId: payload.postId,
    status: payload.status || "PUBLISHED",
    imageUrl: payload.imageUrl,
  };
}

export async function publishVideo(
  file: File,
  kind: VideoUploadKind,
  title: string,
  description: string
): Promise<{ videoId: number; status: string; videoUrl: string }> {
  if (!file.type.startsWith("video/"))
    throw new Error("Choose a supported video file.");
  const session = await getUploadSession("Please sign in before uploading video.");
  const body = new FormData();
  body.append("video", file, file.name);
  body.append("kind", kind);
  body.append("title", title);
  body.append("description", description);
  let response: Response;
  try {
    response = await fetchUploadWithRetry(apiUrl("/api/videos/upload"), {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      credentials: "include",
      body,
    });
  } catch {
    throw new Error(
      "The video upload service could not be reached. Check the Render service URL and CORS_ORIGIN configuration."
    );
  }
  const payload = (await response.json().catch(() => ({}))) as {
    videoId?: number;
    status?: string;
    videoUrl?: string;
    error?: string;
  };
  if (!response.ok || !payload.videoId || !payload.videoUrl)
    throw new Error(payload.error || "The video could not be published.");
  return {
    videoId: payload.videoId,
    status: payload.status || "PUBLISHED",
    videoUrl: payload.videoUrl,
  };
}

export async function uploadVideo(
  file: File,
  kind: VideoUploadKind
): Promise<string> {
  if (!file.type.startsWith("video/"))
    throw new Error("Choose a supported video file.");
  const session = await getUploadSession("Please sign in before uploading video.");

  const body = new FormData();
  body.append("video", file, file.name);
  body.append("kind", kind);
  let response: Response;
  try {
    response = await fetchUploadWithRetry(apiUrl("/api/media/video-upload"), {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      credentials: "include",
      body,
    });
  } catch {
    throw new Error(
      "The video upload service could not be reached. Check the Render service URL and CORS_ORIGIN configuration."
    );
  }
  const payload = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!response.ok || !payload.url)
    throw new Error(payload.error || "The video could not be uploaded.");
  return payload.url;
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

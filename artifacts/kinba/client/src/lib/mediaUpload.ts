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

function logUploadRequest(kind: "video" | "photo", url: string, fields: Record<string, string>, file: File) {
  console.info("[MediaPublish] request", {
    kind,
    url,
    fields,
    file: { name: file.name, type: file.type, size: file.size },
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

type UploadPayload = {
  postId?: number;
  videoId?: number;
  status?: string;
  videoUrl?: string;
  thumbnailUrl?: string | null;
  imageUrl?: string;
  uploadUrl?: string;
  publicUrl?: string;
  url?: string;
  error?: string;
};

async function readUploadPayload(response: Response): Promise<UploadPayload> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as UploadPayload) : {};
  } catch {
    return { error: text.trim().slice(0, 240) };
  }
}

function uploadFailureMessage(response: Response, payload: UploadPayload, resource: string) {
  if (response.status === 404) {
    return resource + " upload endpoint was not found. Check that the Render domain is attached to the KINBA API service, not a static-only deployment.";
  }
  return payload.error || resource + " publish failed with HTTP " + response.status + ".";
}

async function getUploadSession(message: string) {
  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  const session = current.data.session;
  if (
    session &&
    (!session.expires_at || session.expires_at * 1000 > Date.now() + 60_000)
  ) {
    return session;
  }
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
  const endpoint = apiUrl("/api/photos/upload");
  logUploadRequest("photo", endpoint, { title, description, width: String(dimensions.width), height: String(dimensions.height) }, file);
  let response: Response;
  try {
    response = await fetchUploadWithRetry(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      credentials: "include",
      body,
    });
  } catch (error) {
    console.error("[MediaPublish] photo network failure", error);
    throw new Error(`Photo upload request failed: ${error instanceof Error ? error.message : "network error"}`);
  }
  const payload = await readUploadPayload(response);
  if (!response.ok || !payload.postId || !payload.imageUrl) {
    console.error("[MediaPublish] photo API rejection", { status: response.status, payload });
    throw new Error(uploadFailureMessage(response, payload, "Photo"));
  }
  return {
    postId: payload.postId,
    status: payload.status || "PUBLISHED",
    imageUrl: payload.imageUrl,
  };
}

async function uploadDirectToR2(
  file: Blob,
  kind: VideoUploadKind,
  mediaRole: "source" | "thumbnail",
  accessToken: string
): Promise<string> {
  const signResponse = await fetchUploadWithRetry(apiUrl("/api/videos/upload-url"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ contentType: file.type, kind, mediaRole }),
  });
  const signed = await readUploadPayload(signResponse);
  const uploadUrl = signed.uploadUrl ?? signed.url;
  if (!signResponse.ok || !uploadUrl || !signed.publicUrl)
    throw new Error(uploadFailureMessage(signResponse, signed, "Media"));
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!uploadResponse.ok)
    throw new Error(`R2 media upload failed with HTTP ${uploadResponse.status}.`);
  return signed.publicUrl;
}

async function captureVideoThumbnail(file: File): Promise<Blob | null> {
  const previewUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.src = previewUrl;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("thumbnail metadata unavailable"));
    });
    video.currentTime = Math.min(0.2, Math.max(0, video.duration / 2));
    await new Promise<void>(resolve => {
      video.onseeked = () => resolve();
      window.setTimeout(resolve, 800);
    });
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;
    const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const thumbnail = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, "image/jpeg", 0.82)
    );
    canvas.width = 1;
    canvas.height = 1;
    return thumbnail;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(previewUrl);
    video.remove();
  }
}

export async function publishVideo(
  file: File,
  kind: VideoUploadKind,
  title: string,
  description: string,
  metadata?: VideoMetadata
): Promise<{ videoId: number; status: string; videoUrl: string }> {
  if (!file.type.startsWith("video/"))
    throw new Error("Choose a supported video file.");
  const session = await getUploadSession("Please sign in before uploading video.");
  const resolvedMetadata = metadata ?? await getVideoMetadata(file, {
    maxDurationSeconds: kind === "SHORT" ? MAX_SHORT_VIDEO_DURATION_SECONDS : MAX_LONG_VIDEO_DURATION_SECONDS,
  });
  const videoUrl = await uploadDirectToR2(file, kind, "source", session.access_token);
  let thumbnailUrl: string | null = null;
  try {
    const thumbnail = await captureVideoThumbnail(file);
    if (thumbnail) {
      thumbnailUrl = await uploadDirectToR2(
        new File([thumbnail], "thumbnail.jpg", { type: "image/jpeg" }),
        kind,
        "thumbnail",
        session.access_token
      );
    }
  } catch (error) {
    // A thumbnail is an enhancement; never strand an already-uploaded video
    // because a browser decoder or optional R2 thumbnail PUT failed.
    console.warn("[MediaPublish] optional thumbnail unavailable", error);
  }
  const response = await fetchUploadWithRetry(apiUrl("/api/videos/complete"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      kind,
      title,
      description,
      videoUrl,
      thumbnailUrl,
      ...resolvedMetadata,
    }),
  });
  const payload = await readUploadPayload(response);
  if (!response.ok || !payload.videoId || !payload.videoUrl)
    throw new Error(uploadFailureMessage(response, payload, "Video"));
  return { videoId: payload.videoId, status: payload.status || "PUBLISHED", videoUrl: payload.videoUrl };
}

export async function uploadVideo(
  file: File,
  kind: VideoUploadKind
): Promise<string> {
  if (!file.type.startsWith("video/"))
    throw new Error("Choose a supported video file.");
  const session = await getUploadSession("Please sign in before uploading video.");
  // Keep announcement attachments on the same signed Cloudflare R2 path as
  // published videos. This avoids the removed legacy multipart route.
  return uploadDirectToR2(file, kind, "source", session.access_token);
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

import { supabase } from "@/lib/supabase";

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const allowedImageTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

type AllowedImageType = keyof typeof allowedImageTypes;
type MediaKind = "post" | "chat";

const mediaBuckets: Record<MediaKind, string> = {
  post: "post-media",
  chat: "chat-media",
};

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

import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiUrl } from "@/lib/api";

type SaveImageResult = {
  uri: string;
  name: string;
  mime: string;
};

/**
 * Native Android gallery writer (see android/.../GalleryDownloadPlugin.java).
 * Only registered in the Android build, so the web bundle never uses it.
 */
const GalleryDownload = registerPlugin<{
  saveImage(options: { url: string }): Promise<SaveImageResult>;
}>("GalleryDownload");

/** True only inside the Capacitor Android app (not browser, not iOS). */
export function isAndroidApp(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * The WebView origin (https://localhost) cannot resolve relative media paths,
 * and native fetch only accepts absolute http(s) URLs — so `/api/media/...`
 * links are pointed at the API host before they cross the bridge.
 * blob:/data: URLs are intentionally rejected: nothing native can save them.
 */
export function toAbsoluteImageUrl(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("This photo has no downloadable link.");
  if (/^(blob|data):/i.test(trimmed)) {
    throw new Error("This photo cannot be downloaded.");
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return apiUrl(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
}

/**
 * Saves the photo into the device gallery (Pictures/KINBA) via MediaStore.
 * Resolves only after the bytes are committed; rejects with the native
 * message (permission denied, non-image, network/storage failure).
 */
export async function saveImageToGallery(source: string): Promise<SaveImageResult> {
  const url = toAbsoluteImageUrl(source);
  return GalleryDownload.saveImage({ url });
}

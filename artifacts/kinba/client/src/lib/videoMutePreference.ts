import { useSyncExternalStore } from "react";

// Keep the existing key so users retain the preference they already set in Shorts.
const VIDEO_MUTE_STORAGE_KEY = "kinba.shorts.muted";
const listeners = new Set<() => void>();
let inMemoryPreference: boolean | undefined;

export function getVideoMutePreference(): boolean {
  if (inMemoryPreference !== undefined) return inMemoryPreference;
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(VIDEO_MUTE_STORAGE_KEY);
    inMemoryPreference = stored === "false" ? false : true;
  } catch {
    inMemoryPreference = true;
  }
  return inMemoryPreference;
}

export function setVideoMutePreference(muted: boolean): void {
  inMemoryPreference = muted;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(VIDEO_MUTE_STORAGE_KEY, String(muted));
    } catch {
      // Keep the in-memory preference usable when browser storage is unavailable.
    }
  }
  listeners.forEach(listener => listener());
}

export function subscribeToVideoMutePreference(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === VIDEO_MUTE_STORAGE_KEY || event.key === null) {
      inMemoryPreference = event.newValue === "false" ? false : true;
      listener();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function useVideoMutePreference(): boolean {
  return useSyncExternalStore(
    subscribeToVideoMutePreference,
    getVideoMutePreference,
    () => true
  );
}

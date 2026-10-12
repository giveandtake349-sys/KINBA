import { describe, expect, it, vi } from "vitest";
import { describePlaybackFailure, shouldUseHlsJs } from "./mediaPlayback";

describe("media playback helpers", () => {
  it("uses HLS.js only when native HLS is unavailable", () => {
    const video = document.createElement("video");
    vi.spyOn(video, "canPlayType").mockReturnValue("");

    expect(
      shouldUseHlsJs(video, "https://cdn.example.com/stream.m3u8", true)
    ).toBe(true);
    expect(
      shouldUseHlsJs(video, "https://cdn.example.com/video.mp4", true)
    ).toBe(false);

    vi.spyOn(video, "canPlayType").mockReturnValue("probably");
    expect(
      shouldUseHlsJs(video, "https://cdn.example.com/stream.m3u8", true)
    ).toBe(false);
  });

  it("reports missing sources before attempting network playback", () => {
    expect(describePlaybackFailure(null, "")).toEqual({
      kind: "missing-source",
      message: "This video has no playable source.",
    });
  });

  it("identifies unsupported codec errors and points to AVC fallback", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "error", {
      configurable: true,
      value: { code: 4, message: "Media resource unsupported" },
    });

    const failure = describePlaybackFailure(
      video,
      "https://cdn.example.com/video.mp4"
    );
    expect(failure.kind).toBe("unsupported-codec");
    expect(failure.message).toContain("AVC/H.264");
  });
});

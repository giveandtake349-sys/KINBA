import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getVideoMutePreference,
  setVideoMutePreference,
  subscribeToVideoMutePreference,
} from "./videoMutePreference";

describe("shared feed video mute preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to muted and persists the user's choice", () => {
    expect(getVideoMutePreference()).toBe(true);

    setVideoMutePreference(false);
    expect(getVideoMutePreference()).toBe(false);

    setVideoMutePreference(true);
    expect(getVideoMutePreference()).toBe(true);
  });

  it("notifies every mounted player when one player changes the preference", () => {
    const firstPlayer = vi.fn();
    const nextPlayer = vi.fn();
    const unsubscribeFirst = subscribeToVideoMutePreference(firstPlayer);
    const unsubscribeNext = subscribeToVideoMutePreference(nextPlayer);

    setVideoMutePreference(false);
    expect(firstPlayer).toHaveBeenCalledTimes(1);
    expect(nextPlayer).toHaveBeenCalledTimes(1);
    expect(getVideoMutePreference()).toBe(false);

    unsubscribeFirst();
    setVideoMutePreference(true);
    expect(firstPlayer).toHaveBeenCalledTimes(1);
    expect(nextPlayer).toHaveBeenCalledTimes(2);
    unsubscribeNext();
  });
});

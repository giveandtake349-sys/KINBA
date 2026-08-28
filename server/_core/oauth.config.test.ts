import { afterEach, describe, expect, it } from "vitest";
import { getPublicOAuthConfig } from "./oauth";

const originalAppId = process.env.VITE_APP_ID;
const originalPortalUrl = process.env.VITE_OAUTH_PORTAL_URL;

afterEach(() => {
  process.env.VITE_APP_ID = originalAppId;
  process.env.VITE_OAUTH_PORTAL_URL = originalPortalUrl;
});

describe("getPublicOAuthConfig", () => {
  it("returns only the public values needed to begin OAuth", () => {
    process.env.VITE_APP_ID = "nivo-public-app-id";
    process.env.VITE_OAUTH_PORTAL_URL = "https://portal.example.test";

    expect(getPublicOAuthConfig()).toEqual({
      appId: "nivo-public-app-id",
      portalUrl: "https://portal.example.test",
    });
  });

  it("returns null when Render has not configured a complete public OAuth contract", () => {
    process.env.VITE_APP_ID = "nivo-public-app-id";
    delete process.env.VITE_OAUTH_PORTAL_URL;

    expect(getPublicOAuthConfig()).toBeNull();
  });
});

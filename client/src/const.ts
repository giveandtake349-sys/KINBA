import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

type OAuthPublicConfig = { appId: string; portalUrl: string };

async function getOAuthPublicConfig(): Promise<OAuthPublicConfig> {
  const builtAppId = import.meta.env.VITE_APP_ID?.trim();
  const builtPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL?.trim();
  if (builtAppId && builtPortalUrl) return { appId: builtAppId, portalUrl: builtPortalUrl };

  const response = await fetch("/api/oauth/config", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("NIVO sign-in is not configured on this deployment.");
  }

  const config = (await response.json()) as Partial<OAuthPublicConfig>;
  if (!config.appId || !config.portalUrl) {
    throw new Error("NIVO sign-in configuration response is incomplete.");
  }
  return { appId: config.appId, portalUrl: config.portalUrl };
}

// Start the Manus OAuth login. Call this from an event handler or effect at the
// moment you want to navigate, e.g. `onClick={() => startLogin()}`.
//
// It has SIDE EFFECTS — it mints a one-time nonce, writes the __Host- state
// cookie, and navigates immediately — so the cookie nonce always matches the
// `state` it sends. Do NOT call it during render (no `href={startLogin()}` /
// `loginUrl={...}`): each call overwrites the cookie, so a stray render-phase
// call would desync it from an in-flight login and the callback would reject it
// with "invalid oauth state". It returns void by design, so there is no URL to
// stash across renders.
export const startLogin = () => {
  void (async () => {
  const { portalUrl: oauthPortalUrl, appId } = await getOAuthPublicConfig();
  const redirectUri = `${window.location.origin}/api/oauth/callback`;

  const nonce = crypto.randomUUID();
  document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=None; Secure`;
  const state = encodeOAuthState({ redirectUri, nonce });

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  window.location.href = url.toString();
  })().catch(error => {
    // Do not create a nonce or attempt a malformed redirect when a deployment
    // is missing public OAuth values; the browser console retains the reason.
    console.error("[OAuth] Unable to start sign-in", error);
  });
};

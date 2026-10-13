# KINBA Loading State Root-Cause Analysis

## Diagnosis

The blocking UI was the `Home` component's auth gate. `useAuth()` reports `loading` while `SupabaseAuthContext` restores the session and while `trpc.auth.me` is loading. `Home` previously returned only the `Loading KINBA…` screen whenever that combined flag was true. Because Supabase session restoration and the Render-backed request have no client timeout, a cold start, unreachable Supabase endpoint, failed deployment, or stalled network request could leave that branch visible indefinitely.

The API client is configured to use the Render backend at `https://kinba.onrender.com`. The frontend did not contain a request timeout or abort controller after the earlier rollback. A read-only recheck on 2026-10-14 returned HTTP 200 from `https://kinba.onrender.com/` and `/api/health`; `https://upbids.vercel.app/` and the legacy `https://ba.onrender.com/` returned HTTP 404. Render is therefore the verified production source of truth at the time of this recheck. These domain results are time-specific and should be revalidated before any future host switch.

## Code-Level Fix

The `Home` component no longer returns an auth-blocking loading screen. It renders the normal landing/dashboard route immediately while session restoration proceeds in the background. This prevents a pending auth or Render cold-start request from blocking the full UI. The existing auth query and natural browser request behavior remain intact.

The API server retains global CORS handling and all preflight requests are handled before the API routes. The frontend API URL remains hardcoded to the Render service as requested.

## 2026-10-14 mobile, performance, and release follow-up

Non-home routes and the heavy `MediaHub` module are now loaded on demand, with a screen-reader status fallback while a route chunk loads. The sign-in landing-page browser check fetched only the `index` entry script; it did not fetch the `MediaHub` chunk. The minified entry fell from 1,756.63 kB (519.45 kB gzip) to 817.39 kB (241.57 kB gzip), a 53.47% reduction in raw entry bytes. `MediaHub` remains a separate 705.94 kB (218.83 kB gzip) chunk that is fetched when the feed is used. Home feed tabs now support arrow-key/Home/End navigation, and Drop/Hype Room filters expose pressed state in labeled groups. Mobile renders at 390px were checked; filter and retry controls measured 44px high, with no visible horizontal overflow.

The workspace now declares `pnpm@10.34.5`, and CI/Render bootstrap the pinned release instead of relying on Corepack's version lookup. A local Corepack test failed signature verification for that exact version; the replacement global npm install was exercised by the local build. On this branch, the KINBA typecheck and workspace production build pass. The full app test suite still reports 48 failures, 1,055 passes, and 2 skipped across 7 failing files—the same failing files as the pre-5–7 baseline, with no newly failing suite.

## Verification

The KINBA frontend typecheck passed, the API server typecheck passed after workspace declarations were built, all 35 enabled tests passed with 2 skipped integration tests, the Vite production build produced `artifacts/kinba/dist/public/index.html`, and the repository diff passed `git diff --check`.

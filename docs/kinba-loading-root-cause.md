# KINBA Loading State Root-Cause Analysis

## Diagnosis

The blocking UI was the `Home` component's auth gate. `useAuth()` reports `loading` while `SupabaseAuthContext` restores the session and while `trpc.auth.me` is loading. `Home` previously returned only the `Loading KINBA…` screen whenever that combined flag was true. Because Supabase session restoration and the Render-backed request have no client timeout, a cold start, unreachable Supabase endpoint, failed deployment, or stalled network request could leave that branch visible indefinitely.

The API client is configured to use the Render backend at `https://kinba.onrender.com`. The frontend did not contain a request timeout or abort controller after the earlier rollback. The deployment probe returned HTTP 200 from `https://kinba.onrender.com/api/health`, while `https://upbids.vercel.app/` currently returned a Vercel HTTP 404, indicating that the public Vercel domain is not serving the expected deployment at the time of analysis.

## Code-Level Fix

The `Home` component no longer returns an auth-blocking loading screen. It renders the normal landing/dashboard route immediately while session restoration proceeds in the background. This prevents a pending auth or Render cold-start request from blocking the full UI. The existing auth query and natural browser request behavior remain intact.

The API server retains global CORS handling and all preflight requests are handled before the API routes. The frontend API URL remains hardcoded to the Render service as requested.

## Verification

The KINBA frontend typecheck passed, the API server typecheck passed after workspace declarations were built, all 35 enabled tests passed with 2 skipped integration tests, the Vite production build produced `artifacts/kinba/dist/public/index.html`, and the repository diff passed `git diff --check`.

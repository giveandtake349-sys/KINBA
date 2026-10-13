# KINBA — repository guide

This repository contains a mobile-first social video and community application in `artifacts/kinba`. The current app UI uses the **JHILIK** product label in several places; the package and repository are named KINBA. This guide describes the code that is actually present rather than the older “I NEED ↔ I CAN” product draft.

## Product capabilities in the current code

| Area                      | Current implementation                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication            | Supabase Auth sign-in/sign-up and persistent browser sessions.                                                                                                                                                                                                                                               |
| Profiles and social graph | Public member profiles, profile editing, follows, follower/following lists, and profile media.                                                                                                                                                                                                               |
| Feed and discovery        | For You, Following, Spotlight, Shorts, hashtag pages, and search across people and posts.                                                                                                                                                                                                                    |
| Publishing                | Text, photo, and video posts; captions, hashtags, mentions, comments, reactions, and saved media.                                                                                                                                                                                                            |
| Hype Rooms                | Community rooms with messages, threads, mentions, reactions, membership and room moderation/report actions.                                                                                                                                                                                                  |
| Drops                     | Time-limited offers with a social reservation/claim flow. **KINBA does not process Drop payments or checkout.**                                                                                                                                                                                              |
| Direct messages           | Conversations, message requests, media/document attachments, and message actions. Conversation blocking is available; there is no account-wide blocked-people list or unblock control.                                                                                                                       |
| Trust and safety          | Users can report supported profiles, rooms, room messages, and Drops. Admin moderation endpoints and account-security controls are present. Private-account/follow-approval settings and several other privacy controls are not implemented; the UI marks them unavailable rather than pretending they work. |

Some server capabilities are feature-flagged. Availability in a deployment therefore depends on its server-side flags and configuration.

## Stack and source map

- **Client:** React 19, TypeScript, Vite, Tailwind CSS, Wouter, TanStack Query, and tRPC.
- **Server:** Express, tRPC, PostgreSQL, Drizzle ORM, and Supabase Auth.
- **Media:** S3-compatible R2 storage and server-side video/HLS processing.
- **Mobile wrapper:** Capacitor Android configuration is included.
- Main client and server: `artifacts/kinba/client/src` and `artifacts/kinba/server`.
- Database schema/migrations: `artifacts/kinba/drizzle`.
- Shared product types: `artifacts/kinba/shared`.
- Workspace helpers: `lib/`.

Primary routes include `/`, `/login`, `/profile`, `/profile/:id`, `/@:username`, `/tag/:tag`, `/drops`, `/drops/:id`, `/rooms`, `/rooms/:id`, `/messages`, `/messages/:id`, and `/settings/:section`.

## Local setup

Use Node.js 22+ and the repository-pinned pnpm version (the lockfile records pnpm 10.34.5):

```bash
pnpm install --frozen-lockfile
```

Set development environment variables through a local secret manager or an untracked `.env` file. Never commit production credentials. Apply schema changes only to an authorized development database:

```bash
pnpm --filter @workspace/kinba db:push
```

Start the KINBA app service from the workspace root:

```bash
pnpm --filter @workspace/kinba dev
```

## Environment variables

The managed Manus environment injects its configured values. External deployments must set their own secrets securely. Never put a Supabase service-role key or R2 write credentials in browser code.

| Variable                                            | Purpose                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_DATABASE_URL`                             | Preferred server-side PostgreSQL connection (Supabase Session Pooler).                                            |
| `DATABASE_URL`                                      | PostgreSQL fallback for hosts such as Render.                                                                     |
| `SUPABASE_URL`                                      | Supabase project URL used by server-side auth verification.                                                       |
| `SUPABASE_ANON_KEY`                                 | Public/anon key used by the server auth integration; never substitute a service-role key in client configuration. |
| `VITE_SUPABASE_URL`                                 | Supabase URL exposed to the browser Auth client.                                                                  |
| `VITE_SUPABASE_ANON_KEY`                            | Supabase publishable/anon key exposed to browser Auth.                                                            |
| `SUPABASE_SERVICE_ROLE_KEY`                         | Server-only privileged Supabase credential, when required by configured server features.                          |
| `CORS_ORIGIN`                                       | Comma-separated allowed frontend origins when the frontend is hosted separately.                                  |
| `VITE_API_BASE_URL`                                 | Currently unused by `client/src/lib/api.ts`, which hardcodes the Render API origin.                               |
| `R2_ENDPOINT`                                       | Server-side S3-compatible R2 endpoint.                                                                            |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`         | Server-only R2 write credentials.                                                                                 |
| `R2_BUCKET_NAME`                                    | R2 bucket for uploaded media and generated HLS assets.                                                            |
| `R2_PUBLIC_BASE_URL`                                | HTTPS public base URL for browser playback of stored media.                                                       |
| `VITE_R2_PUBLIC_BASE_URL`                           | Optional browser build override for the public R2 media base URL.                                                |
| `OWNER_OPEN_ID` / `OWNER_NAME`                      | Owner/admin identity configuration.                                                                               |
| `JWT_SECRET`                                        | Server authentication/runtime secret where required by the deployment.                                            |
| `CROSS_SITE_SESSION`                                | Legacy cookie option; Supabase browser sessions normally do not require it.                                       |
| `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | Optional legacy integration settings for unrelated built-in features.                                             |

The workspace pins `pnpm@10.34.5` in the root `package.json`; CI and Render use that same version. The Render Blueprint is `render.yaml` and builds the full-stack server entry point through the package scripts.

**Verified hosting snapshot (2026-10-14):** `https://kinba.onrender.com/` and `/api/health` returned HTTP 200, so Render is the verified production source of truth. `https://ba.onrender.com/` and `https://upbids.vercel.app/` returned HTTP 404 at that check. The root `vercel.json` is an optional static-client/API-proxy configuration; `artifacts/kinba/vercel.json` is a separate SPA-only configuration for a Vercel project rooted in that subdirectory. The current browser API helper hardcodes the Render origin, so the root Vercel `/api` rewrite is not used by the app code. Recheck domains before any future host switch; neither Vercel configuration was removed or deployed as part of this audit.

## Development and verification commands

| Command                                  | Description                                                           |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `pnpm run typecheck`                     | Typecheck workspace libraries and packages with a `typecheck` script; run the KINBA `check` command separately. |
| `pnpm --filter @workspace/kinba check`   | Typecheck the KINBA app package.                                      |
| `pnpm --filter @workspace/kinba test`    | Run the KINBA Vitest suite.                                           |
| `pnpm build`                             | Typecheck and build the workspace packages.                           |
| `pnpm --filter @workspace/kinba db:push` | Push Drizzle schema to the configured database; development use only. |

Before release, run the applicable typecheck, tests, and production build. Test real account workflows only in an authorized development or staging environment; do not seed or submit fabricated production member data.

## Deployment and data safety

`render.yaml` is the repository’s Render Blueprint and defines `/api/health` as its health check. Keep database, Supabase service-role, and R2 write credentials in the hosting provider’s secret store. The browser uses Supabase Auth sessions and sends access tokens to the API; the server validates them before user-scoped operations. Configure the R2 bucket for browser `GET`/`HEAD` playback while keeping writes private.

Do not run schema push against production without an explicit migration review and backup. Use the production Publish/deploy workflow for the selected host and check health, sign-in, feed, media playback, reporting, and Drop reservation behavior after deployment.

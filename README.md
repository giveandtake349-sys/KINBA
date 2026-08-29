# KINBA — Connect What Matters

KINBA is a mobile-first human matching platform organized around a simple product loop: **I NEED ↔ I CAN**. Members publish real needs or capabilities, browse the live network, create private connection requests, and message only after both people accept a connection.

## MVP capabilities

| Capability        | Implementation                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication    | Supabase Auth Email/Password sign-up, sign-in, sign-out, and persistent browser sessions. Private routes open the KINBA auth dialog for anonymous visitors. |
| Member profiles   | Persistent editable profile data, including country, languages, about, skills, interests, and profile image URL.                                            |
| Signals           | Authenticated members can publish NEED and CAN signals with category, language, and optional location.                                                      |
| Discovery         | Public, database-backed browsing with signal type and category filters.                                                                                     |
| Connections       | Private requests, acceptance, decline, cancellation, and an explicit accepted state.                                                                        |
| Private messaging | Persistent messages available only to participants in an accepted, unblocked connection.                                                                    |
| Trust and safety  | Report and block actions, plus server-side block enforcement on discovery, connections, and messaging.                                                      |

## Stack

The project uses **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, **Express**, **tRPC**, **Drizzle ORM**, and **PostgreSQL on Supabase**. The client uses URL-based screens for `/`, `/discover`, `/connections`, `/profile`, `/members/:id`, and `/chat/:id`.

## Kinba logo

The application uses the official Kinba logo at `client/public/logo.png` and exposes it at `/logo.png` for the header, landing page, authentication screen, favicon, and social metadata.

## Local setup

Install Node.js 22+ and pnpm 10+, then install dependencies:

```bash
pnpm install
```

Configure the environment values below through your deployment platform or local secret manager. Never commit a `.env` file or copy production credentials into the repository.

Apply the approved schema to a development Supabase PostgreSQL database:

```bash
pnpm db:push
```

Start the development server:

```bash
pnpm dev
```

## Required environment variables

The managed Manus environment injects these values automatically. External deployments must configure them securely; do not commit their values.

| Variable                 | Purpose                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_DATABASE_URL`  | Preferred server-side Supabase PostgreSQL Session Pooler connection used by Drizzle.                                                     |
| `DATABASE_URL`           | Supported PostgreSQL fallback for hosts such as Render; must begin with `postgres://` or `postgresql://`.                                |
| `CORS_ORIGIN`            | Optional comma-separated HTTPS origins for a separately hosted frontend. Omit when the KINBA client and API share one Render service.    |
| `CROSS_SITE_SESSION`     | Legacy cookie option; Supabase Auth normally persists sessions in the browser and does not require this value.                           |
| `SUPABASE_URL`           | Supabase project URL used by browser Auth and server access-token verification.                                                          |
| `SUPABASE_ANON_KEY`      | Supabase publishable/anon key used by browser Auth and server token verification. Never use a service-role key in the browser.           |
| `R2_ENDPOINT`            | Cloudflare R2 S3-compatible endpoint, for example `https://<account-id>.r2.cloudflarestorage.com`.                                       |
| `R2_ACCESS_KEY_ID`       | Server-only R2 access key used by the Render Node process.                                                                               |
| `R2_SECRET_ACCESS_KEY`   | Server-only R2 secret key used by the Render Node process.                                                                               |
| `R2_BUCKET_NAME`         | R2 bucket for source videos and generated HLS assets, such as `kinba-media`.                                                             |
| `R2_PUBLIC_BASE_URL`     | Public HTTPS base URL for the R2 bucket or its custom domain. HLS master playlists, variant playlists, and segments use this stable URL. |
| `OWNER_OPEN_ID`          | Project owner identifier used for the owner admin role.                                                                                  |
| `OWNER_NAME`             | Project owner display name.                                                                                                              |
| `BUILT_IN_FORGE_API_URL` | Optional legacy integration endpoint for unrelated built-in features. Video and HLS storage do not use this variable.                    |
| `BUILT_IN_FORGE_API_KEY` | Optional legacy credential for unrelated built-in features. Video and HLS storage do not use this variable.                              |

## Development commands

| Command        | Description                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm dev`     | Start the full-stack development server.                                                        |
| `pnpm check`   | Run TypeScript validation.                                                                      |
| `pnpm test`    | Run the Vitest suite.                                                                           |
| `pnpm build`   | Generate the production client and server bundles.                                              |
| `pnpm db:push` | Compare the Drizzle PostgreSQL schema with Supabase and apply approved non-destructive changes. |

## Validation

Before a release, run:

```bash
pnpm check
pnpm test
pnpm build
```

The project does not seed fake members, reviews, or signals. Test real account workflows only in an authorized development or staging environment. Verify profile saving, signal creation, discovery filters, connection acceptance, message sending, blocking, and reporting with two authenticated test accounts.

## Deployment

For the managed Manus environment, configure production secrets through the project settings, create a checkpoint, and use the **Publish** control. The platform builds with `pnpm build` and starts the resulting server with `pnpm start`.

For another host, provision a PostgreSQL database compatible with Supabase. On Render, configure either `SUPABASE_DATABASE_URL` (preferred) or a PostgreSQL `DATABASE_URL` using the Supabase **Session Pooler** URL, together with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, the five R2 variables above, and the existing owner/database variables. The R2 credentials are server-only: the Node process uses them to upload source videos and generated HLS assets, while Supabase remains the source of truth for users, transactions, videos, and stream metadata. Configure the R2 bucket for public read access through an R2 custom domain or public bucket URL, while keeping write credentials private; `R2_PUBLIC_BASE_URL` must be an HTTPS URL reachable by browsers. The browser uses Supabase Auth’s persisted session storage and sends the current access token as `Authorization: Bearer <token>` to `/api/trpc`; the server verifies that token with Supabase Auth before resolving the PostgreSQL user row. If your frontend is deployed separately, set `CORS_ORIGIN` to its exact HTTPS URL; otherwise leave it unset and serve the KINBA client and `/api/trpc` from the same Render service. Enable Email/Password under Supabase Authentication → Sign-in methods, apply migrations through `0012_supabase_video_storage.sql`, and deploy the Node application. Do not use placeholder secrets in any public or production environment.

## Repository hygiene

`.gitignore` excludes dependencies, build outputs, environment files, logs, coverage, and runtime artifacts. `.env.example` documents names only; it contains no tokens or passwords.

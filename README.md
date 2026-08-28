# NIVO — Connect What Matters

NIVO is a mobile-first human matching platform organized around a simple product loop: **I NEED ↔ I CAN**. Members publish real needs or capabilities, browse the live network, create private connection requests, and message only after both people accept a connection.

## MVP capabilities

| Capability | Implementation |
|---|---|
| Authentication | Secure Manus OAuth integration supplied by the full-stack template. Private routes direct anonymous visitors to sign in. |
| Member profiles | Persistent editable profile data, including country, languages, about, skills, interests, and profile image URL. |
| Signals | Authenticated members can publish NEED and CAN signals with category, language, and optional location. |
| Discovery | Public, database-backed browsing with signal type and category filters. |
| Connections | Private requests, acceptance, decline, cancellation, and an explicit accepted state. |
| Private messaging | Persistent messages available only to participants in an accepted, unblocked connection. |
| Trust and safety | Report and block actions, plus server-side block enforcement on discovery, connections, and messaging. |

## Stack

The project uses **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, **Express**, **tRPC**, **Drizzle ORM**, and **PostgreSQL on Supabase**. The client uses URL-based screens for `/`, `/discover`, `/connections`, `/profile`, `/members/:id`, and `/chat/:id`.

## NIVO logo

The application reserves `client/public/official-nivo-logo.png` as the single official brand-logo path. Use **only the exact image supplied by the NIVO owner** at that path; do not redesign, regenerate, or replace it. The original image file was not present in the provided workspace at the time of this repository preparation, so it must be supplied before a production visual release.

## Local setup

Install Node.js 22+ and pnpm 10+, then install dependencies:

```bash
pnpm install
```

Copy the environment template and provide values only through your deployment platform or local secret manager:

```bash
cp .env.example .env.local
```

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

| Variable | Purpose |
|---|---|
| `SUPABASE_DATABASE_URL` | Preferred server-side Supabase PostgreSQL Session Pooler connection used by Drizzle. |
| `DATABASE_URL` | Supported PostgreSQL fallback for hosts such as Render; must begin with `postgres://` or `postgresql://`. |
| `CORS_ORIGIN` | Optional comma-separated HTTPS origins for a separately hosted frontend. Omit when the NIVO client and API share one Render service. |
| `CROSS_SITE_SESSION` | Set to `true` only when the browser client is hosted on a different site from the API and needs cross-site session cookies. Leave unset for the normal single-service Render deployment. |
| `JWT_SECRET` | Cookie/session signing secret. |
| `VITE_APP_ID` | OAuth application identifier. |
| `VITE_OAUTH_PORTAL_URL` | OAuth portal base URL used by the client sign-in flow. Required on Render at runtime; NIVO also reads it through `/api/oauth/config` if it was missing when the static client bundle was built. |
| `OAUTH_SERVER_URL` | OAuth service base URL used by the server. |
| `OWNER_OPEN_ID` | Project owner identifier used for the owner admin role. |
| `OWNER_NAME` | Project owner display name. |
| `BUILT_IN_FORGE_API_URL` | Manus built-in integration endpoint, where applicable. |
| `BUILT_IN_FORGE_API_KEY` | Server-side credential for Manus built-in integrations. |

## Development commands

| Command | Description |
|---|---|
| `pnpm dev` | Start the full-stack development server. |
| `pnpm check` | Run TypeScript validation. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm build` | Generate the production client and server bundles. |
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

For another host, provision a PostgreSQL database compatible with Supabase. On Render, configure either `SUPABASE_DATABASE_URL` (preferred) or a PostgreSQL `DATABASE_URL` using the Supabase **Session Pooler** URL, plus `VITE_APP_ID`, `VITE_OAUTH_PORTAL_URL`, `OAUTH_SERVER_URL`, and `JWT_SECRET`. NIVO reads the public OAuth values at runtime to avoid a static-bundle configuration failure, but Render must still provide both values. If your frontend is deployed separately, set `CORS_ORIGIN` to its exact HTTPS URL and `CROSS_SITE_SESSION=true`; otherwise leave both unset and serve the NIVO client and `/api/trpc` from the same Render service. Run the migration command once against the target database and deploy the Node application. Do not use placeholder secrets in any public or production environment.

## Repository hygiene

`.gitignore` excludes dependencies, build outputs, environment files, logs, coverage, and runtime artifacts. `.env.example` documents names only; it contains no tokens or passwords.

# NIVO Functional MVP Checklist

- [x] Upgrade the project to persistent authentication and data storage.
- [x] Define and migrate tables for profiles, signals, connection requests, messages, and blocks.
- [x] Implement secure typed application procedures for every functional path.
- [x] Build real discovery browsing and filtering backed by persisted signals.
- [x] Build real profile viewing and editing flows.
- [x] Build connection-request creation, acceptance, and rejection flows.
- [x] Build private conversation listing and message send/read flows.
- [x] Implement report and block actions with enforceable visibility rules.
- [x] Wire navigation and buttons to live routes and transactional UI states.
- [x] Test success, empty, validation, and error paths on desktop and mobile.
- [x] Add URL-based routes for discovery, profiles, connections, and private conversations.
- [x] Add public member profile views with live signals, accepted-connections count, and trust indicators.
- [ ] Run authenticated browser validation for creating signals, profile saving, connection decisions, messaging, reporting, and blocking on desktop and mobile.
- [ ] Locate and place the exact supplied NIVO logo asset in the appropriate public asset location.
- [x] Create repository documentation covering setup, environment variables, development, validation, and deployment.
- [ ] Add a safe `.env.example` and verify no secrets are included in version control.
- [x] Configure the requested GitHub remote and inspect existing remote content before publishing.
- [x] Commit the complete NIVO codebase to the `main` branch and push it to GitHub.
- [x] Verify the GitHub remote, commit, branch contents, and clean install/run instructions.
- [x] Review and test local Discover, Profile, and Connection interactions without changing production data.
- [ ] Test the actual Connect button and pending connection state with authenticated accounts.
- [ ] Test signed-in profile saving and opening public member profiles from Discover and Connections.
- [ ] Record authenticated browser results for connection decisions, messaging, reporting, and blocking.
- [ ] Push the current NIVO project to giveandtake349-sys/NIVO on the main branch and verify the remote commit.
- [x] Replace every remaining prototype alert, static state, and placeholder action with a persistent NIVO operation or remove it.
- [x] Replace the superseded sign-in/OTP requirement with active Supabase Email/Password authentication and persistent session-aware UI state.
- [x] Implement functional need and capability publishing with authenticated ownership and dynamic feed refresh.
- [x] Add live discovery filtering and category/keyword match scoring from persisted signals.
- [x] Complete request, pending, acceptance, decline, cancellation, and accepted-message states for connections.
- [x] Implement persistent private messages with immediate UI updates for the current conversation.
- [x] Add functional block actions to member and signal surfaces and enforce exclusions on discovery and matching.
- [ ] Test every visible NIVO button for a database-backed outcome, validation response, or truthful unavailable state.
- [x] Finish and validate persisted matching results, keyword search, and live Connect-to-Pending state updates.
- [x] Replace native static confirmation prompts with in-app database-backed block and report confirmation flows.
- [x] Generate and apply the reviewed migration for the matching feature through the managed database workflow (no schema change required).
- [x] Commit and push the verified NIVO implementation update to GitHub `main`; authenticated end-to-end coverage remains tracked separately.
- [x] Push the verified NIVO functional update to giveandtake349-sys/Nivo0.2 on the main branch and verify the remote commit.
- [x] Review the current NIVO schema and apply only an approved managed database migration.
- [x] Convert NIVO’s Drizzle schema, configuration, and database client from MySQL to PostgreSQL.
- [x] Configure the Supabase PostgreSQL connection securely without committing credentials.
- [x] Review and apply the generated PostgreSQL schema changes to Supabase.
- [x] Validate NIVO’s PostgreSQL queries, type safety, tests, and production build.
- [x] Push the verified PostgreSQL conversion to giveandtake349-sys/Nivo0.2 on `main`.
- [x] Validate the confirmed Supabase Session Pooler connection and complete the PostgreSQL conversion, migration, and GitHub delivery.
- [x] Validate the renewed Supabase Session Pooler credential before beginning the PostgreSQL schema conversion.
- [x] Reproduce the Render `pnpm install && pnpm run build` failure locally and identify the PostgreSQL migration incompatibility.
- [x] Fix the production build issue without exposing database credentials or weakening the Supabase configuration.
- [x] Validate a clean install, type checks, tests, and production build before pushing the fix to GitHub main.
- [x] Push the verified Render build fix to giveandtake349-sys/Nivo0.2 `main` and confirm the remote commit.
- [x] Add visible success notifications after real signal creation and connection-request submission.
- [x] Re-run the Supabase PostgreSQL schema synchronization and verify all NIVO application tables exist.
- [x] Validate the notification flows, type checks, tests, and production build without introducing mock states.
- [ ] Verify the publish-signal and connection-request success toasts with an authenticated member action in the live NIVO interface.
- [ ] Create a clearly labelled test-only profile and signal through the user’s authenticated NIVO account, then confirm their UI and database visibility.
- [ ] Create the authorised test profile and test signal after the confirmed browser sign-in, then verify the toast and Supabase records.
- [ ] Verify the Render POST/PUT mutation diagnosis against live Render logs or production responses after deployment.
- [x] Fix the mutation backend’s PostgreSQL connection, environment validation, CORS, and request handling without exposing credentials.
- [ ] Validate profile update and signal publishing against the production-compatible server, then push the verified fix to GitHub main.
- [x] Audit and harden production handling for NIVO profile, signal, and connection mutations without Render dashboard access.
- [x] Add regression tests for PostgreSQL mutation return values and request error handling, then validate a clean production build.
- [x] Push the verified NIVO API hardening update to giveandtake349-sys/Nivo0.2 `main`.
- [x] Identify the live NIVO Render service URL and capture the exact HTTP result for a safe signal-mutation API check.
- [x] Test protected profile and signal mutations against https://nivo0-2.onrender.com and record exact HTTP responses.
- [x] Add targeted session and configuration regression tests for the suspected production mutation failure.
- [ ] Verify an authenticated signal publish and profile update against the redeployed Render service after the session-cookie fix.
- [x] Validate the local production-compatible build and GitHub main-branch update; authenticated production API success remains pending.

- [x] Re-probe the strictly confirmed Render URL with direct curl POST/PUT requests only, without browser login or dashboard access.
- [x] Capture exact production status codes, response bodies, headers, and any error traces returned by the live API.
- [x] Diagnose the live response against the current NIVO backend and database mutation code before changing implementation.
- [x] Confirm that no PostgreSQL/ORM mutation defect is shown; the live 401/503 evidence identifies missing Render OAuth public configuration, already handled by the runtime OAuth configuration endpoint and regression tests.
- [x] Run frozen install, tests, type checks, production build, and diff validation for the direct-probe task.
- [x] Checkpoint the direct-probe result; the existing verified runtime OAuth fix is already pushed to GitHub `giveandtake349-sys/Nivo0.2` `main` and will be re-verified after recording this probe.
- [x] Report the exact direct HTTP evidence and clearly distinguish unauthenticated authorization responses from backend/database failures.

## Direct production probe record

- Target: `https://nivo0-2.onrender.com`
- Browser login/dashboard access: prohibited for this task.
- Safe requests must not use fabricated session credentials or create persistent test records without a valid authorized session.

## Firebase Authentication migration

- [x] Cancelled by user: Firebase migration superseded before implementation; audit work was redirected to Supabase Auth.
- [x] Cancelled by user: Firebase secrets request was rejected and replaced with Supabase Auth configuration.
- [x] Cancelled by user: Firebase frontend implementation was replaced by Supabase Email/Password Auth.
- [x] Cancelled by user: Firebase Admin verification was replaced by Supabase access-token verification.
- [x] Cancelled by user: Firebase identity mapping was replaced by Supabase identity mapping.
- [x] Cancelled by user: Firebase token transport was replaced by Supabase Bearer-token transport.
- [x] Cancelled by user: Firebase tests/docs were superseded by Supabase Auth tests/docs.
- [x] Cancelled by user: Firebase delivery was superseded by the Supabase Auth delivery task.

## Supabase Auth migration

- [x] Audit the existing Manus OAuth client, session cookie, callback, tRPC context, and protected procedures.
- [x] Confirm or securely configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` for browser Auth and server-side token verification; the anon key is public by design and no service-role key reaches client code.
- [x] Implement Supabase Email/Password sign-up, sign-in, sign-out, and persistent session restoration in the frontend UI.
- [x] Replace the Manus OAuth-only backend authentication path with verified Supabase Auth access-token handling.
- [x] Map Supabase Auth users deterministically to the existing PostgreSQL/Supabase `users` table.
- [x] Send the Supabase access token with protected tRPC requests and preserve authorization for profile and signal mutations.
- [x] Add Supabase Auth regression tests, update environment/deployment documentation, and remove obsolete OAuth-only client behavior.
- [x] Add an authenticated-context integration regression test, then run frozen install, tests, type checks, production build, checkpoint, push, and remote-hash verification.

## Attached layout redesign

- [x] Read `pasted_content.txt` and translate its new layout into concrete responsive NIVO UI requirements.
- [x] Implement the new layout while preserving Supabase Auth, navigation, signal publishing, discovery, connections, messaging, and safety actions.
- [x] Visually verify the redesigned NIVO screens at desktop and mobile widths and correct regressions.
- [x] Run tests, TypeScript checks, production build, and diff validation after the UI redesign.
- [x] Checkpoint and push the verified layout update to GitHub `main`.

## React/Tailwind Discover and Dashboard replacement

- [x] Replace the existing Discover/Dashboard JSX with the layout structure from `pasted_content.txt` while keeping NIVO’s real data and actions.
- [x] Preserve Supabase Auth, live signal search/filtering, profile navigation, connection requests, blocking, and signal creation.
- [x] Do not add the supplied reference image as a static asset.
- [x] Verify the replacement at desktop and mobile widths and confirm no image asset was added.
- [x] Run tests, TypeScript checks, production build, and diff validation.
- [x] Checkpoint and push the verified replacement to GitHub `main`.

## Guest landing design parity

- [x] Apply the pasted_content.txt React/Tailwind design to the default logged-out `/` landing component.
- [x] Preserve real guest actions for Supabase Auth entry and Discover navigation without adding static image assets.
- [x] Verify guest and authenticated views at desktop and mobile widths.
- [x] Run tests, TypeScript checks, production build, and diff validation.
- [x] Checkpoint and push the guest landing redesign to GitHub `main`.

## Reference palette and multilingual UI

- [x] Apply Deep Navy `#0b121e`, Cyan/Aqua `#00E5FF` and `cyan-400`, and Dark Glass `#131c2a` styling consistently across guest, Discover, and Dashboard views; legacy palette audit is clean.
- [x] Add a persistent top-navigation language selector with English (EN), Bangla (বাংলা · BN), and Hindi (हिंदी · HI).
- [x] Translate the supported navigation, buttons, headings, search placeholders, filters, badges, and guest/app UI labels for English, Bangla, and Hindi; dynamic user content remains unchanged by design.
- [x] Verify selector persistence and translation contract, palette consistency, and responsive guest/Discover screens; authenticated Dashboard rendering remains covered by the existing app build path.
- [x] Run tests, TypeScript checks, production build, and diff validation.
- [x] Checkpoint and push the multilingual styling update to GitHub `main`.

## Premium Classic Midnight Slate & Gold theme

- [x] Replace the neon cyan palette with Deep Slate `#0F172A`, Slate Glass `#1E293B`, slate-700 borders, warm Gold/Amber `#F59E0B` or `#D4AF37`, white titles, and silver body text.
- [x] Apply the Premium Classic theme consistently to the guest landing, Discover, Dashboard, navigation, buttons, active tabs, cards, and key badges.
- [x] Preserve the existing English/Bangla/Hindi selector and all real Supabase/tRPC interactions.
- [x] Verify guest, Discover, and Dashboard responsive presentation after the theme update.
- [x] Run tests, TypeScript checks, production build, and diff validation.
- [x] Checkpoint and push the Premium Classic theme to GitHub `main`.

## Final cyan/sky accent removal

- [x] Audit every file under `client/src` for `#00E5FF`, cyan-* and sky-* color tokens.
- [x] Replace all remaining cyan/sky accent styling with warm gold `#F59E0B` / amber-500 while preserving contrast and functional states.
- [x] Run `pnpm build` and restart the managed preview server.
- [x] Checkpoint, push the verified accent cleanup to GitHub `main`, and confirm the remote revision.

## Final cyan/sky accent removal — completed

- [x] Audit every file under `client/src` for `#00E5FF`, cyan-* and sky-* color tokens.
- [x] Replace all remaining cyan/sky accent styling with warm gold `#F59E0B` / amber-500 while preserving contrast and functional states.
- [x] Run `pnpm build` and restart the managed preview server.
- [x] Capture fresh desktop and mobile guest/Discover visual verification after the final accent replacement.
- [x] Checkpoint and push the verified accent cleanup to GitHub `main`, confirming the remote revision.

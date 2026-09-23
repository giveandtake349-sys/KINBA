# JHILIK Master Product Specification

> **Phase 0 deliverable.** Specification and architecture preparation only.
> No production UI, API, or database schema changes ship with this document.
>
> | | |
> | --- | --- |
> | Repository | `giveandtake349-sys/KINBA` |
> | Branch | `main` |
> | HEAD at authoring | `9fe5fc2657e62dcbce62bf8a1e198248cecfb260` |
> | Status | Approved for phased implementation planning |
> | Audience | Product owners, maintainers, AI agents, QA |

---

## Table of contents

1. [Product Constitution](#1-product-constitution)
2. [Current Architecture](#2-current-architecture)
3. [Navigation Architecture](#3-navigation-architecture)
4. [Discover Specification](#4-discover-specification)
5. [For You Specification](#5-for-you-specification)
6. [JHILIK NOW Specification](#6-jhilik-now-specification)
7. [Shorts Specification](#7-shorts-specification)
8. [Time-Limited Community / Hype Room Specification](#8-time-limited-community--hype-room-specification)
9. [JHILIK Drops Specification](#9-jhilik-drops-specification)
10. [Rewards / Coins Specification](#10-rewards--coins-specification)
11. [Free Verification Specification](#11-free-verification-specification)
12. [Milestone Rewards Specification](#12-milestone-rewards-specification)
13. [User Roles](#13-user-roles)
14. [Business Roles](#14-business-roles)
15. [Admin Roles](#15-admin-roles)
16. [Permission Matrix](#16-permission-matrix)
17. [Screen Map](#17-screen-map)
18. [Button / Action Map](#18-button--action-map)
19. [State Machines](#19-state-machines)
20. [Database Model Plan](#20-database-model-plan)
21. [API / tRPC Plan](#21-api--trpc-plan)
22. [Notification Matrix](#22-notification-matrix)
23. [Analytics / Event Tracking Plan](#23-analytics--event-tracking-plan)
24. [Anti-Abuse / Fraud Plan](#24-anti-abuse--fraud-plan)
25. [Moderation Plan](#25-moderation-plan)
26. [Payment / Commerce Boundary](#26-payment--commerce-boundary)
27. [Feature Flag Plan](#27-feature-flag-plan)
28. [Migration Strategy](#28-migration-strategy)
29. [Backward Compatibility Strategy](#29-backward-compatibility-strategy)
30. [QA / Test Matrix](#30-qa--test-matrix)
31. [Deployment Strategy](#31-deployment-strategy)
32. [Rollback Strategy](#32-rollback-strategy)
33. [Future Expansion Points](#33-future-expansion-points)

---

## 1. Product Constitution

Non-negotiable rules for every JHILIK phase after Phase 0.

1. **Production safety first.** Never drop, truncate, rename, or repurpose a live production table without an approved, reversible migration plan documented in §28.
2. **No speculative code.** Features ship only when their flag, API, schema, tests, and rollback path exist.
3. **No fake behavior.** No mock APIs, placeholder buttons that appear functional, fake scarcity, fake countdowns, or hardcoded demo data in production surfaces.
4. **Server is authoritative.** Quantities, timing, status transitions, watch credit, verification decisions, and reward amounts are decided by the server using server timestamps (`now()` / DB clock), never by client clocks.
5. **Preserve the unified Shorts architecture.** Feed video taps continue to open the existing Shorts section with the selected video active. Do not reintroduce a second video viewer (`FocusedVideoViewer`, overlay viewer, etc.).
6. **Preserve working subsystems.** Auth, uploads, HLS/R2 media playback, engagement (Pookie/react, comment, share, save/bookmark), profiles, sharing, Shorts navigation, community announcements, TimeWheels/sponsor bids, paid verification, and admin tools keep their current behavior unless a phase explicitly and testably changes them.
7. **Immutable ledgers.** Coin balances are never mutated in place without a matching append-only ledger row. The same applies to any future monetary ledger.
8. **Flags default off.** New product surfaces are gated by feature flags and disabled in production until deliberately enabled.
9. **Configuration over hardcoding.** Follower thresholds, milestone amounts, reward values, duration options, and verification rules are admin-configurable rows, not source constants.
10. **Discovery ≠ commerce.** Discover and NOW surface content and deals; they are not marketplaces and do not process payments.
11. **Auditable changes.** Every schema or behavior change documents reuse, migration, compatibility, tests, and rollback before merge.
12. **Spec before UI.** Phases implement against this document; ad-hoc product changes require a spec amendment first.

---

## 2. Current Architecture

Audit of the working tree at HEAD `9fe5fc2`. This is the ground truth the new product builds on.

### 2.1 Stack

| Layer | Technology |
| --- | --- |
| Client | React 19, TypeScript, Vite, Tailwind CSS 4, wouter routing, TanStack Query, tRPC React client, shadcn/ui primitives, lucide-react icons, sonner toasts |
| Server | Node + Express, tRPC 11 (superjson), Zod 4 validation |
| Data | PostgreSQL (Supabase) via Drizzle ORM (`drizzle/schema.ts`, `server/db.ts` data layer) |
| Auth | Supabase Auth (email/password). Browser holds session; API verifies `Authorization: Bearer <token>` and resolves the `users` row by `openId` (`supabase:<uuid>`) |
| Media | Cloudflare R2 (S3 API), optional HLS (`hls.js`), upload via `server/videoUploadRoute.ts`, validation in `server/mediaValidation.ts` |
| Deploy | Render (`render.yaml`), health `/api/health`, readiness `/api/ready`; optional Vercel client build |
| Tests | Vitest (`server/**/*.test.ts`); `pnpm check` = `tsc --noEmit` |
| Migrations | Drizzle Kit push (`pnpm db:push`) + numbered SQL snapshots under `drizzle/` |

### 2.2 Routing (client)

`client/src/App.tsx` registers:

| Path | Component | Notes |
| --- | --- | --- |
| `/admin` | `pages/Admin.tsx` | Client-gated to `role === "admin"`; server enforces `adminProcedure` |
| `/login` | `pages/Home.tsx` | Landing screen |
| `/` | `pages/Home.tsx` | Authenticated dashboard |
| `/profile` | `pages/Home.tsx` | Own profile |
| `/profile/:id` | `pages/Home.tsx` | Public profile |
| *other* | `pages/NotFound.tsx` | |

All product screens currently render inside `Home.tsx` + `MediaHub.tsx`; there is no per-feature router.

### 2.3 Data layer

- `drizzle/schema.ts` — canonical Drizzle schema (enums + tables).
- `server/db.ts` (~2.3k lines) — all data access functions consumed by `server/routers.ts`.
- `drizzle/relations.ts` — empty stub (relations unused).
- Connection: `getDb()` singleton `pg.Pool` with SSL, from `SUPABASE_DATABASE_URL` / `DATABASE_URL` (`server/databaseConfig.ts`).

### 2.4 tRPC surface (existing)

`server/routers.ts` exports `appRouter`:

| Router | Procedures | Auth |
| --- | --- | --- |
| `system` | `health`, `notifyOwner` | public / admin |
| `auth` | `me`, `logout` | public |
| `profile` | `me`, `byId`, `update`, `videos`, `videosById`, `verification`, `followState`, `toggleFollow` | mixed |
| `home` | `search`, `searchAll`, `notifications`, `feed` | mixed |
| `rawPulse` | `get`, `vote`, `create` | mixed |
| `videos` | `list`, `create`, `createText`, `updateDescription`, `delete`, `react`, `share`, `bookmark`, `bookmarked`, `view`, `comments.*` | mixed |
| `payments` | `status`, `submit`, `all`, `approve` | protected / admin (paid verification) |
| `sponsorBids` | `sessions`, `session`, `state`, `join`, `liveSponsors`, `winners`, `walletBalance`, `sponsor` | mixed |
| `admin` | `dashboard`, `createSession`, `startSession`, `setSponsorStatus` | admin |
| `community` | `list`, `mine`, `create`, `react`, `bookmark`, `comments.*` | mixed |

Procedures: `publicProcedure`, `protectedProcedure` (authenticated), `adminProcedure` (`role === "admin"`) in `server/_core/trpc.ts`.

### 2.5 Existing tables (audit)

| Table | Purpose today | Reuse for JHILIK phase? |
| --- | --- | --- |
| `users` | Identity (`openId`, `role`, email/name) | **Reuse as-is** (FK target) |
| `profiles` | Profile + `username`, `photoUrl`, `about`, `accountType`, `isVerified`, `phoneVerified` | **Reuse + additive columns** (verification status) |
| `follows` | follower/followed pairs | **Reuse as-is** (follower counts, milestones) |
| `blocks` | Block pairs | **Reuse as-is** (moderation filters) |
| `videos` | Posts (LONG/SHORT/WHEEL × VIDEO/IMAGE/TEXT), dimensions, HLS, processing | **Reuse as-is** (feeds, Discover, rewards eligibility) |
| `video_sources` | Quality variants | Reuse as-is |
| `video_reactions` | Pookie (unique video+user) | Reuse as-is |
| `video_shares` | Share records | Reuse as-is |
| `video_bookmarks` | Save/Pookie library | Reuse as-is |
| `video_comments` + `comment_likes` | Comments (text/audio, threaded) | Reuse as-is |
| `community_announcements` | Verified creator/company posts | Reuse as-is (announcement model ≠ Hype Room) |
| `community_comments` / `community_reactions` / `community_bookmarks` / `community_announcement_attachments` | Announcement engagement | Reuse as-is; **do not rename or overload for rooms** |
| `sponsor_bids_sessions` | TimeWheels sessions (`scheduled/live/completed/cancelled`) | **Do not reuse** for Hype Rooms (different domain); pattern reference only |
| `participants` | Session membership | **Do not reuse**; pattern reference for room membership |
| `live_sponsors` | Session sponsorships | Unrelated; leave untouched |
| `sponsor_bids_draws`, `session_winners` | Wheel draws | Unrelated; leave untouched |
| `wallets`, `wallet_transactions` | **BDT fiat wallet** for TimeWheels entry/sponsorship/prizes (`numeric(12,2)`, session-scoped unique reference) | **Do not reuse for Coins** (different currency, session FK required, different semantics) |
| `transactions` | Paid verification (bKash/Nagad `pending/approved/rejected`) | **Keep as legacy paid path**; free verification is a parallel flow |
| `reports` | User reports | Reuse as moderation seed; extend reasons later |
| `raw_pulse_polls/options/votes` | Polls on videos | Unrelated |

### 2.6 Notifications today

- **No `notifications` table.** `home.notifications` derives an activity feed at query time from `video_reactions`, `video_shares`, `video_comments`, `follows` (last 50 merged by time) — `server/db.ts:listNotifications`.
- Separate owner-only push helper: `notifyOwner` → Manus Notification Service (`server/_core/notification.ts`), exposed as `system.notifyOwner` (admin only).
- **Implication:** product notifications for rooms/drops/rewards require either (a) extending the derived model where events are still derivable from existing tables, or (b) a new durable `notifications` table for events that are not derivable (recommended for new features — see §22).

### 2.7 Admin today

- Route `/admin` — TimeWheels session control, wallet/ledger monitoring, sponsor approval.
- Profile owner-tools `AdminVerificationPanel` — approve/reject paid verification transactions (`payments.all` / `payments.approve`).
- Authorization: `users.role = 'admin'` (`app_role` enum), owner auto-promoted via `OWNER_OPEN_ID` on login upsert.

### 2.8 Configuration / feature flags today

- **No feature-flag system exists.** Configuration is process env (`server/_core/env.ts`) + client runtime config (`window.__KINBA_CONFIG__` injected by `server/_core/vite.ts`, plus `VITE_*` build vars in `client/src/lib/runtimeConfig.ts`).
- Rate limits: in-memory per-IP Express middleware (`server/rateLimiter.ts`) with per-route budgets in `server/_core/index.ts`.
- View dedup: in-memory 60s IP+video window (`server/viewDedup.ts`).
- Phase 0 introduces `shared/featureFlags.ts` (key vocabulary only, all defaults `false`). Runtime storage/admin toggle is specified in §27 and lands in a later phase — **not** a second ad-hoc mechanism layered on env without documentation.

### 2.9 What the audit explicitly confirms

| Requirement | Finding |
| --- | --- |
| Unified Shorts | Confirmed. Video taps set `initialShortId` + `activeView="shorts"` (`Home.tsx`); `ShortsFeed` scrolls to that index. No overlay viewer remains. |
| Spotlight | Exists as feed tab + `GET /api/spotlight/highlights` → `listSpotlightHighlights()` (top 5 scored videos/posts, 30 days). Renamed/replaced by Discover under `discover_v2`. |
| Community tables | Announcement system only — **not** time-limited rooms. No duration, no membership, no lifecycle. |
| Wallets | Fiat BDT for TimeWheels — **cannot** host JHILIK Coins. |
| Verification | Boolean `profiles.isVerified` + paid `transactions` — free multi-state verification needs additive schema. |
| Analytics | **None** beyond `videos.viewCount`. |
| Feature flags | **None** before Phase 0 scaffold. |

---

## 3. Navigation Architecture

### 3.1 Current navigation (unchanged until flags enable)

```
Bottom navigation (mobile)          Desktop header
┌─────┬──────┬──────┬─────┬─────┐  ┌──────┬───────┬─────────┐
│Home │Search│Create│Notif│Menu │  │Feed  │Shorts │Profile  │  (+ icons: create, search, bell, theme, logout)
└─────┴──────┴──────┴─────┴─────┘  └──────┴───────┴─────────┘

Home feed tabs (dashboard)
[ For You ] [ Spotlight ] [ Shorts ]

Menu drawer
Assets: Balance
Personal: Activity center, Offline videos, QR code
Creation & business: KINBA Studio, Business announcements
Profile / Edit Profile / Log out
```

- `FeedSection` union in `MediaHub.tsx`: `videos | trendy | following | icons | spotlight | shorts | announcements | publish | search | notifications | settings | wallet | qr | offline`.
- Default view: `videos` (For You).
- Profile: own/public via `/profile` and `/profile/:id`.

### 3.2 Target navigation (flag-gated; Phase 0 does not implement)

Primary discovery strip becomes:

```
[ Discover ] [ For You ] [ NOW ] [ Shorts ]
```

| Tab | Flag | Replaces / relates to |
| --- | --- | --- |
| **Discover** | `discover_v2` | User-facing “Spotlight” concept (label + section id may remain `spotlight` internally until a dedicated refactor phase to minimize churn) |
| **For You** | always on | Existing `videos` feed tab — behavior preserved |
| **NOW** | `jhilik_now` | New tab inserted between For You and Shorts |
| **Shorts** | always on | Existing unified Shorts — unchanged |

Rules:

1. When `discover_v2` is **off**, the existing “Spotlight” tab renders exactly as today (including `/api/spotlight/highlights`).
2. When `discover_v2` is **on**, that tab is presented as “Discover” and serves the Discover specification (§4). Internally the first implementation may keep the section id `spotlight` to avoid touching every `FeedSection` branch; renaming is optional cleanup, not required for correctness.
3. When `jhilik_now` is **off**, no NOW tab exists.
4. Shorts, Create, Search, Notifications, Menu, Profile entry points do not move.
5. Bottom nav gains **no** new permanent items in early phases; Hype Rooms / Drops / Rewards are reached from Discover, NOW, Menu, or deep links. A Menu row for **Coins / Rewards** appears only when `jhilik_rewards` is on (§18).
6. Admin additions live under `/admin` (new sections), not in user navigation.

### 3.3 URL strategy

Existing wouter routes stay. Proposed additive routes (registered only when their feature ships; unknown routes still hit NotFound today — each phase must register its route in the same PR as its screen):

| Route | Screen | Flag |
| --- | --- | --- |
| `/discover` | Discover (optional deep link; default remains tab-in-home) | `discover_v2` |
| `/now` | JHILIK NOW (optional deep link) | `jhilik_now` |
| `/rooms` | Hype Room lobby | `time_limited_communities` |
| `/rooms/:id` | Hype Room detail | `time_limited_communities` |
| `/drops` | Drops list | `jhilik_drops` |
| `/drops/:id` | Drop detail | `jhilik_drops` |
| `/rewards` | Coins balance + history | `jhilik_rewards` |
| `/profile/:id` (existing) | + free verification panel states | `free_verification` |

Tab state inside `/` remains component state (`activeView`), consistent with today — no requirement to URL-encode feed tabs in Phase 0.

---

## 4. Discover Specification

**Purpose:** Curated, highlighted discovery surface. Replaces the user-facing “Spotlight” concept. **Not a marketplace.**

**Flag:** `discover_v2` (off → current Spotlight behavior preserved).

### 4.1 Content modules (ordered)

| # | Module | Source (existing or new) | Empty behavior |
| --- | --- | --- | --- |
| 1 | Featured content rail | Extend `listSpotlightHighlights()` scoring (videos + community posts, 30d) | Hide module |
| 2 | Rising creators | New query over `profiles`+`follows`+`videos`: accounts with follower/engagement growth in window; exclude moderated users | Hide module |
| 3 | Featured topics | New `discover_topics` config or admin-pinned topic tags parsed from `videos.description` hashtags | Hide module |
| 4 | Featured NOW events | Active rows from Hype Rooms / events where `status = live` and `startsAt/endsAt` bracket server now (`jhilik_now` or `time_limited_communities`) | Hide module |
| 5 | Featured Drops | Admin-featured + live `drops` (`jhilik_drops`) | Hide module |
| 6 | Featured communities | Admin-featured Hype Rooms or, pre-rooms, featured announcement authors | Hide module |

### 4.2 Ranking principles

- Server-side scoring only (extend the existing likes+2·comments+3·shares pattern; no client-supplied scores).
- Time decay windows documented per module (default 30 days for featured content, consistent with Spotlight).
- Blocked users (`blocks`) and users under active moderation restriction are excluded for the viewer.
- All listings filter `videos.processingStatus = 'READY'` as existing feeds do.

### 4.3 What Discover must not do

- No cart, checkout, payment entry, price-drop bidding, or inventory UI beyond Drop cards linking to Drop detail.
- No second video player: video cards open the existing Shorts flow (`onOpenShort` / `initialShortId`) or photo lightbox exactly as feed cards do today.

### 4.4 API

- Prefer a single tRPC query `discover.overview` returning module payloads (see §21) rather than the current REST `/api/spotlight/highlights`; keep the REST route serving Spotlight until `discover_v2` is enabled and a deprecation window passes.
- Rate limit: align with current spotlight budget (10 req/min per IP) or slightly higher for authenticated overview.

---

## 5. For You Specification

**Purpose:** Normal personalized/social feed. **Preserve existing feed behavior.**

**Flag:** none (always on).

### 5.1 Guaranteed behavior (regression contract)

| Behavior | Current implementation | Contract |
| --- | --- | --- |
| Default home tab | `activeView = "videos"` | Unchanged |
| Feed query | `home.feed` tab `videos` → `listHomeFeed` → unified LONG+SHORT READY media, chronological | Unchanged |
| Text/photo posts | Unified feed merges `community_announcements` (tab `all`) and TEXT/IMAGE videos | Unchanged |
| Following/Trendy/ICONS/Wheels sub-tabs | Server `listHomeFeed` branches | Unchanged |
| Video tap on short | Opens Shorts with selected video active | Unchanged (§7) |
| Photo tap | `FeedPhotoLightbox` | Unchanged |
| Pookie / Comment / Share / Save / Follow / 3-dot menu | `EngagementActions`, `CommentDrawer`, `PostManagementMenu` + existing mutations | Unchanged |
| View counting | `videos.view` + IP dedup | Unchanged (rewards piggyback later without changing count semantics) |
| Player | `ForYouVideoPlayer` / `QualityVideoPlayer`, original aspect ratio | Unchanged |

### 5.2 Allowed additive changes (only when their flags are on)

- Optional thin insert cards for live Hype Rooms / live Drops between feed items when `jhilik_now` or `time_limited_communities` / `jhilik_drops` are on — must be dismissible, server-driven, and must not block existing card rendering paths. **Phase decision: default OFF even when flags are on until product confirms insertion density** (see §33 open decisions).
- No redesign of feed cards, chrome, or engagement rail as part of Discover/NOW work.

---

## 6. JHILIK NOW Specification

**Purpose:** What is happening right now — time-sensitive activity surface.

**Flag:** `jhilik_now` (off → tab absent; no partial UI).

### 6.1 Modules

| Module | Definition of “now” (server time) | Data |
| --- | --- | --- |
| Trending topics | Highest engagement velocity in trailing window (e.g. 6h/24h) | New aggregate query over videos/community posts (scored like Spotlight) |
| Active events | Hype Rooms / events with `status = live` | `hype_rooms` |
| Active Hype Rooms | Same as above, room-specific card (participants count, ends-in) | `hype_rooms` + `hype_room_members` |
| Active Drops | `drops.status = live` and `now < endsAt` and remaining quantity > 0 | `drops` |
| Rising content | New/rapidly engaging READY videos in last N hours | `videos` + engagement counts |
| Countdown integrity | All “ends in” values computed from `serverNow` returned by API (pattern already used by `getSponsorBidsState.serverNow`) | API envelope |

### 6.2 Contract

- Never display client-computed expiry as authoritative; UI may interpolate from `serverNow` + `endsAt`.
- Empty state: honest “Nothing live right now” — no seeded fake rooms/drops.
- Cards deep-link to Hype Room detail, Drop detail, or existing content viewers (Shorts/lightbox) — never a parallel media stack.

---

## 7. Shorts Specification

**Purpose:** Preserve the existing unified Shorts experience as the single video-watching surface.

**Flag:** none (always on). Architecture changes are prohibited without a new approved spec.

### 7.1 Invariants

1. **One viewer.** The Shorts section (`ShortsFeed` in `MediaHub.tsx`) is the only vertical video experience. Do not add `FocusedVideoViewer`, modal players, or route-level alternate viewers.
2. **Tap-to-open contract.** Any video card (For You, Discover, search, profile, NOW rising content) that represents a `kind === "SHORT"` video must call the existing pattern: set initial short id/video → `activeView = "shorts"` → `ShortsFeed` activates that index (`initialShortId` / `standaloneVideo`).
3. **Aspect ratio.** Players use source `width`/`height` and `object-contain` semantics; never force-crop production media.
4. **Real engagement.** Action rail remains: Follow (on others’ content), Pookie (`videos.react`), Comment (`videos.comments.*`), Share (`videos.share`), Save (`videos.bookmark`), 3-dot (`PostManagementMenu` → edit description / delete for owner), mute toggle (local element state only).
5. **Backend.** Same `home.feed` tab `shorts` query, same `videos.view` counting, same comment APIs.
6. **Chrome hand-off.** Existing CSS contract hides bottom nav / drawer while Shorts is active; keep it.

### 7.2 Phase 0 and later phases

- Phase 0: no Shorts code changes.
- Future reward hooks (§10) attach **around** play/progress events without changing who owns the player or introducing a second playback path.

---

## 8. Time-Limited Community / Hype Room Specification

**Flag:** `time_limited_communities` (off → no APIs exposed as enabled, no UI).

### 8.1 Concept

Temporary social rooms with a fixed lifetime. A company (or eligible host) can run a limited-time deal/event for 4h, 6h, 12h, or 24h. Discussion happens while live; expired rooms are read-only; history is archived.

**Not a rename of** `community_announcements` (broadcast posts) **or** `sponsor_bids_sessions` (paid wheel sessions). Those remain untouched.

### 8.2 Lifecycle

`scheduled → live → expired → archived` (full transition rules in §19.1).

| State | Who can post | Who can join | Listed in NOW/Discover |
| --- | --- | --- | --- |
| scheduled | Host: pinned notes only (optional); members: no chat yet | Join allowed (pre-join) | Optional “starting soon” in Discover only |
| live | Members + host | Join allowed | Yes |
| expired | Nobody (read-only transcript) | No | Hidden (or “ended” strip on host profile only) |
| archived | Nobody | No | Only via host profile archive / admin |

### 8.3 Duration options

Initial enum duration hours: **4, 6, 12, 24** (stored as `durationHours` int with check constraint; adding more is a config/data change, not a rewrite). `endsAt = startsAt + duration` computed **server-side** at activation.

### 8.4 Core capabilities

| Capability | Spec |
| --- | --- |
| Create room | Eligible host chooses title, topic/tag, visibility (public listing vs link-only), optional cover from existing upload pipeline, duration; `startsAt` immediate or scheduled within a product max lead time (config; default 7 days) |
| Join | Authenticated user; unique (roomId, userId); join after start allowed until `endsAt` |
| Discussion | Linear messages (text; optionally voice reusing comment audio upload patterns) while `live` |
| Host controls | End early (→ expired), pin message, remove member, cancel before start (→ archived with reason) |
| Moderation | Report message/user; admin remove message / ban user from room / force-expire |
| After expiry | Messages remain for participants/host; reactions locked; no new joins |
| Archive | Automatic transition job or lazy server-side transition on read (same pattern as `advanceSponsorBidsSession` — compute state from timestamps, persist when changed) |
| Notifications | Reminders and lifecycle events per §22 |

### 8.5 Relationship to Drops

A live Drop **may** open a linked Hype Room (1 drop → 0..1 room from create flow; room may also exist without a drop). Link is a nullable FK on `hype_rooms.dropId` (or `drops.hypeRoomId` — chosen in §20 to avoid circular required FKs: **`hype_rooms.dropId` nullable**).

### 8.6 Explicit non-goals (this phase family)

- No voice/video live streaming in rooms (text/audio messages first).
- No membership tiers or paid entry (TimeWheels owns paid entry).
- No migration of existing announcements into rooms.

---

## 9. JHILIK Drops Specification

**Flag:** `jhilik_drops`.

### 9.1 Concept

Time-limited social-commerce **deal event** run by businesses/eligible sellers. **Not a permanent marketplace.** JHILIK provides social discovery + claim interest; **payment/settlement stays outside** (§26).

### 9.2 Offer attributes (required)

| Field | Rules |
| --- | --- |
| Product/service title + description | Required; moderated length |
| Media | Required (image at minimum) via existing upload validation |
| Original price | Required; `numeric(12,2)`; display as provided |
| Discounted price | Required; must be `< original price` (server check) |
| Quantity | Required positive int; **server-authoritative remaining** |
| startsAt / endsAt | Required; `endsAt > startsAt`; server validates against now |
| Terms | Required plain text (min length); shown before claim CTA |
| Currency | Display-only BDT (or configured) — **no payment processing** |

### 9.3 Lifecycle

`draft → scheduled → live → sold_out | ended → archived` (§19.2). Transitions computed from server time + remaining quantity; persisted on write (lazy advance on read, TimeWheels pattern).

### 9.4 Claim model (Phase: social claim, not checkout)

- User **claims interest / reserves a claim record** while live and `remainingQuantity > 0`.
- Server decrements remaining atomically (`UPDATE ... SET remaining = remaining - 1 WHERE id = $1 AND remaining > 0 RETURNING`), inserts claim row with idempotency key.
- Claim states: `claimed` (awaiting seller fulfilment/contact), `released` (host/admin release), `fulfilled` (seller marks complete), `cancelled`.
- **Never** fake scarcity: UI remaining count always comes from API; countdown from `serverNow`.
- Payment fields are **not** collected in-app in this phase. Fulfilment contact happens per seller-configured method (external link / in-app contact later — §26).

### 9.5 Surfaces

| Surface | Content |
| --- | --- |
| NOW | All `live` drops with remaining > 0 |
| Discover | Admin-featured + live drops |
| Drop detail | Full offer, terms, claim CTA, server countdown |
| Drop create (seller) | Form + preview + schedule |
| Optional Hype Room | “Open a Hype Room for this drop” when flag `time_limited_communities` also on |

### 9.6 Eligibility to sell

Not every user. Eligibility = `profiles.accountType` in (`company`, `creator`) **or** future `seller_enabled` flag, **and** `verificationStatus` in (`business_verified`, `official`) **or** admin-granted seller role (configurable matrix — see §14, §16). Paid-verified `creator` accounts remain eligible per current product until product owner changes the rule (§33).

---

## 10. Rewards / Coins Specification

**Flag:** `jhilik_rewards` (wallet/UI), `video_rewards` (watch-earn subset; requires `jhilik_rewards`).

### 10.1 Principles

1. **JHILIK Coins are virtual points.** No monetary value promise, no cash-out UI in this phase (existing BDT wallet for TimeWheels is separate and untouched).
2. **Immutable ledger is the source of truth.** Never `UPDATE users`/`profiles` to “add coins”. Balance = sum of ledger postings (optionally mirrored in a `coin_accounts.balance` cache updated **in the same transaction** as the ledger insert, always derivable from ledger).
3. **Server-authoritative crediting** with idempotency keys.
4. **Never reward mere playback.** A `<video>` `play` event is insufficient.

### 10.2 Ledger model (summary; full DDL in §20)

Every credit/debit/reversal is a `reward_ledger_entries` row:

| Column | Meaning |
| --- | --- |
| `id` | Identity PK |
| `userId` | Beneficiary |
| `idempotencyKey` | **Unique** — client+server composite (see below) |
| `sourceType` / `sourceId` | e.g. `video_watch` / watchSessionId; `milestone` / milestoneAwardId; `admin_adjustment` / adjustmentId |
| `action` | Enum: `video_watch`, `daily_bonus`, `milestone`, `admin_credit`, `admin_debit`, `reversal`, … |
| `amount` | Signed integer coins (positive credit, negative debit) |
| `status` | `pending → approved → credited` then optional `reversed` (entry itself never rewritten except `status` + `reversedByEntryId` pointing to compensating entry) |
| `reviewStatus` | `none \| flagged \| cleared` |
| `createdAt`, `approvedAt`, `creditedAt` | Server timestamps |
| `metadata` | jsonb (ruleId, dayKey, etc.) |

**Balance integrity:** `credited` sum per user = spendable balance. Reversals insert a **new** entry with negative amount and `action = 'reversal'`, linking `reversesEntryId`.

### 10.3 Idempotency key schemes

| Action | Key |
| --- | --- |
| Video watch credit | `watch:{userId}:{videoId}:{sessionDateUTC}:{sequence}` or `watch:{watchSessionId}` (one credit per qualifying session) |
| Daily cap day bucket | `day:{userId}:{YYYY-MM-DD}` recorded on `reward_daily_usage` unique row |
| Milestone | `milestone:{userId}:{milestoneRuleId}:{awardIndex}` |
| Admin adjustment | `admin:{adminId}:{clientRequestId}` (clientRequestId required) |

Duplicate key → return existing result (no double credit).

### 10.4 Video watch reward lifecycle (server-side)

Client may **request** heartbeats; server decides eligibility.

```
eligible → pending → approved → credited → (reversed)
                ↘ rejected
```

Qualifying watch session rules (configurable, defaults conservative):

| Check | Default intent (config in `reward_rules`) |
| --- | --- |
| Authenticated user | Required |
| Video `processingStatus = READY`, not owner’s own video (config) | Required |
| Minimum watch duration | e.g. credit threshold at ≥ 70% of duration **or** ≥ N seconds, whichever product configures — **not** first `play` |
| Heartbeat cadence | Client sends heartbeat every T seconds while `document.visibilityState === 'visible'` and element `paused === false`; server rejects sessions with impossible rates |
| Session minimum age | First credit not before `minSessionSeconds` |
| Duplicate session | Unique active session per (userId, videoId) rolling window; restarts reset progress |
| Daily cap | Unique `reward_daily_usage(userId, dayKey)` with `count < dailyLimit` |
| Video-level cap | Optional per-video-per-user once-per-day |
| Velocity / farming | Reject if actions per minute or distinct videos per hour exceed thresholds; flag `reviewStatus = flagged` instead of crediting borderline cases |
| Own content | No credit (default) |
| Bot signals | Reuse rate limiter IP; reject headless patterns later (§24) |

**States on `video_watch_sessions`:** `open → completed → reward_pending → reward_credited | reward_rejected | expired`. Expiry job/session lazy close if no heartbeat for X minutes.

**Critical:** The existing `videos.view` counter and `viewDedup` remain for **view counts only**. Rewards do not increment on `videos.view` alone.

### 10.5 Earning actions (initial catalog — all gated by `reward_rules` rows)

| Action | Flag | Default posture |
| --- | --- | --- |
| Qualifying video watch | `video_rewards` | Off until anti-abuse tests pass |
| Daily active bonus | `jhilik_rewards` | Optional, capped |
| Milestone achievement | `milestone_rewards` | See §12 |
| Future: comment quality, share, referral | — | Spec amendment required |

Spending: **out of scope** for early phases (no shop). `action` enum includes `spend_*` placeholders for future amendment without migration breakage.

### 10.6 Anti-farming controls (summary)

See §24 for full plan: daily limits, session uniqueness, heartbeat validation, rate limits, IP+device velocity, shadow review queue, admin reversal tools, no credit on autoplay-muted-background by default.

---

## 11. Free Verification Specification

**Flag:** `free_verification`.

### 11.1 States (new, additive)

Stored on `profiles.verificationStatus` (new enum column; see §20):

| State | Meaning |
| --- | --- |
| `none` | Default; not pursuing verification (paid path may still set `isVerified`) |
| `eligible` | Automated rules currently pass; user may submit |
| `pending` | Application submitted; awaiting review |
| `verified` | Approved individual verification |
| `business_verified` | Approved business verification |
| `official` | Official/organization mark (admin-granted) |

Legacy: `profiles.isVerified boolean` remains the **compatibility badge flag** consumed by existing UI/queries. On approval, **both** `verificationStatus` and `isVerified` are updated in one transaction so current badge rendering keeps working without touching every call site in the same phase. Paid `transactions` flow continues to set `isVerified = true` (maps to `verificationStatus = 'verified'` or `business_verified`/`official` per accountType as configured).

### 11.2 Eligibility (configurable — never hardcoded final threshold)

`verification_rules` (single active row or keyed rules):

| Rule key | Example initial value | Notes |
| --- | --- | --- |
| `minFollowers` | 500 **or** 1000 (product owner picks; **not** hardcoded in source) | Necessary but **not sufficient** |
| `minAccountAgeDays` | e.g. 30 | Required |
| `minProfileCompleteness` | photo + username + about + ≥1 post | Computed score ≥ threshold |
| `requireNoActiveBlocksAgainst` | true | Moderation |
| `maxOpenReports` / `reportWeightThreshold` | e.g. 0 serious open reports | Moderation |
| `requireHistoricalActivityAge` | e.g. account not created yesterday with bought followers | Heuristic: follower growth rate sanity (optional) |
| `authenticitySignals` | config list (optional phase-2): e.g. ≥N days with organic engagement | Additive |
| `excludeAccountTypes` | none by default | |

**Follower count alone never auto-grants.** Flow is: rules pass → state `eligible` → user submits application → human/admin (or admin-reviewed auto-approve if product later enables it) → `approved/rejected` → `verified*`.

### 11.3 Application record

`verification_applications` (new): userId, snapshot of metrics at submit, statement/evidence URLs (optional upload), status `pending/approved/rejected`, reviewerId, decidedAt, notes (admin-only), ruleVersion.

### 11.4 Coexistence with paid verification

- Paid path (`payments.*` + `transactions`) remains available as today until product retires it (§33 decision).
- At most one **active** free application (`pending`) per user — mirror the paid “one pending” guard.
- Admin review UI extends the existing verification panel pattern.

---

## 12. Milestone Rewards Specification

**Flag:** `milestone_rewards` (depends on `jhilik_rewards` ledger).

### 12.1 Model

Admin-configurable `milestone_rules`:

| Field | Example |
| --- | --- |
| `code` | unique slug e.g. `followers_500` |
| `metric` | `followers`, `videos_created`, `reactions_received`, `watch_minutes_self`, … |
| `threshold` | integer |
| `coinsReward` | integer ≥ 0 (**not** hardcoded in source) |
| `badgeKey` | optional string badge id (display later) |
| `perkCode` | optional future perk |
| `enabled` | bool |
| `ruleVersion` | for audit |

### 12.2 Awarding

- Evaluator job or event-driven check on follow/post completion: if metric crosses threshold and no award exists for (userId, ruleId) → insert `milestone_awards` + ledger entry with idempotency `milestone:{userId}:{ruleId}`.
- Partial crossings don’t re-award; thresholds should be designed monotonic (or allow `awardIndex` in key for repeatable tiers: `followers_100`, `followers_500`, … as separate rules).
- User-visible: Rewards screen list of achieved/pending milestones (pending = progress bars from live counts, not fake).

### 12.3 Anti-abuse

Same ledger idempotency; metric source must be server aggregates (same queries as `getProfileStats`), not client-supplied numbers.

---

## 13. User Roles

| Role | Definition | How granted |
| --- | --- | --- |
| `guest` | Unauthenticated visitor | Default |
| `member` (`app_role = 'user'`, `accountType = member`) | Standard signed-in user | Supabase sign-up → `users` upsert |
| `creator` | `accountType = creator` | Existing paid verification approval (or future self-serve) |
| `company` / business | `accountType = company` | Existing paid verification approval |
| `verified` individual | `verificationStatus = verified` (or legacy `isVerified`) | Free or paid approval |
| `business_verified` | `verificationStatus = business_verified` | Approval path |
| `official` | `verificationStatus = official` | Admin grant |
| `seller-eligible` | Derived permission for Drop creation (§16) | Rules in §9.6 |
| `room host` | Creator/host of a Hype Room (per-room role) | Room owner on create |
| `admin` | `users.role = 'admin'` | `OWNER_OPEN_ID` or DB grant |

Notes: `app_role` remains `user | admin` only — **product tiers live on `profiles`**, not a new global enum, to avoid breaking authz middleware.

---

## 14. Business Roles

| Business role | Capabilities |
| --- | --- |
| Verified company | Create Hype Rooms (flag), create Drops, publish community announcements (existing), view own drop claims, moderate own room chat (host controls) |
| Verified creator (business use) | Same as company where product allows (Drop eligibility per §9.6) |
| Standard member | Join public rooms, claim live drops, earn Coins (if flags on), apply for free verification when eligible |
| External seller (future) | Out of scope — expansion point §33 |

Business roles are **derived** from `profiles.accountType` + `verificationStatus` + optional allowlist — no separate `businesses` table in Phase 0 (avoids dual profile systems). If seller needs grow, add `seller_profiles` later (§33).

---

## 15. Admin Roles

Existing single admin role (`users.role = 'admin'`) is sufficient for Phase 0–2. Proposed **capability areas** (logical, not new DB roles yet):

| Area | Responsibilities |
| --- | --- |
| TimeWheels admin | Existing `/admin` sessions, sponsors, wallets |
| Verification admin | Existing paid review + new free application review |
| Moderation admin | Reports, room message removal, drop takedown |
| Rewards admin | Rule editor, ledger review, reversals, fraud queue |
| Drops admin | Feature drops on Discover, force end/archival |
| Rooms admin | Force expire, archive, ban |
| Feature flag admin | Toggle flags (when runtime flags ship) |
| Milestone admin | CRUD milestone rules |

**Future:** split `admin_permissions` if needed (§33); do not break `adminProcedure` in early phases.

---

## 16. Permission Matrix

Legend: **Y** allowed · **N** denied · **C** conditional (state/flag/rule) · **—** n/a

| Action | Guest | Member | Creator/Company (verified) | Admin |
| --- | --- | --- | --- | --- |
| View For You / Shorts / search | Y | Y | Y | Y |
| View Discover (flag on) | Y | Y | Y | Y |
| View NOW (flag on) | Y | Y | Y | Y |
| Play video / count view | Y | Y | Y | Y |
| Pookie / comment / share / save | N (auth dialog) | Y | Y | Y |
| Create video/photo/text | N | Y | Y | Y |
| Publish community announcement | N | N | Y (existing rules) | Y |
| Create Hype Room | N | C (eligibility config; default verified company/creator) | C | Y |
| Join Hype Room (live) | N | Y (not banned) | Y | Y |
| Post in Hype Room (live) | N | Y (member of room) | Y | Y |
| End/own room controls | N | host only | host only | Y |
| Create Drop | N | N | C (seller eligibility §9.6) | Y |
| Claim Drop | N | Y while live & remaining>0 | Y | Y |
| View Coin balance | N | C (`jhilik_rewards`) | C | Y |
| Earn watch reward | N | C (`video_rewards` + rules) | C | Y |
| Apply free verification | N | C (eligible) | already verified → N | — |
| Approve free verification | N | N | N | Y |
| Approve paid verification | N | N | N | Y (existing) |
| Configure milestone/reward rules | N | N | N | Y |
| Reverse ledger entry | N | N | N | Y |
| Toggle feature flags | N | N | N | Y |
| Create TimeWheels session | N | N | N | Y (existing) |
| Sponsor TimeWheels | N | Y (wallet) | Y | Y |

---

## 17. Screen Map

### 17.1 Existing screens (context; not rebuilt)

| Screen | File / route | Role in new product |
| --- | --- | --- |
| Landing | `Home.tsx` `/login` | Unchanged |
| Dashboard + tabs | `Home.tsx` `/` | Hosts Discover / For You / NOW / Shorts tabs |
| Profile | `ProfileView.tsx` | Adds verification/rewards entry points when flags on |
| Search modal | `SearchFeed` | Unchanged; results may deep-link to new surfaces |
| Notifications panel | `NotificationsPanel` | Extended notification kinds (§22) |
| Admin | `Admin.tsx` `/admin` | Gains sections: flags, rooms, drops, rewards, verification free, milestones |
| Create uploader | `UploadVideoModal` | Unchanged |
| Wallet (BDT) | `WalletPanel` | **Stays fiat**; Coins use new Rewards screen |
| Business announcements | `CommunityAnnouncements` | Unchanged |

### 17.2 New screens (flag-gated)

| ID | Screen | Flag | Primary route/entry |
| --- | --- | --- | --- |
| S1 | Discover | `discover_v2` | Home tab (Spotlight slot) |
| S2 | JHILIK NOW | `jhilik_now` | Home tab |
| S3 | Hype Room lobby | `time_limited_communities` | `/rooms`, NOW module, Discover module |
| S4 | Hype Room detail (live/expired) | `time_limited_communities` | `/rooms/:id` |
| S5 | Create Hype Room | `time_limited_communities` | S3 CTA / create menu |
| S6 | Drops list | `jhilik_drops` | `/drops`, NOW, Discover |
| S7 | Drop detail | `jhilik_drops` | `/drops/:id` |
| S8 | Create/edit Drop (seller) | `jhilik_drops` | Menu (eligible), S6 CTA |
| S9 | Rewards (Coins) | `jhilik_rewards` | `/rewards`, Menu |
| S10 | Free verification apply | `free_verification` | Profile owner tools |
| S11 | Milestones (in S9 or subsection) | `milestone_rewards` | S9 tab/section |
| S12 | Admin: Feature flags | runtime flags | `/admin` section |
| S13 | Admin: Rooms | `time_limited_communities` | `/admin` |
| S14 | Admin: Drops | `jhilik_drops` | `/admin` |
| S15 | Admin: Rewards/ledger | `jhilik_rewards` | `/admin` |
| S16 | Admin: Free verification queue | `free_verification` | `/admin` (plus profile panel pattern) |
| S17 | Admin: Milestone rules | `milestone_rewards` | `/admin` |

---

## 18. Button / Action Map

Global conventions for **all new screens** (applies even when a row omits a column):

| Concern | Convention |
| --- | --- |
| Unauthenticated action | Open existing `SupabaseAuthDialog` (`auth.openAuth()`); no fake optimistic success |
| Loading | Disable button + label suffix “…” or spinner (match existing `primary-btn` patterns) |
| Success | `sonner` toast + query invalidation via `trpc.useUtils()` |
| Error | Toast or inline `.form-message--error` with server message (existing style) |
| Empty | Icon + title + honest copy; CTA only if user can fix it |
| Expired | Status chip + disabled primary CTA + “ended at {server time}” |
| Offline | Standard failure toast; no queue-unless-implemented (do not claim offline support) |
| Analytics | Emit event id from §23 when instrumentation phase ships (Phase 0: column documents **intended** event names only) |
| Notification | Matrix §22 (`none` if none) |
| Authorization | Server procedure protection is mandatory; UI hiding is cosmetic only |

### 18.1 S1 — Discover

| Control | Icon | On tap | Auth | API | DB | Loading | Success | Error | Empty | Expired | Offline | Notify | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Discover tab | label | Show S1 | public | `discover.overview` | read-only | Skeleton modules | Render modules | Retry inline | Hide empty modules | n/a | Toast | none | `discover_view` |
| Featured card (video/short) | media | Open photo lightbox **or** Shorts with id active | public/optional | existing | none | — | Navigate | Toast | — | — | Toast | none | `discover_content_open` |
| Creator card → profile | avatar | Navigate `/profile/:id` | public | `profile.byId` | read | Profile skeleton | Profile | Fallback | — | — | Existing | none | `discover_creator_open` |
| Topic chip | hash | Filter/scroll to topic section or search | public | `discover.overview` or `home.search` | read | Spinner | Results | Toast | Empty copy | — | Toast | none | `discover_topic_open` |
| Live NOW module card → room | radio | Open S4 | public | `hypeRooms.byId` | read | Skeleton | Room | Toast | Hide if none | Room shows ended | Toast | none | `discover_now_open` |
| Featured Drop card | package | Open S7 | public | `drops.byId` | read | Skeleton | Drop | Toast | Hide | Ended state | Toast | none | `discover_drop_open` |
| Featured community card | users | Open S4 or list | public | rooms | read | Skeleton | Room/lobby | Toast | Hide | — | Toast | none | `discover_community_open` |
| Refresh/retry | rotate | Refetch overview | public | same | read | Spinner | Data | Toast | — | — | Toast | none | `discover_retry` |

### 18.2 S2 — JHILIK NOW

| Control | Icon | On tap | Auth | API | DB | Loading | Success | Error | Empty | Expired | Offline | Notify | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NOW tab | radio | Show S2 | public | `now.overview` | read | Skeleton | Modules | Retry | “Nothing live right now” | Strip shows ended | Toast | none | `now_view` |
| Trending topic | trend | Open topic/search | public | read | read | Spinner | Results | Toast | Empty | — | Toast | none | `now_trend_open` |
| Active event/room card | clock | Open S4 | public | `hypeRooms.byId` | read | Skeleton | Room | Toast | Hide | Hide/ended chip | Toast | Room start reminder (host) | `now_room_open` |
| Active Drop card | zap | Open S7 | public | `drops.byId` | read | Skeleton | Drop | Toast | Hide | Ended/sold out | Toast | none | `now_drop_open` |
| Rising content card | flame | Open Shorts/lightbox | public | existing | read | Skeleton | Viewer | Toast | Hide | — | Toast | none | `now_content_open` |
| Live countdown text | timer | none (display only) | — | serverNow in payload | — | — | — | — | — | Show 0 → expired | — | none | — |

### 18.3 S3 — Hype Room lobby

| Control | Icon | On tap | Auth | API | DB | Loading | Success | Error | Empty | Expired | Offline | Notify | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Lobby open | users | Render list | public | `hypeRooms.list` | read | Skeleton | List | Retry | Empty copy + host CTA if eligible | Filter scheduled/live only by default | Toast | none | `rooms_lobby_view` |
| Create room | plus | Open S5 or auth | protected+eligibility | — | — | — | Open form / auth dialog | Toast permission | — | — | Toast | none | `room_create_open` |
| Live room row | radio | Open S4 | public | — | — | — | Navigate | Toast | — | — | Toast | none | `room_open` |
| Scheduled room row | clock | Open S4 preview | public | — | — | — | Preview | Toast | — | — | Toast | none | `room_open_scheduled` |
| Filter: Live / Upcoming / Mine | list-filter | Requery | public/protected | `hypeRooms.list{filter}` | read | Spinner | List | Toast | Empty per filter | — | Toast | none | `rooms_filter` |
| Join now (on row or S4) | user-plus | `hypeRooms.join` | protected | mutation | insert member (unique) | Button “Joining…” | “Joined” + navigate chat | Toast (full/closed/banned) | — | Disabled “Room ended” | Toast | none | `room_join` |

### 18.4 S4 — Hype Room detail

| Control | Icon | On tap | Auth | API | DB | Loading | Success | Error | Empty | Expired | Offline | Notify | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Back | chevron-left | Leave to lobby/prev | — | — | — | — | Navigate | — | — | — | — | none | — |
| Status chip | dot | none | — | derived from server timestamps | — | — | — | — | — | “Expired {time}” | — | none | `room_view` |
| Ends-in countdown | timer | none | — | serverNow | — | — | — | — | — | 0 → expired UI | — | none | — |
| Members count → member list | users | Toggle list sheet | public | `hypeRooms.members` | read | Spinner | List | Toast | Empty | Read-only list | Toast | none | `room_members_view` |
| Message list | message | (scroll) | members | `hypeRooms.messages` | read | Skeleton | Messages | Retry | Empty “Say hello” if live+member | Read-only transcript | Cached last page if any | none | `room_view` |
| Message input send | send | `hypeRooms.sendMessage` | member+live | mutation | insert message | Disable + “Sending…” | Clear input + append | Toast | — | **Hidden/disabled** when expired | Toast | Room activity digests (opt) | `room_message_send` |
| Attach voice (if enabled) | mic | Record/upload via existing comment-audio patterns | member+live | upload route | message.audioUrl | Uploading… | Send | Toast max 60s | — | Disabled | Toast | none | `room_voice_send` |
| Leave room | log-out | `hypeRooms.leave` | member | mutation | delete/mark member | Button… | Left | Toast | — | Visible read-only | Toast | none | `room_leave` |
| Host: End room | power | Confirm dialog → `hypeRooms.end` | host | mutation | status→expired | Saving… | Toast + UI expired | Toast | — | Already disabled | Toast | Members notified | `room_end` |
| Host: Pin message | pin | `hypeRooms.pin` | host | mutation | pinned id | Saving… | Pinned banner | Toast | — | Disabled | Toast | none | `room_pin` |
| Host: Remove member | user-x | Confirm → `hypeRooms.removeMember` | host | mutation | delete member | Saving… | Toast | Toast | — | Disabled | Toast | Removed user notified | `room_member_remove` |
| Report message | flag | Open report dialog (existing reasons + extension) | protected | new `moderation.report` or extend pattern | insert report | Submitting… | Thanks toast | Toast | — | Allowed for transcript | Toast | Admin queue | `room_report` |
| Open linked Drop | package | Navigate S7 | public | — | — | — | Drop | Toast | Hide if none | Ended state | Toast | none | `room_drop_open` |
| 3-dot room menu | more | Menu: Share room link, Report room, Host tools | mixed | share uses existing clipboard/share | — | — | Copied | Toast | — | Share still works (archive link) | Toast | none | `room_menu_*` |

### 18.5 S5 — Create Hype Room

| Control | Icon | On tap | Auth | API | DB | Loading | Success | Error | Empty | Expired | Offline | Notify | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open form | plus | S5 | eligibility | `hypeRooms.create` available | — | Fetch eligibility | Form | Permission message | — | — | Toast | none | `room_create_view` |
| Title input | — | bind | — | — | — | — | — | Validation ≤180 | Required | — | — | none | — |
| Topic/tag | hash | bind | — | — | — | — | — | Validation | Optional | — | — | none | — |
| Duration select | clock | Choose 4/6/12/24h | — | — | — | — | Show computed endsAt preview **from serverNow** | Validation | Default 6h | — | — | none | `room_duration_select` |
| Start time | calendar | Now or scheduled | — | — | — | Server confirms | Preview | Reject past times | Default now | — | — | none | — |
| Visibility | eye | public / link-only | — | — | — | — | — | — | Default public | — | — | none | — |
| Cover image (optional) | image | Existing upload validation | — | upload | coverUrl | Uploading… | Thumbnail | Toast | Optional | — | Toast | none | `room_cover_upload` |
| Create | check | `hypeRooms.create` | protected | mutation | insert room scheduled/live | “Creating…” | Navigate S4 | Toast | — | — | Toast | Creator confirmation | `room_create_submit` |
| Cancel | x | Back | — | — | none | — | — | — | — | — | — | none | — |

### 18.6 S6 — Drops list

| Control | Icon | On tap | Auth | API | DB | Loading | Success | Error | Empty | Expired | Offline | Notify | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open list | zap | S6 | public | `drops.list` | read | Skeleton | Cards | Retry | “No live drops” | Filter excludes ended | Toast | none | `drops_list_view` |
| Filter Live / Upcoming / Mine | list-filter | Requery | mixed | list{filter} | read | Spinner | List | Toast | Empty | — | Toast | none | `drops_filter` |
| Drop card | tag | Open S7 | public | — | — | — | Navigate | Toast | — | Card shows ended | Toast | none | `drops_open` |
| Create drop | plus | S8 if eligible else auth/permission | eligibility | — | — | Eligibility check | Form | Permission toast | Permission copy | — | Toast | none | `drop_create_open` |

### 18.7 S7 — Drop detail

| Control | Icon | On tap | Auth | API | DB | Loading | Success | Error | Empty | Expired | Offline | Notify | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Back | chevron-left | Navigate back | — | — | — | — | — | — | — | — | — | none | — |
| Media gallery | image | Expand (existing lightbox pattern) | — | — | — | — | View | — | Placeholder | — | Cached | none | `drop_media_view` |
| Price block | badge | none (display original + discounted + % off computed server-side or from returned fields) | — | server fields | — | — | — | — | — | — | — | none | — |
| Remaining quantity | boxes | none | — | **server remaining only** | — | Skeleton | Correct count | Retry | — | “Sold out” | Last known + refetch | none | — |
| Countdown | timer | none | — | serverNow + endsAt | — | — | — | — | — | “Ended” | — | none | — |
| Terms expand | file-text | Toggle terms | — | stored terms | — | — | Show | — | Required text always reachable | Still visible after end | Cached | none | `drop_terms_view` |
| Claim button | hand | Confirm dialog (shows terms ack) → `drops.claim` | protected | mutation | insert claim + decrement remaining | “Claiming…” | Success state claimed + refetch detail | Specific errors: sold out / ended / already claimed / not eligible | Disabled if not eligible | **Disabled** “Drop ended” | Toast | Seller notified; claimer status change | `drop_claim` |
| My claim status | check-circle | none / open claim list | protected | `drops.myClaim` | read | Spinner | Status chip | Toast | “No claim” | Status remains | Cached | Fulfilment updates (§22) | `drop_claim_status_view` |
| Open Hype Room | users | Navigate S4 | public | — | — | — | Room | Toast | Hide if none | Room expired state | Toast | none | `drop_room_open` |
| Share | share-2 | Existing share/copy link | public | `videos.share` N/A → clipboard/share URL | — | — | Copied/shared | Toast | — | Share still allowed | Toast | none | `drop_share` |
| Report | flag | Report dialog | protected | moderation | insert | Submit | Thanks | Toast | — | Allowed | Toast | Admin | `drop_report` |
| Seller: Edit | pencil | S8 edit if before live or within rules | seller | `drops.update` | update | Saving… | Toast + refetch | Toast | — | Locked when live unless allowed fields | Toast | none | `drop_edit` |
| Seller: End early | power | Confirm → `drops.end` | seller/admin | mutation | status→ended | Saving… | Toast | Toast | — | Disabled if already ended | Toast | Claimers notified | `drop_end` |
| Seller: View claims | list | Claim table | seller/admin | `drops.claims` | read | Spinner | Table | Toast | Empty | Historical claims visible | Toast | none | `drop_claims_view` |

### 18.8 S8 — Create/edit Drop

| Control | Icon | On tap | Auth | API | DB | Loading | Success | Error | Empty | Expired | Offline | Notify | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open | plus | eligibility gate | seller | — | — | Check | Form | Permission | — | — | Toast | none | `drop_create_view` |
| Title / description | — | bind | — | — | — | — | — | Length validation | Required | — | — | none | — |
| Media picker | image | Existing upload limits | — | upload | url | Uploading… | Preview | Toast | Required ≥1 image | — | Toast | none | `drop_media_upload` |
| Original price | currency | bind decimal | — | — | — | — | — | numeric(12,2) > 0 | Required | — | — | none | — |
| Discounted price | sale | bind | — | — | — | — | — | Must be < original (server) | Required | — | — | none | — |
| Quantity | boxes | bind int | — | — | — | — | — | ≥1 | Required | — | — | none | — |
| Starts at / Ends at | calendar | datetime pickers | — | — | — | Server validate | Preview duration | endsAt > startsAt ≥ now for schedule | Required | — | — | none | — |
| Terms textarea | file-text | bind | — | — | — | — | — | Min length | Required | — | — | none | — |
| Link Hype Room (optional) | users | Select/create room | +rooms flag | — | nullable FK | — | Linked | Toast | Optional | — | — | none | `drop_link_room` |
| Save draft | save | `drops.saveDraft` | seller | mutation | status=draft | Saving… | Toast | Toast | — | Draft only | Toast | none | `drop_save_draft` |
| Schedule/Publish | send | `drops.schedule` / `drops.publish` | seller | mutation | scheduled/live | Publishing… | Toast + navigate S7 | Validation toast | — | — | Toast | Featured review if requested | `drop_publish` |
| Cancel | x | Back discard warning | — | — | none | — | — | — | — | — | — | none | — |

### 18.9 S9 — Rewards (Coins)

| Control | Icon | On tap | Auth | API | DB | Loading | Success | Error | Empty | Expired | Offline | Notify | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open rewards | coins | S9 | protected + flag | `rewards.balance` + `rewards.history` | ledger read | Skeleton | Balance + list | Retry | “No coins yet” copy + earn hints | n/a (no expiry in v1 unless rule says) | Toast | Credit toasts from server push/poll | `rewards_view` |
| Balance card | wallet | none | — | sum credited − reversed | — | — | — | — | 0 state | — | Last known | none | — |
| History list | list | paginate | — | `rewards.history` | read | Spinner | Entries with action labels | Toast | Empty | — | Cached | none | `rewards_history_view` |
| Entry expand | chevron | Show source metadata + idempotency id | — | same | read | — | Details | — | — | — | — | none | `rewards_entry_expand` |
| Earn tab: How to earn | help | Section | — | `rewards.rulesPublic` | read | Skeleton | Rule cards (real limits) | Toast | Hide disabled rules | — | Toast | none | `rewards_how_view` |
| Daily limit meter | gauge | none | — | `rewards.dailyUsage` | read | — | Real progress | — | Full → “Daily limit reached” | Resets per server dayKey | Cached | none | — |
| Claim daily bonus (if enabled) | gift | `rewards.claimDaily` | protected | mutation | ledger + daily_usage | Claiming… | Credited amount toast | Already claimed / not eligible | Hide if disabled | n/a | Toast | none | `reward_claim_daily` |
| Milestones subsection | trophy | S11 | +flag | `milestones.list` | read | Skeleton | Achieved + progress | Toast | Empty | n/a | Toast | Milestone credit notice | `milestones_view` |
| Back | chevron-left | Leave | — | — | — | — | — | — | — | — | — | none | — |

**Watch rewards:** no user-facing “claim per video” button by design — crediting is automatic when server rules pass (§10.4). Optional subtle toast “+N Coins” on `credited` while watching (`video_rewards` on).

### 18.10 S10 — Free verification apply (profile owner tools)

| Control | Icon | On tap | Auth | API | DB | Loading | Success | Error | Empty | Expired | Offline | Notify | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Verification section | badge-check | Render state machine UI | owner | `verificationFree.status` | read | Skeleton | State-specific panel | Retry | Treat as `none` | n/a | Toast | Decision notification | `verification_free_view` |
| Eligibility checklist | list-checks | none (live metrics vs rules) | — | status payload includes rule + progress | — | — | Real follower age profile checks | — | Not eligible → show missing requirements (no fake progress) | n/a | Cached | none | — |
| Apply button | send | Enable only when `eligible` → `verificationFree.apply` | protected | mutation | insert application status=pending | “Submitting…” | Pending state | Rule failure toast | Disabled with reason text | n/a | Toast | none | `verification_free_apply` |
| Evidence upload (optional) | paperclip | Existing upload validation | — | upload | evidence URLs | Uploading… | Attached | Toast | Optional | n/a | Toast | none | `verification_free_evidence` |
| Withdraw application | x | `verificationFree.withdraw` if product allows | protected | mutation | pending→withdrawn/none | Saving… | Toast | Toast | — | n/a | Toast | none | `verification_free_withdraw` |
| Status chip | clock/check | none | — | — | — | — | `pending`/`verified`/`business_verified`/`official`/`rejected` copy | — | `none` hides chip | n/a | — | On decide: notify | — |
| Paid path link (existing) | credit-card | Existing GetVerifiedPanel behavior remains until retired | — | `payments.*` | `transactions` | Existing | Existing | Existing | — | — | — | Existing | Existing |

### 18.11 S12–S17 — Admin additions (all `adminProcedure`)

| Screen | Key controls | On tap | API | DB | States |
| --- | --- | --- | --- | --- | --- |
| S12 Feature flags | Flag list with enable/disable switches | Toggle → `admin.featureFlags.set` | Update `feature_flags` | Loading; error keeps previous; audit row | Empty → defaults from `FEATURE_FLAG_DEFAULTS` |
| S13 Rooms | List all rooms; Force expire; Archive; Ban host | Confirm mutations | `admin.hypeRooms.*` | Busy per row | Empty copy |
| S14 Drops | List; Feature on Discover; Force end; Takedown | Mutations | `admin.drops.*` | Busy | Empty |
| S15 Rewards | Ledger browser; filter user/status; Reverse entry (reason required) | `admin.rewards.reverse` | Insert reversal entry + status change | Double-confirm reverse; cannot reverse twice | Empty |
| S16 Free verification | Queue pending applications; view metric snapshot; Approve (grants verified/business_verified/official) / Reject with note | `admin.verificationFree.decide` | Application + profiles update in one transaction | Busy per row; one decision only | Empty “Queue clear” |
| S17 Milestone rules | CRUD rules (metric, threshold, coins, enabled) | `admin.milestones.*` | `milestone_rules` | Validation ≥0 coins | Empty → create CTA |

Existing Admin TimeWheels/verification-payment/sponsor sections remain unchanged.

---

## 19. State Machines

**Source of truth: server timestamps** (`now()` in SQL or `Date.now()` on server at write/read-advance). Clients display interpolated time only.

### 19.1 Hype Room

```
scheduled ──(startsAt <= now, lazily or job)──► live
    │                                            │
    │ host/admin cancel                          │ endsAt <= now  OR host ends early
    ▼                                            ▼
archived ◄────(admin/archive job / retention)── expired
```

| From | To | Trigger | Guard |
| --- | --- | --- | --- |
| scheduled | live | Time or host “start now” | not cancelled; startsAt ≤ now+ε |
| scheduled | archived | Host cancel / admin cancel | no required chat history loss policy (messages none) |
| live | expired | `endsAt ≤ now` or host end | Server only |
| expired | archived | Archive policy (age or admin) | Transcript retained |
| expired | * | **No return to live** in v1 (reopening = new room) | — |
| archived | * | Terminal | — |

Illegal: `live → scheduled`, `expired → live`, `archived → live`.

### 19.2 Drop

```
draft ──publish/schedule──► scheduled ──(startsAt<=now)──► live
  │                              │                            │
  │ delete (own, unsold)         │ cancel → archived          ├─(remaining==0)─► sold_out
  ▼                              ▼                            └─(endsAt<=now or seller end)─► ended
archived                        archived                         │
                                                                  ▼
                                                          (archive policy) ──► archived
```

| From | To | Trigger | Guard |
| --- | --- | --- | --- |
| draft | scheduled | Seller schedule | Validation complete; times future |
| draft | live | Seller publish now | `startsAt ≤ now` allowed at publish |
| draft | archived/deleted | Seller discard | No claims |
| scheduled | live | Time / seller start | Not cancelled |
| scheduled | archived | Seller cancel | Claims none (or refunds N/A — no payments) |
| live | sold_out | Claim decrements remaining to 0 | Atomic update |
| live | ended | `endsAt ≤ now` or seller/admin end | Claims frozen |
| sold_out | ended | Time passes | Cosmetic consistency |
| ended/sold_out | archived | Policy/admin | Claims history retained |

Illegal: `live → draft`, `ended → live`, `sold_out → live` (unless explicit un-sell operation — **not in v1**; restock = new drop).

### 19.3 Reward (ledger entry)

```
eligible* ──► pending ──► approved ──► credited ──► reversed
                  │            │
                  └──► rejected (terminal, no balance change)
```

\* `eligible` is a pre-entry condition (rules pass); the first persisted row is `pending` or directly `approved→credited` depending on whether auto-approve is enabled (config `autoApproveRewards`, default **true** for watch rewards after all checks — still writes full status chain timestamps for audit).

| From | To | Trigger | Guard |
| --- | --- | --- | --- |
| (eligible) | pending | Credit request accepted | Idempotency key new; caps OK |
| pending | approved | Auto rules pass or admin approve | No fraud flag blocking |
| pending | rejected | Rule fail / review | No balance change |
| approved | credited | Balance cache update + finalize | Same DB transaction as cache |
| credited | reversed | Admin reversal | Compensating negative entry; `reversedByEntryId` set; balance cache updated |
| rejected/reversed | * | Terminal | — |

Illegal: editing `amount` on a credited row; deleting ledger rows (soft status only + compensating entries).

### 19.4 Verification (free path)

```
not_eligible ──(rules pass)──► eligible ──(user apply)──► pending
                                                    │
                              ┌── admin approve ────┤
                              ▼                     └── admin reject ──► (rejected → back to eligible/none per config)
                          approved states:
                          verified | business_verified | official
```

Legacy paid path: `transactions.pending → approved|rejected` remains; approval sets `isVerified` + maps `verificationStatus`.

| From | To | Trigger |
| --- | --- | --- |
| none/not_eligible | eligible | Periodic rules evaluation or status query computation |
| eligible | pending | User submits application |
| pending | verified / business_verified / official | Admin approve (choose class) |
| pending | eligible (rejected) | Admin reject with note; user may re-apply after cooldown (config, default none in v1) |
| any verified* | verified* | Admin may upgrade/downgrade class |
| any | none | Admin revoke (sets `isVerified=false` too) |

Follower count changes can move `eligible ⇄ not_eligible` only while **not** pending/approved.

### 19.5 Video watch session (reward support)

`open → completed → reward_pending → reward_credited | reward_rejected` ; `open → expired` (heartbeat timeout). Transitions server-side only.

---

## 20. Database Model Plan

> **Phase 0 does not execute any migration.** All items are specified for later phases (§28).

### 20.1 Existing tables — reuse matrix

| Table | Reuse decision | Additive changes (later phase) |
| --- | --- | --- |
| `users` | Reuse | None required |
| `profiles` | Reuse | + `verificationStatus` enum; optional + `sellerEnabled` bool; keep `isVerified` |
| `follows` | Reuse | None (milestones read counts) |
| `blocks` | Reuse | None |
| `videos` + engagement tables | Reuse | None for Phase 1–2 |
| `community_*` | Reuse as announcements | None — **no room columns added here** |
| `sponsor_bids_*`, `participants`, `live_sponsors`, `session_winners` | Untouched | None |
| `wallets`, `wallet_transactions` | Untouched (BDT only) | None — **Coins are new tables** |
| `transactions` | Untouched paid verification | None |
| `reports` | Reuse | Optional + `targetType` later; prefer new moderation table for room/drop targets (below) |
| `raw_pulse_*` | Untouched | None |

### 20.2 New tables

For each: **why**, **reuse instead?**, **fields**, **relations**, **lifecycle**, **indexes/unique**, **migration needed**.

---

#### `feature_flags`

| | |
| --- | --- |
| **Why** | Runtime toggles so features ship dark and can be disabled in production without redeploy. |
| **Reuse instead?** | No existing flag table; env-only cannot be toggled per instance safely at runtime. Shared key list lives in `shared/featureFlags.ts`. |
| **Fields** | `id` PK; `flagKey` varchar unique (check in app against `FEATURE_FLAG_KEYS`); `enabled` bool default false; `updatedAt` timestamptz; `updatedBy` int FK `users.id` null set null; optional `description` text. |
| **Relations** | N/A (singleton rows). |
| **Lifecycle** | Insert defaults off; admin updates; no delete (keep history via optional `feature_flag_audit` later). |
| **Indexes/unique** | UNIQUE(`flagKey`). |
| **Migration** | Yes (additive CREATE TABLE). |

---

#### `hype_rooms`

| | |
| --- | --- |
| **Why** | Time-limited rooms cannot be modeled by announcements (no lifecycle/membership) or sponsor sessions (paid wheel domain). |
| **Reuse instead?** | **No** — explicit product boundary; reusing `sponsor_bids_sessions` or `community_announcements` would couple unrelated domains. |
| **Fields** | `id` PK identity; `hostId` FK `users.id` ON DELETE CASCADE (or RESTRICT if archival preferred — **choose RESTRICT + soft host anonymization** for archive integrity; decision §33); `title` varchar(180) NOT NULL; `topic` varchar(120) null; `description` text null; `coverUrl` varchar(1024) null; `status` enum `hype_room_status` (`scheduled`,`live`,`expired`,`archived`) NOT NULL default `scheduled`; `durationHours` int NOT NULL CHECK IN (4,6,12,24); `startsAt` timestamptz NOT NULL; `endsAt` timestamptz NOT NULL; `visibility` enum (`public`,`link_only`) default `public`; `dropId` int null FK `drops.id` ON DELETE SET NULL; `pinnedMessageId` int null; `createdAt`,`updatedAt` timestamptz NOT NULL default now(); `expiredAt` timestamptz null; `archivedAt` timestamptz null; `cancelReason` text null. |
| **Relations** | host→users; drop→drops (nullable); members/messages via child tables. |
| **Lifecycle** | §19.1; `endsAt = startsAt + durationHours * interval '1 hour'` enforced app-side + optional CHECK. |
| **Indexes/unique** | INDEX(`status`,`endsAt`); INDEX(`status`,`startsAt`); INDEX(`hostId`,`createdAt`); INDEX(`dropId`) where not null. |
| **Migration** | Yes. |

---

#### `hype_room_members`

| | |
| --- | --- |
| **Why** | Membership, join time, host removal, ban state. |
| **Reuse instead?** | `participants` is session-scoped to TimeWheels (`sessionId` FK) — **cannot reuse** without breaking paid wheel integrity. Pattern reference only. |
| **Fields** | `id` PK; `roomId` FK CASCADE; `userId` FK CASCADE; `role` enum (`member`,`host`) default `member`; `joinedAt` default now(); `leftAt` null; `bannedAt` null; `removedBy` null FK users. |
| **Relations** | room, user. |
| **Lifecycle** | Insert on join; soft leave (`leftAt`); ban flag; archived rooms keep rows. |
| **Indexes/unique** | UNIQUE(`roomId`,`userId`); INDEX(`userId`,`joinedAt`); partial INDEX active members (`leftAt IS NULL AND bannedAt IS NULL`). |
| **Migration** | Yes. |

---

#### `hype_room_messages`

| | |
| --- | --- |
| **Why** | Live discussion; announcement comments are bound to `community_announcements` and lack room scoping/expiry locks. |
| **Reuse instead?** | **No** for storage (different parent). Reuse **patterns** from `video_comments` (audio fields, lengths) and `community_comments`. |
| **Fields** | `id` PK; `roomId` FK CASCADE; `userId` FK SET NULL? → **CASCADE with tombstone content** decision: keep `userId` FK CASCADE and accept user delete removes messages **or** SET NULL + keep body — **prefer `userId` references `users.id` ON DELETE CASCADE` matching existing comment tables** for consistency; `body` text null; `audioUrl` text null; `audioDuration` int null; `pinned` bool default false; `createdAt` default now(); `moderatedAt` null; `moderatedBy` null. |
| **Relations** | room, user. |
| **Lifecycle** | Insert only while room `live` (app guard); moderation soft-hide (`body` set null + `moderatedAt` **or** separate `hidden` bool — prefer `hiddenAt` without destroying audit); never delete in normal ops. |
| **Indexes/unique** | INDEX(`roomId`,`createdAt`); INDEX(`userId`). |
| **Migration** | Yes. |

---

#### `drops`

| | |
| --- | --- |
| **Why** | Time-limited deal events; no existing table holds offer economics + window + stock. |
| **Reuse instead?** | **No.** `live_sponsors` is sponsorship display; `transactions` is fiat verification; wallets are BDT. Marketplace tables would violate “not a marketplace”. |
| **Fields** | `id` PK; `sellerId` FK users CASCADE; `title` varchar(180); `description` text; `terms` text NOT NULL; `mediaUrl` varchar(1024) NOT NULL (+ optional width/height); `currency` varchar(8) default `'BDT'` display-only; `originalPrice` numeric(12,2) CHECK > 0; `discountedPrice` numeric(12,2) CHECK > 0; CHECK `discountedPrice < originalPrice`; `quantity` int CHECK > 0; `remainingQuantity` int CHECK >= 0; `status` enum `drop_status` (`draft`,`scheduled`,`live`,`sold_out`,`ended`,`archived`) default `draft`; `startsAt` timestamptz; `endsAt` timestamptz; `createdAt`,`updatedAt`; `featured` bool default false; `featuredAt` null; `endedAt` null; `archivedAt` null; CHECK `remainingQuantity <= quantity`. |
| **Relations** | seller→users; claims→drop_claims; optional room→hype_rooms (room side holds FK). |
| **Lifecycle** | §19.2; lazy advance on read + on claim. |
| **Indexes/unique** | INDEX(`status`,`endsAt`); INDEX(`sellerId`,`createdAt`); INDEX(`featured`) where featured; INDEX(`status`) where `status='live'`. |
| **Migration** | Yes. |

---

#### `drop_claims`

| | |
| --- | --- |
| **Why** | Server-authoritative claim records with idempotency; supports fulfilment without payments. |
| **Reuse instead?** | No. |
| **Fields** | `id` PK; `dropId` FK CASCADE; `userId` FK CASCADE; `status` enum (`claimed`,`released`,`fulfilled`,`cancelled`) default `claimed`; `idempotencyKey` varchar(160) NOT NULL; `claimedAt` default now(); `updatedAt`; `fulfilledAt` null; `cancelledAt` null; `notes` text null (seller). |
| **Relations** | drop, user. |
| **Lifecycle** | Status updates by seller/admin/user withdraw while rules allow. |
| **Indexes/unique** | UNIQUE(`idempotencyKey`); UNIQUE(`dropId`,`userId`) **one claim per user per drop** (product v1); INDEX(`userId`,`claimedAt`); INDEX(`dropId`,`status`). |
| **Migration** | Yes. |

---

#### `reward_rules`

| | |
| --- | --- |
| **Why** | Admin-configurable earning rules (caps, thresholds, enablement) without hardcoding. |
| **Reuse instead?** | No. |
| **Fields** | `id` PK; `code` varchar unique; `action` enum reward action; `enabled` bool default false; `coinsAmount` int NOT NULL >= 0; `dailyLimitPerUser` int null; `minWatchSeconds` int null; `watchPercentThreshold` int null CHECK 0–100; `minVideoDurationSeconds` int null; `config` jsonb default `{}`; `updatedAt`; `updatedBy`. |
| **Lifecycle** | Admin CRUD; versioning via `config.ruleVersion` or audit table. |
| **Indexes/unique** | UNIQUE(`code`); INDEX(`action`,`enabled`). |
| **Migration** | Yes. |

---

#### `reward_ledger_entries` (immutable)

| | |
| --- | --- |
| **Why** | Auditable source of truth for Coins; wallets cannot be reused (fiat, session FK). |
| **Reuse instead?** | **No** — constitution §10. |
| **Fields** | As §10.2 (`userId`, `idempotencyKey`, `sourceType`, `sourceId`, `action` enum, `amount` bigint/int, `status` enum, `reviewStatus` enum, timestamps, `metadata` jsonb, `reversesEntryId` null FK self, `reversedByEntryId` null, `ruleId` null FK, `adminId` null). |
| **Constraints** | No UPDATE on `amount`/`action`/`userId` (enforced in app + optional trigger in later hardening); status transitions app-enforced. |
| **Indexes/unique** | UNIQUE(`idempotencyKey`); INDEX(`userId`,`createdAt` DESC); INDEX(`status`,`reviewStatus`); INDEX(`sourceType`,`sourceId`); INDEX(`action`,`createdAt`). |
| **Migration** | Yes. |

---

#### `coin_accounts` (optional cache — recommended)

| | |
| --- | --- |
| **Why** | Fast balance reads; must always equal ledger sum. |
| **Reuse instead?** | Must not reuse `wallets`. |
| **Fields** | `userId` PK/FK CASCADE; `balance` bigint NOT NULL default 0 CHECK >= 0; `lifetimeEarned` bigint; `lifetimeReversed` bigint; `updatedAt`. |
| **Invariant** | Written only in same transaction as ledger credit/reverse; nightly reconciliation job compares to ledger. |
| **Indexes** | PK userId. |
| **Migration** | Yes (or defer — balance via sum query if volume low; decision: **create in same phase as ledger** for UX). |

---

#### `reward_daily_usage`

| | |
| --- | --- |
| **Why** | Enforce daily caps with atomic unique day bucket. |
| **Fields** | `id` PK; `userId` FK; `dayKey` date/varchar `YYYY-MM-DD`; `action` enum; `count` int default 0; `coinsToday` int default 0; `updatedAt`. |
| **Unique** | UNIQUE(`userId`,`dayKey`,`action`). |
| **Migration** | Yes. |

---

#### `video_watch_sessions`

| | |
| --- | --- |
| **Why** | Server-side watch lifecycle so rewards never trust a lone play event. |
| **Reuse instead?** | Cannot reuse `videos.viewCount` / `viewDedup` (IP-level, no user session semantics). |
| **Fields** | `id` PK; `userId` FK; `videoId` FK CASCADE; `status` enum (`open`,`completed`,`reward_pending`,`reward_credited`,`reward_rejected`,`expired`); `startedAt`; `lastHeartbeatAt`; `completedAt` null; `watchedSeconds` numeric/int accumulated; `progressPercent` numeric(5,2); `sessionId` uuid/varchar client-generated **unique per (userId,videoId,window)** as `clientSessionId` varchar(64); `rewardEntryId` null FK ledger; `createdAt`. |
| **Unique** | UNIQUE(`clientSessionId`); INDEX(`userId`,`videoId`,`startedAt`); INDEX(`status`,`lastHeartbeatAt`) for expiry sweeps. |
| **Migration** | Yes. |

---

#### `verification_rules`

| | |
| --- | --- |
| **Why** | Configurable free-verification thresholds (followers not hardcoded). |
| **Fields** | `id` PK; `key` varchar unique (`default`); `minFollowers` int; `minAccountAgeDays` int; `minProfileCompleteness` int; `maxOpenSeriousReports` int; `enabled` bool; `ruleVersion` int; `updatedAt`; `updatedBy`; `payload` jsonb for extra heuristics. |
| **Migration** | Yes (seed single row defaults marked clearly as initial product values). |

---

#### `verification_applications`

| | |
| --- | --- |
| **Why** | Free verification pending/approved/rejected audit separate from paid `transactions`. |
| **Reuse instead?** | Paid `transactions` is payment-specific (amount, method, TrxID) — do not overload. |
| **Fields** | `id` PK; `userId` FK; `status` enum (`pending`,`approved`,`rejected`,`withdrawn`); `requestedClass` enum (`verified`,`business_verified`,`official`); `metricsSnapshot` jsonb; `evidenceUrls` jsonb; `ruleVersion` int; `reviewerId` null FK; `reviewNote` text null; `createdAt`,`decidedAt` null; partial UNIQUE one pending per user: UNIQUE(`userId`) WHERE `status='pending'`. |
| **Migration** | Yes. |

---

#### `milestone_rules` / `milestone_awards`

| | |
| --- | --- |
| **Why** | Configurable milestones + idempotent awards into ledger. |
| **rules fields** | `id`; `code` unique; `metric` varchar; `threshold` bigint; `coinsReward` int >= 0; `badgeKey` null; `enabled`; `sortOrder`; `updatedAt`; `updatedBy`. |
| **awards fields** | `id`; `userId`; `ruleId` FK; `idempotencyKey` unique `milestone:{userId}:{ruleId}`; `metricValueAtAward` bigint; `ledgerEntryId` FK; `awardedAt`. |
| **Migration** | Yes (both tables). |

---

#### `notifications` (durable product notifications)

| | |
| --- | --- |
| **Why** | Current activity feed is **derived** from engagement tables; cannot represent room lifecycle, drop claim status, reward credits, verification decisions without exploding query logic. |
| **Reuse instead?** | Keep existing derived `home.notifications` for reaction/share/comment/follow **unchanged** (backward compatible). Add table only for **non-derivable** system events; client can merge two sources or migrate gradually (§29). |
| **Fields** | `id` PK; `userId` FK CASCADE (recipient); `type` varchar/enum (`room_started`,`room_ending_soon`,`room_message_removed`,`drop_live`,`drop_claim_fulfilled`,`reward_credited`,`verification_decided`,`milestone_achieved`, …); `title` text; `body` text; `entityType` varchar null (`hype_room`,`drop`,`reward`,…); `entityId` int null; `link` varchar null; `readAt` null; `createdAt`. |
| **Indexes** | INDEX(`userId`,`readAt`,`createdAt` DESC); INDEX(`userId`,`createdAt`). |
| **Migration** | Yes. Optional for earliest room/drop phases if push-only — **spec includes table because expiry/reminder events need durability**. |

---

#### `analytics_events`

| | |
| --- | --- |
| **Why** | §23 requires event tracking; none exists today. |
| **Reuse instead?** | No; do not overload audit logs. |
| **Fields** | `id` bigserial; `name` varchar(120); `userId` null; `sessionId`/`anonId` varchar null; `entityType`/`entityId` null; `props` jsonb; `createdAt` default now(); `appVersion` null. |
| **Indexes** | INDEX(`name`,`createdAt`); INDEX(`userId`,`createdAt`). Partition/retention later. |
| **Migration** | Yes — **phase later than core features** (instrumentation can start client→endpoint first). |

---

#### `moderation_actions`

| | |
| --- | --- |
| **Why** | Admin actions on rooms/drops/messages/verifications need an audit distinct from user `reports`. |
| **Fields** | `id`; `adminId` FK; `action` varchar; `targetType`; `targetId`; `reason` text; `metadata` jsonb; `createdAt`. |
| **Indexes** | INDEX(`targetType`,`targetId`); INDEX(`adminId`,`createdAt`). |
| **Migration** | Yes (can ship with first moderation-requiring feature). |

---

### 20.3 New enums (names stable)

`hype_room_status`, `hype_room_visibility`, `hype_room_member_role`, `drop_status`, `drop_claim_status`, `reward_action`, `reward_entry_status`, `reward_review_status`, `verification_status` (`none`,`eligible`,`pending`,`verified`,`business_verified`,`official` — plus treat legacy absence as `none`), `verification_application_status`, `verification_class`, `watch_session_status`, `notification_type` (or varchar if preferring flexibility — **prefer enum for core types, varchar for experimental**).

### 20.4 Collision avoidance (explicit)

| Risk | Avoidance |
| --- | --- |
| Overloading `community_*` for rooms | Separate `hype_room_*` tables |
| Overloading `sponsor_bids_sessions`/`participants` | Separate room tables; never add room columns there |
| Coins in `wallets` | Separate `reward_ledger_entries` + `coin_accounts` |
| Free verification in `transactions` | Separate `verification_applications` |
| Second video viewer | No schema change; UI invariant §7 |
| FK cycles rooms↔drops | Nullable `hype_rooms.dropId` only |

---

## 21. API / tRPC Plan

Follow existing patterns: Zod input, `publicProcedure` / `protectedProcedure` / `adminProcedure`, data functions in `server/db.ts` (or new `server/db/*.ts` if split later), register routers in `server/routers.ts`, rate limits in `server/_core/index.ts`.

### 21.1 Proposed routers

| Router | Procedures (planned) | Procedure level | Flag |
| --- | --- | --- | --- |
| `discover` | `overview` | public | `discover_v2` |
| `now` | `overview` | public | `jhilik_now` |
| `hypeRooms` | `list`, `byId`, `members`, `messages`, `create`, `join`, `leave`, `sendMessage`, `end`, `pin`, `removeMember` | public reads; rest protected + ownership checks | `time_limited_communities` |
| `drops` | `list`, `byId`, `myClaim`, `claim`, `saveDraft`, `schedule`, `publish`, `update`, `end`, `claims` (seller) | public reads; mutations protected+eligibility | `jhilik_drops` |
| `rewards` | `balance`, `history`, `rulesPublic`, `dailyUsage`, `claimDaily` | protected | `jhilik_rewards` (+`video_rewards` for watch paths) |
| `watchRewards` | `heartbeat` (or fold into `rewards.heartbeat`) | protected | `video_rewards` |
| `verificationFree` | `status`, `apply`, `withdraw` | protected | `free_verification` |
| `milestones` | `list` (user progress) | protected | `milestone_rewards` |
| `features` | `active` (public map of flag→bool for client gating) | public | always (returns all false until table exists → fail closed) |
| `notifications` | `list`, `unreadCount`, `markRead` | protected | when durable notifications ship |
| `admin.featureFlags` | `list`, `set` | admin | — |
| `admin.hypeRooms` | `list`, `forceEnd`, `archive`, `banUser` | admin | rooms flag |
| `admin.drops` | `list`, `feature`, `forceEnd`, `takedown` | admin | drops flag |
| `admin.rewards` | `ledger`, `reverse`, `setRule` | admin | rewards flag |
| `admin.verificationFree` | `queue`, `decide` | admin | free_verification |
| `admin.milestones` | `list`, `create`, `update` | admin | milestone_rewards |

Existing routers unchanged: `auth`, `profile`, `home`, `videos`, `community`, `sponsorBids`, `payments`, `admin` (TimeWheels), `rawPulse`, `system`.

### 21.2 Cross-cutting API rules

1. Server returns `serverNow` on any payload with countdowns (match `getSponsorBidsState`).
2. Flagged routers: either don’t register until flag infrastructure ready, or always register but **procedure body checks flag and throws `FORBIDDEN`/`PRECONDITION_FAILED` when disabled** (fail closed). Prefer **check-in-handler** so a single deploy can register routes safely while flags stay off.
3. Every mutation that creates rows uses idempotency keys where specified.
4. Rate limits (initial proposal): room `sendMessage` 20/min; `drops.claim` 10/min; `rewards.heartbeat` 60/min; `discover.overview` / `now.overview` 10–20/min; admin stricter by IP as today.
5. No client-trusted status transitions: inputs may request “end room”, server validates role+state+time.

### 21.3 REST endpoints retained

| Endpoint | Retention |
| --- | --- |
| `/api/spotlight/highlights` | Keep until `discover_v2` migration complete + deprecation window |
| `/api/health`, `/api/ready` | Keep |
| Upload / comment REST routes | Keep |

---

## 22. Notification Matrix

Legend: **Push** = durable row in `notifications` (new) · **Derived** = existing `home.notifications` activity item · **Toast** = in-session sonner · **Owner** = `notifyOwner` admin signal · **—** none

| Event | Actor | Recipient | Channel | Copy intent |
| --- | --- | --- | --- | --- |
| Pookie/comment/share on video | user | video owner | **Derived** (existing) | unchanged |
| New follower | user | followed user | **Derived** (existing) | unchanged |
| Room scheduled reminder (T-15m) | system | host + pre-joined members | **Push** | Starting soon |
| Room goes live | system | host + members + followers (if product opts in) | **Push** (+ toast for host) | Live now |
| Room ending soon (T-10m) | system | active members | **Push** | Ending soon |
| Room expired | system | host | **Push** | Room ended |
| Room message (normal) | member | members | in-room only; optional digest **Push** later | — |
| Message removed by moderation | admin | message author + host | **Push** | Content removed |
| Member removed/banned | host/admin | user | **Push** | Access changed |
| Drop goes live | seller/system | followers optional / NOW viewers none | **Push** optional | New drop |
| Drop ending soon | system | users with claim interest? (v1: none or claimers only) | **Push** to claimers if pre-notify enabled | Ending soon |
| Drop sold out | system | claimers | **Push** | Sold out (claims remain valid) |
| Claim fulfilled/released/cancelled | seller/admin | claimer | **Push** | Status change |
| Reward credited | system | user | **Toast** + **Push** | +N Coins |
| Reward reversed | admin | user | **Push** | Adjustment |
| Daily limit reached | system | user | **Toast** only | Limit reached |
| Milestone achieved | system | user | **Toast** + **Push** | Badge/coins |
| Free verification eligible | system | user | **Push** (or soft badge only — decision §33) | You can apply |
| Free verification approved/rejected | admin | user | **Push** | Decision |
| Paid verification approved/rejected | admin | user | existing UX (status UI) + optional **Push** later | unchanged v1 |
| Drop/room reported | user | — (admin queue) | admin surface | — |
| Critical fraud finding | system | admins | **Owner** notify + admin queue | Review needed |
| Feature flag toggled | admin | admins | audit only | — |

User notification preferences: **out of scope v1** (all product pushes on except room digest default off); expansion §33.

---

## 23. Analytics / Event Tracking Plan

**Current state:** no event pipeline; only `videos.viewCount`.

### 23.1 Approach

1. **Phase A (with first new feature):** server-side insert into `analytics_events` on key mutations + a thin client `track(name, props)` helper calling a batched `analytics.track` tRPC (protected or with anon id). Fail-open: tracking errors never break UX.
2. **Phase B:** retention job (e.g. 180 days hot), optional export.

### 23.2 Core events (canonical names)

| Name | Properties |
| --- | --- |
| `screen_view` | `screenId` (S1–S11) |
| `discover_view`, `discover_content_open`, `discover_creator_open`, `discover_topic_open`, `discover_now_open`, `discover_drop_open` | ids |
| `now_view`, `now_room_open`, `now_drop_open`, `now_content_open`, `now_trend_open` | ids |
| `rooms_lobby_view`, `room_open`, `room_join`, `room_leave`, `room_message_send`, `room_end`, `room_report` | roomId, status |
| `drops_list_view`, `drops_open`, `drop_claim`, `drop_claim_status_view`, `drop_create_view`, `drop_publish`, `drop_end`, `drop_share` | dropId, status |
| `rewards_view`, `rewards_history_view`, `reward_claim_daily`, `rewards_entry_expand` | amounts |
| `watch_session_start`, `watch_session_complete`, `watch_reward_credited`, `watch_reward_rejected` | videoId, watchedSeconds, reason |
| `milestones_view`, `milestone_awarded` | ruleCode |
| `verification_free_view`, `verification_free_apply`, `verification_free_decided` | status |
| `feature_flag_state` | flagKey, enabled (admin toggles) |
| `admin_*` actions | adminId, target |

### 23.3 Metrics derived

- Discover CTR, NOW card CTR, room DAU/messages per live room, drop claim conversion (views→claims), reward credit rate vs reject rate, verification funnel, flag cohort comparisons.

### 23.4 Privacy

- No message bodies or payment credentials in `props`.
- userId present when authed; anon id otherwise; align with future privacy policy (§33).

---

## 24. Anti-Abuse / Fraud Plan

| Domain | Controls |
| --- | --- |
| **General** | Existing per-IP rate limits; `protectedProcedure`; block lists honored in listings; server-only state transitions |
| **Watch rewards** | Heartbeat cadence + visibility rules; min duration/percent; daily per-user caps (`reward_daily_usage` unique); per-video-per-day cap; no self-watch; session uniqueness (`clientSessionId`); velocity thresholds (videos/hour); `reviewStatus=flagged` quarantine for borderline; background sweep for impossible watch time vs wall clock; **never credit on play event alone**; reuse/extend `viewDedup` ideas only as supplementary signal (it is IP-based, not reward authority) |
| **Coins ledger** | Idempotency unique keys; single-transaction credit+balance; admin reversal only for adjustments; no user-writable ledger; reconciliation job balance vs sum |
| **Milestones** | Server aggregates only; one award per (user, rule); metric manipulation via fake follows caught by follow rate limits + review |
| **Free verification** | Multi-factor rules; not auto-approved by followers alone; application snapshot prevents mid-review metric swaps; one pending application; admin review; cooldown on reject (config) |
| **Drops** | Atomic remaining decrement (`WHERE remaining > 0`); unique claim per user; server countdown; seller eligibility; price CHECK; claim rate limiting; no client-set remaining |
| **Rooms** | Membership unique; ban list; message rate limits; host controls; force-expire by admin; no status rollback |
| **Paid systems** | TimeWheels/wallets/transactions **unchanged** attack surface — regression tests only |
| **Admin** | All reverse/feature/decide actions require reason where destructive; future `moderation_actions` audit |
| **Outstanding** | Device fingerprinting, CAPTCHA on sensitive creates, warehouse-grade WAF — expansion §33 |

---

## 25. Moderation Plan

| Layer | Mechanism |
| --- | --- |
| **Pre-publish** | Existing media validation; length limits; seller terms required |
| **User report** | Extend reporting beyond `reports.reason` free text: target types `user`, `video` (optional later), `hype_room`, `hype_room_message`, `drop` — implement as extended `reports` columns (`targetType`,`targetId`) **or** `moderation_reports` — **prefer additive columns on `reports` if compatible; else new table** (small migration either way) |
| **Admin queue** | `/admin` new section: open reports, room messages, drops |
| **Actions** | Hide/remove message; remove member; ban from room; force-expire room; takedown drop (→ ended/archived with reason); revoke verification; reverse ledger; shadow `feature_flags` off |
| **Audit** | `moderation_actions` rows |
| **Automation** | v1 = manual + rate limits; keyword filters expansion §33 |
| **Creator tools** | Room host pin/remove already in §18; video delete/comment delete unchanged |

Announcement publishing rules (verified creators/companies only) remain as-is.

---

## 26. Payment / Commerce Boundary

**Hard boundary:**

```
┌─────────────────────────────────────────────────────────┐
│ JHILIK social layer (in-app)                           │
│  • Discover / NOW listing of Drops                     │
│  • Drop detail, terms display, countdown (server time) │
│  • Claim interest (drop_claims) + quantity decrement   │
│  • Hype Room promotion of a Drop                       │
│  • Share links                                         │
└───────────────────────────┬─────────────────────────────┘
                            │ NO card/wallet/bkash fields here
                            ▼
┌─────────────────────────────────────────────────────────┐
│ Commerce / settlement boundary (external or future)    │
│  • Order/checkout service (future native) OR           │
│  • Seller external payment link / offline fulfilment   │
│  • Refunds, invoicing, tax, KYC                        │
│  • webhook: payment_ok → mark claim fulfilled*         │
└─────────────────────────────────────────────────────────┘
```

- **This phase does not build checkout.** Claim = social reservation + stock control, not payment.
- **Existing fiat surfaces** (TimeWheels BDT wallet, paid verification bKash/Nagad `transactions`) remain exactly as they are; they are **not** reused for Drops or Coins.
- **Coins** never convert to fiat in-product in this roadmap stage.
- Future native payments plug in at `drop_claims` status transition (`claimed → paid` or separate `orders` table FK to claim) **behind a new flag + spec amendment**; webhooks must be server-verified.
- Seller fulfilment v1: seller sees claimer identity per eligibility/privacy rules (product decision §33) and completes `fulfilled`.

---

## 27. Feature Flag Plan

### 27.1 Why a new mechanism (documented)

The repository had **no** feature-flag system (audit §2.8) — only static env config. Introducing flags requires runtime toggles; env-only would force redeploys and cannot be flipped per-environment safely from admin UI. Therefore Phase 0 adds:

1. **`shared/featureFlags.ts`** — single key vocabulary + defaults (all `false`); typechecked by `pnpm check`; zero runtime behavior change (no importers yet).
2. **Later phase:** `feature_flags` table + `features.active` query + `admin.featureFlags.set` + server helper `isFlagEnabled(key)` (cached ~30s) + client `useFeatureFlag`.

This is the **first** flag mechanism — not a second competing one. Future docs must not invent parallel `ENABLE_*` env toggles for these product features without amending this section.

### 27.2 Flag registry

| Key | Default | Gates |
| --- | --- | --- |
| `discover_v2` | false | Discover module/API presentation |
| `jhilik_now` | false | NOW tab + `now` router |
| `time_limited_communities` | false | Hype Rooms UI + router |
| `jhilik_drops` | false | Drops UI + router |
| `jhilik_rewards` | false | Coins balance/history UI |
| `video_rewards` | false | Watch heartbeat/credit (requires `jhilik_rewards`) |
| `milestone_rewards` | false | Milestone rules awards UI |
| `free_verification` | false | Free verification UI + router |

### 27.3 Semantics

- **Fail closed:** missing table/flag → treated as `false`.
- Server: check flag at top of flagged procedures.
- Client: hide tabs/CTAs when `features.active[key]` false; still rely on server checks.
- Dependencies: `video_rewards` ⇒ `jhilik_rewards`; `milestone_rewards` ⇒ `jhilik_rewards`. Helper warns if dependency false.
- Enablement order recommended: `discover_v2` → `jhilik_now` → `time_limited_communities` → `jhilik_drops` → `jhilik_rewards` → `video_rewards` → `free_verification` → `milestone_rewards` (each after its phase QA).

### 27.4 Phase 0 deliverable

- `shared/featureFlags.ts` only (created). No table, no admin UI, no behavior change.

---

## 28. Migration Strategy

1. **Never** `DROP`/`RENAME`/`TRUNCATE` production tables for this program without a written rollback (§32) and backup checkpoint.
2. Process per phase:
   - Author additive SQL in `drizzle/NNNN_description.sql` (match existing `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` style) **and** update `drizzle/schema.ts` (+ enums).
   - Validate on staging DB: `pnpm db:push` diff review (Drizzle push is primary today).
   - Apply to production via platform checkpoint/backup first (Render/Supabase), then push.
   - Deploy app code that is compatible with **both** pre- and post-migration schema where possible (add columns nullable/default first; backfill; then constraints).
3. **Ordering:** schema → server APIs (flagged) → client UI (flagged) → flag enablement.
4. **Column adds** on `profiles` (e.g. `verificationStatus`) use nullable/default `none` so old rows remain valid; backfill `isVerified=true` → `verificationStatus='verified'` (or product mapping) in the same migration.
5. **No destructive enum changes** to existing enums (`app_role`, `transaction_status`, etc.). New enums are new names.
6. Document each migration’s forward SQL, verification query (`SELECT count`), and rollback SQL in the phase PR template.

---

## 29. Backward Compatibility Strategy

| Area | Guarantee |
| --- | --- |
| Auth | Same Supabase bearer flow, `users` upsert, `adminProcedure` |
| Unified Shorts | No second viewer; tap contract unchanged (§7) |
| Feed / engagement | `home.feed`, `videos.*`, comments, follows unchanged signatures |
| Community announcements | Tables + `community.*` API unchanged |
| TimeWheels + BDT wallet | Untouched tables/APIs/UI |
| Paid verification | `payments.*` + `transactions` remain; free path additive |
| Notifications | Existing derived activity feed continues; new durable notifications are **additive** (client may merge) |
| Spotlight | REST remains until Discover flag migration completes |
| `profiles.isVerified` | Continues to drive badges; dual-write with `verificationStatus` |
| Routes | Existing paths keep working; new routes additive |
| Flags off | Production behavior = today’s HEAD behavior |
| Types | `shared/featureFlags.ts` additive; no breaking export changes |

---

## 30. QA / Test Matrix

**Tooling:** Vitest server tests (existing pattern under `server/**/*.test.ts`), `pnpm check` (tsc), `pnpm build`, manual two-account staging passes per README.

### 30.1 Regression (every phase)

| ID | Case |
| --- | --- |
| R1 | Login/logout; protected procedure 401 when signed out |
| R2 | Upload photo/video/short; playback aspect ratio preserved |
| R3 | For You loads READY media; text/photo posts appear |
| R4 | Tap short → Shorts section activates selected id (no other viewer) |
| R5 | Pookie, comment (+audio), share, save toggle and counts |
| R6 | 3-dot edit/delete on own content |
| R7 | Search users+videos; profile follow/unfollow; profile tabs |
| R8 | Notifications derived list still shows reaction/share/comment/follow |
| R9 | Community announcement create (verified) + react/bookmark/comment |
| R10 | TimeWheels join/sponsor/admin session flow smoke |
| R11 | Paid verification submit + admin approve sets badge |
| R12 | Admin route blocked for non-admin |
| R13 | `pnpm check`, `pnpm test`, `pnpm build` green |

### 30.2 Phase feature tests (summary; expand per phase PR)

| Feature | Tests |
| --- | --- |
| Flags | Defaults false; fail closed when table empty; admin toggle affects API |
| Discover | Flag off = old Spotlight; flag on modules; empty modules hidden; no checkout UI |
| NOW | Countdown uses `serverNow`; empty honest; live rooms/drops only |
| Rooms | Lifecycle transitions incl. cannot post when expired; unique join; host end; 4/6/12/24 duration; archive retains messages |
| Drops | Price CHECK; atomic remaining (concurrent claims); one claim/user; sold_out transition; no payment fields |
| Rewards | Idempotent credit; daily cap; no credit on play-only; reversal; balance=ledger sum |
| Watch | Heartbeat validation; expiry; own video no credit; rate limit |
| Free verification | Follower threshold from config not code; non-sufficient alone; one pending; approve writes both status fields |
| Milestones | Idempotent award; disabled rule ignores |
| Compat | With all flags off, R1–R13 identical to baseline |

### 30.3 Non-functional

- Rate limit 429 paths; migration on staging copy; rollback drill (§32) once per major phase.

---

## 31. Deployment Strategy

1. **Branching:** feature branches → PR into `main` after `pnpm check` + `pnpm test` + `pnpm build`.
2. **Platform:** Render auto-deploy on main (`render.yaml` `autoDeploy: true`); health `/api/health`.
3. **Sequence per phase:**  
   a. Backup/checkpoint DB.  
   b. Apply additive migration (staging → prod).  
   c. Deploy server+client with flags **off** (dark launch).  
   d. Smoke R1–R13 + feature flag-off parity.  
   e. Enable flag in production (admin or planned window).  
   f. Monitor errors, rate limits, ledger invariants, Render logs.  
4. **Config:** secrets remain in Render env; new flags runtime (not env).  
5. **Verification:** staging with two test accounts per README (no seeded fake production data).  
6. **Artifacts:** keep `dist` build from CI; no manual prod file edits.

---

## 32. Rollback Strategy

| Failure | Rollback |
| --- | --- |
| Bad feature behavior | **Disable feature flag** (primary kill switch) |
| Bad API/UI without flag | Redeploy previous git SHA (Render rollback) |
| Bad additive migration | Prefer forward-fix; if pre-data: restore checkpoint; never improvise DROP |
| Data backfill error | Pause flag; restore from backup; correct with reviewed script |
| Reward erroneous credits | Admin **reverse** ledger entries (compensating), disable `video_rewards` |
| Verification mistakes | Admin revoke/downgrade status; disable `free_verification` |
| Flag system failure | Treat all flags false (fail closed) = legacy behavior |

**Phase 0 specific rollback:** delete/unimport `shared/featureFlags.ts` (no importers) + remove spec doc if rejected — zero production impact.

---

## 33. Future Expansion Points

| Expansion | Hook |
| --- | --- |
| Native checkout/payments | Orders table + webhooks at claim boundary (§26); new flag |
| Seller portal / `seller_profiles` | If eligibility outgrows `accountType` |
| Split admin roles | `admin_permissions` without breaking `adminProcedure` |
| Notification preferences | Per-type opt out on `notifications` |
| Rooms live audio/video | New media pipeline; keep message core |
| Coin spending (themes, boosts) | `reward_action` spend enums + spend tables |
| Personalization ranking | Replace chronological For You carefully behind flag |
| Hashtags/topics graph | Formal `topics` tables when Discover needs them |
| Push notifications (mobile) | Capacitor + web push; server fanout from `notifications` |
| Analytics warehouse | Export `analytics_events` |
| i18n / multi-currency Drop display | `currency` already on drops |
| Follower-growth fraud ML | Signals into free verification `payload` |
| Content keyword auto-mod | Pre-moderation service |
| Timeline: deeper Shorts analytics | Event stream already specified |
| Retention policies | Room archive TTL, analytics TTL jobs |

---

## Appendix A — File reference (audit anchors)

| Concern | Location |
| --- | --- |
| Routes | `client/src/App.tsx` |
| Nav, tabs, drawers, modals | `client/src/pages/Home.tsx` |
| Feed/Shorts/Spotlight/Community/Search | `client/src/components/MediaHub.tsx` |
| Profile | `client/src/components/ProfileView.tsx` |
| Admin | `client/src/pages/Admin.tsx` |
| tRPC app router | `server/routers.ts` |
| Data access | `server/db.ts` |
| Schema | `drizzle/schema.ts` |
| Procedures/authz | `server/_core/trpc.ts`, `server/_core/context.ts` |
| Rate limits | `server/rateLimiter.ts`, `server/_core/index.ts` |
| Spotlight REST | `server/_core/index.ts` → `listSpotlightHighlights` |
| Owner notify | `server/_core/notification.ts` |
| Paid verification | `server/db.ts` + `payments` router + `transactions` table |
| Feature flag keys (new) | `shared/featureFlags.ts` |
| This specification | `docs/JHILIK_MASTER_PRODUCT_SPEC.md` |

## Appendix B — Phase roadmap (planning only)

| Phase | Scope | Flag(s) |
| --- | --- | --- |
| 0 | This spec + flag key scaffold | — |
| 1 | `feature_flags` runtime + `features.active` + admin toggles + schema foundations (notifications table optional) | infrastructure |
| 2 | Discover v2 | `discover_v2` |
| 3 | NOW | `jhilik_now` |
| 4 | Hype Rooms | `time_limited_communities` |
| 5 | Drops | `jhilik_drops` |
| 6 | Rewards ledger + balance UI | `jhilik_rewards` |
| 7 | Video watch rewards | `video_rewards` |
| 8 | Free verification | `free_verification` |
| 9 | Milestone rewards | `milestone_rewards` |
| 10 | Analytics instrumentation hardening | — |

Each phase: spec delta → migration → APIs → UI → tests → dark launch → flag on → monitor.

---

*End of Phase 0 specification.*

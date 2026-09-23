# JHILIK Phase 1 — Database + Backend Foundation

**Status:** Ready for review (not committed)  
**Date:** 2026-09-23  
**Spec:** `docs/JHILIK_MASTER_PRODUCT_SPEC.md` (§19–§21, §27–§29)  
**Branch:** `main` @ `9fe5fc2657e62dcbce62bf8a1e198248cecfb260` (Phase 0 commit base)

---

## 1. Goals (Phase 1 only)

1. Additive production-safe schema foundation for later JHILIK phases (Discover v2, NOW, Hype Rooms, Drops, Rewards, Free Verification, Milestones, durable notifications).
2. Feature-flag **runtime** (table + cached server helper + admin toggle + public `features.active`), all flags **OFF** by default, fail closed.
3. Shared pure **state machines** for later phase handlers.
4. Server-authoritative **Coin reward ledger** foundation (immutable entries + balance cache + daily usage + reversal) — **no** watch-credit wiring yet.
5. Minimal **tRPC surface** that has real purpose this phase; no empty product routers.
6. Document decisions, migration, validation; **stop before commit/push** for user review.

**Explicitly out of scope:** client redesign, product UI for rooms/drops/now/discover, video-watch rewards, free-verification apply flow UI, milestone award processing, analytics events, moderation actions.

---

## 2. File map (Phase 1)

| Path | Change |
| --- | --- |
| `drizzle/schema.ts` | Modified — new enums + tables + `profiles.verificationStatus` |
| `drizzle/0030_jhilik_phase1_foundation.sql` | **New** — additive forward migration |
| `drizzle/meta/_journal.json` | Modified — journal entry `0030` |
| `shared/featureFlags.ts` | Extended — dependency map + `resolveFeatureFlags()` |
| `shared/stateMachines.ts` | **New** — pure transition tables + helpers |
| `server/featureFlags.ts` | **New** — fail-closed cached runtime |
| `server/rewardLedger.ts` | **New** — ledger credit/finalize/reverse/balance/history |
| `server/routers.ts` | Modified — `features`, `admin.featureFlags`, `rewards` |
| `server/db.ts` | Modified — dual-write `verificationStatus` on paid path |
| `server/_core/index.ts` | Modified — rate limit `admin.featureFlags.set` |
| `docs/JHILIK_MASTER_PRODUCT_SPEC.md` | Phase 0 (uncommitted, preserved) |
| `docs/JHILIK_PHASE1_IMPLEMENTATION.md` | **This file** |

---

## 3. Table decisions (create / reuse / skip)

### Created (migration 0030)

| Table | Why | Key constraints |
| --- | --- | --- |
| `feature_flags` | Durable flag overrides for runtime | unique `flagKey` |
| `drops` | Drop catalog (Phase 5) | quantity/price checks; seller FK RESTRICT |
| `drop_claims` | User claims (Phase 5) | unique (drop,user); unique idempotency key |
| `hype_rooms` | Live rooms (Phase 4) | duration IN (4,6,12,24); host FK RESTRICT; nullable drop FK |
| `hype_room_members` | Membership + roles | unique (room,user) |
| `hype_room_messages` | Chat/transcript | room FK RESTRICT; author FK SET NULL |
| `reward_rules` | Server-authoritative coin rules | unique `code`; enabled default false |
| `reward_ledger_entries` | Immutable Coin source of truth | unique idempotency; amount ≠ 0; user FK RESTRICT |
| `coin_accounts` | Balance **cache** (same tx as ledger) | PK user; balance ≥ 0 |
| `reward_daily_usage` | Daily caps accounting | unique (user, dayKey, action) |
| `verification_rules` | Configurable free-verify thresholds | seed `key='default'`, `minFollowers=1000` |
| `verification_applications` | Free-verify queue | partial unique pending per user |
| `milestone_rules` | Milestone thresholds (Phase 9) | unique `code` |
| `milestone_awards` | Idempotent awards | unique (user,rule); unique idempotency |
| `notifications` | Durable push rows (additive) | user FK CASCADE |

### Additive column

| Change | Notes |
| --- | --- |
| `profiles.verificationStatus` | enum default `'none'` NOT NULL + index; backfill `isVerified=true` → `'verified'` |

### Reused (untouched except dual-write)

| Existing | Decision |
| --- | --- |
| `transactions` + `payments.*` | Paid verification **remains**; free path is additive (`verification_applications` + `profiles.verificationStatus`) |
| `profiles.isVerified` | Kept as boolean badge source; **dual-written** with `verificationStatus` |
| `community_*` | Announcements only — not reused as rooms |
| `sponsor_bids_*` / participants | TimeWheels — not reused as rooms |
| `wallets` / `wallet_transactions` | BDT fiat — **not** Coins |

### Deferred (intentionally not created this phase)

| Table | Ship in |
| --- | --- |
| `video_watch_sessions` | Phase 7 (video rewards) |
| `analytics_events` | Phase 10 |
| `moderation_actions` | First moderation feature (spec §15 allows later) |

---

## 4. FK decisions

| Relation | On delete | Rationale |
| --- | --- | --- |
| `hype_rooms.hostId` → users | **RESTRICT** | Preserve room history; cleanup/archive explicitly |
| `hype_rooms.dropId` → drops | **SET NULL** | Nullable link avoids circular required FKs; drop may be removed from room |
| `hype_room_messages.roomId` → hype_rooms | **RESTRICT** | Never hard-delete a room with transcript; archive instead |
| `hype_room_messages.userId` → users | **SET NULL** | Keep historical messages if author account removed |
| `drops.sellerId` → users | **RESTRICT** | Don't cascade-delete catalog/history |
| `drop_claims.dropId` → drops | **RESTRICT** | Claims outlive soft lifecycle of catalog row ops |
| `drop_claims.userId` → users | CASCADE | Personal claim row with account |
| `reward_ledger_entries.userId` → users | **RESTRICT** | Ledger must not orphan/cascade-delete |
| `reward_ledger_entries.ruleId/adminId` | SET NULL | Audit-friendly |
| `reward_ledger_entries.reverses/reversedBy` | SET NULL (self FK) | Reversal graph soft-linked |
| `coin_accounts.userId` → users | CASCADE | Cache dies with account |
| `milestone_awards.userId/ruleId` | RESTRICT | Awards are historical |
| `feature_flags.updatedBy` → users | SET NULL | Keep flag row if admin removed |
| `notifications.userId` → users | CASCADE | Per-user inbox |

Table creation order in SQL/schema: `feature_flags` → `drops` → `drop_claims` → `hype_rooms` → members/messages → reward tables → verification → milestones → notifications → `profiles` column.

---

## 5. Migration 0030

**File:** `drizzle/0030_jhilik_phase1_foundation.sql`  
**Style:** additive only — `CREATE TYPE` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `ALTER TABLE ... ADD CONSTRAINT` / `ADD COLUMN IF NOT EXISTS`; **no** `DROP` / `RENAME` / `TRUNCATE`.

### Forward

1. Apply `drizzle/0030_jhilik_phase1_foundation.sql` in order (statement breakpoints preserved).
2. Or `pnpm db:push` after reviewing Drizzle diff (primary path per spec §28).

### Verification queries (post-apply)

```sql
SELECT count(*) FROM feature_flags;                    -- 0 (rows appear after admin toggles)
SELECT count(*) FROM verification_rules WHERE key='default'; -- 1
SELECT count(*) FROM profiles WHERE "isVerified" = true AND "verificationStatus" = 'none'; -- 0
SELECT count(*) FROM drops;                            -- 0
SELECT count(*) FROM reward_ledger_entries;            -- 0
```

### Rollback (prefer forward-fix in prod)

Additive objects can be removed only if no product rows depend on them:

```sql
-- Only after confirming empty / non-dependent data:
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS milestone_awards;
DROP TABLE IF EXISTS milestone_rules;
DROP TABLE IF EXISTS verification_applications;
DROP TABLE IF EXISTS verification_rules;
DROP TABLE IF EXISTS reward_daily_usage;
DROP TABLE IF EXISTS coin_accounts;
DROP TABLE IF EXISTS reward_ledger_entries;
DROP TABLE IF EXISTS reward_rules;
DROP TABLE IF EXISTS hype_room_messages;
DROP TABLE IF EXISTS hype_room_members;
DROP TABLE IF EXISTS hype_rooms;
DROP TABLE IF EXISTS drop_claims;
DROP TABLE IF EXISTS drops;
DROP TABLE IF EXISTS feature_flags;
-- profiles column: keep (harmless) or:
-- ALTER TABLE profiles DROP COLUMN IF EXISTS "verificationStatus";
-- DROP INDEX IF EXISTS profiles_verification_status_idx;
-- Types may remain (inert) or be dropped if unused.
```

**Never** run rollback without backup checkpoint (spec §32).

---

## 6. Feature flags

### Registry (`shared/featureFlags.ts`)

| Key | Default | Parent dependency |
| --- | --- | --- |
| `discover_v2` | false | — |
| `jhilik_now` | false | — |
| `time_limited_communities` | false | — |
| `jhilik_drops` | false | — |
| `jhilik_rewards` | false | — |
| `video_rewards` | false | ⇒ `jhilik_rewards` |
| `milestone_rewards` | false | ⇒ `jhilik_rewards` |
| `free_verification` | false | — |

- `resolveFeatureFlags(overrides)` merges onto defaults then **forces child OFF if parent OFF**.
- No parallel `ENABLE_*` env toggles for these keys (spec §27).

### Runtime (`server/featureFlags.ts`)

- 30s in-memory cache; `setFeatureFlag` / `resetFeatureFlagCache` invalidates immediately.
- Fail closed: missing DB, missing table, query error → all defaults (false).
- Boot **never** awaits `feature_flags` (server starts pre-migration).
- Enabling a dependent child while parent is off → error (dependency gate).

### Admin set guard

- `admin.featureFlags.set` rejects unknown keys (zod enum) and parent-off enables.

---

## 7. State machines (`shared/stateMachines.ts`)

| Domain | Statuses | Transitions |
| --- | --- | --- |
| Hype room | scheduled, live, expired, archived | scheduled→live\|archived; live→expired; expired→archived |
| Drop | draft, scheduled, live, sold_out, ended, archived | per spec §19.2 |
| Reward entry | pending, approved, credited, rejected, reversed | pending→approved\|rejected\|credited; approved→credited\|rejected; credited→reversed |
| Verification application | pending, approved, rejected, withdrawn | pending→approved\|rejected\|withdrawn |
| Milestone award | eligible, pending, awarded, rejected | statuses exported for later phase |

Helpers: `canTransition`, `assertTransition`, `resolveHypeRoomStatus` (time-based lazy advance), `resolveDropStatus`. Authority remains **server-side**; clients may import types only.

---

## 8. Reward ledger (`server/rewardLedger.ts`)

| Function | Behavior |
| --- | --- |
| `creditRewardEntry` | Idempotent insert on `idempotencyKey`; optional immediate `credited` + `coin_accounts` bump in same tx |
| `finalizeRewardEntry` | pending→credited/rejected with balance side-effects |
| `reverseRewardEntry` | Compensating **negative** entry + mark original `reversed`; clamped balance (`GREATEST(0, …)`) |
| `getCoinBalance` | Prefer `coin_accounts`; fallback ledger sum of `credited` |
| `listRewardHistory` | User ledger page (limit ≤ 100) |
| `getDailyUsage` | Per (user, dayKey, action) counters |

**Invariants**

- Never `users.coins += n` (column does not exist / not used).
- Ledger is append-only source of truth; `coin_accounts` is cache updated in the **same transaction**.
- Amount must be non-zero integer (CHECK + code).
- Video-watch crediting intentionally **not** wired (Phase 7).

---

## 9. tRPC API (Phase 1 surface only)

| Router / procedure | Level | Flag | Notes |
| --- | --- | --- | --- |
| `features.active` | public | always | Full key→bool map; fail closed |
| `admin.featureFlags.list` | admin | — | Stable full key set even if no DB rows |
| `admin.featureFlags.set` | admin | — | Upsert; rate limited; dependency gate |
| `rewards.balance` | protected | `jhilik_rewards` | `PRECONDITION_FAILED` when flag off |
| `rewards.history` | protected | `jhilik_rewards` | Same gate |

**Not registered this phase** (per §21.1 — wait for real handlers): `discover`, `now`, `hypeRooms`, `drops`, `watchRewards`, `verificationFree`, `milestones`, `notifications`, `admin.hypeRooms`, `admin.drops`, `admin.rewards`, `admin.verificationFree`, `admin.milestones`.

Existing routers (`auth`, `profile`, `home`, `videos`, `community`, `sponsorBids`, `payments`, `admin` TimeWheels, `rawPulse`, `system`) unchanged except paid-verification dual-write.

### Rate limits (`server/_core/index.ts`)

| Path | Limit |
| --- | --- |
| `admin.featureFlags.set` | 20 / min (key `flag`) |
| existing global `/api/trpc` | 120 / min |

---

## 10. Paid verification dual-write

| Event | Writes |
| --- | --- |
| Migration backfill | `isVerified=true` → `verificationStatus='verified'` |
| `submitVerificationTransaction` | `verificationStatus='pending'` |
| approve success | `isVerified=true` + `verificationStatus` = `verified` (creator) or `business_verified` (company) |
| reject | `verificationStatus='pending'` → `'none'` (only if still pending) |
| `getVerificationStatus` | Returns `verificationStatus` alongside legacy `isVerified` |

`transactions` table and `payments.*` procedure signatures **unchanged** for clients. Free path will later write `verification_applications` without retiring paid flow (spec §8/§29).

---

## 11. Compatibility (flags off = today's behavior)

- All flags default false → product behavior identical to Phase 0 HEAD.
- `features.active` returns all false until rows are explicitly set true.
- Existing feed/videos/community/TimeWheels/paid-verify APIs unchanged.
- New columns/tables are additive; old rows remain valid.
- `shared/featureFlags.ts` exports are additive only.
- No frontend redesign; no new client feature UI this phase.

---

## 12. Tests / validation

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **Pass** (exit 0) |
| `git diff --check` | **Pass** (no whitespace errors) |
| `npx vitest run` | **Pass** — 35 passed, 2 skipped, **0 failed** |
| `git status --short` | Phase 0 + Phase 1 files only (see report) |

### Pre-existing test failure (fixed in Phase 1 review)

`server/mutationProcedures.test.ts` → *allows only an administrator to approve a pending verification payment*

- Expects `approveVerificationTransaction(91, adminId, "approved")` (3 args)
- At HEAD (before Phase 1), router already passed `input.accountType` (zod default `"creator"`) as 4th arg; `db.ts` already had `accountType = "creator"` parameter (introduced in `693c7f2`)
- Confirmed pre-existing: same failure after stashing all Phase 1 changes
- **Fix (minimal):** test expectation now includes `"creator"` — aligns test with current production contract; production verification behavior not changed for the test
- Re-run: `mutationProcedures.test.ts` → 10/10 pass; full suite → 0 failed

---

## 13. Risks & open decisions

| Risk / decision | Notes | Recommended |
| --- | --- | --- |
| Journal snapshots incomplete | **Pre-existing repo convention:** snapshots only for 0000–0001 & 0005–0018; journal at HEAD only listed 0000–0018 + 0029 (0019–0028 SQL files never journaled). Phase 1 only appends idx 20 → 0030, matching how 0029 was added. No snapshot generated (do not rewrite history). | Leave as-is; optional later `drizzle-kit generate` cleanup PR |
| `CREATE TYPE` not conditional | Matches existing migrations (bare `CREATE TYPE`); tables use `IF NOT EXISTS` | Run once after backup; re-run needs type-does-not-exist handling if partial failure |
| `db:push` vs raw SQL | Spec: push is primary on staging; SQL file is audit/rollback anchor | Review push diff before prod |
| Rewards UI when flag off | Procedures throw `PRECONDITION_FAILED` | Client should hide UI via `features.active` first |
| Flag audit trail | Only `updatedBy` + `updatedAt` (no history table) | Sufficient Phase 1; history table if compliance asks |
| Notification reads | Durable table created but `home.notifications` still derived | Wire `notifications.*` router when Phase that needs push ships |
| Free-verify apply API | Table+rule seed exist; no `verificationFree.*` router yet | Ship with `free_verification` flag phase |

---

## 14. Enablement order (after review/merge)

1. Backup checkpoint → apply `0030` on staging → run §5 verification queries.
2. Deploy this code (all flags still OFF = production unchanged).
3. QA Phase 1 infrastructure: `features.active`, admin flag list/set, `rewards.*` gated.
4. Later phases: implement product routers behind their flags in order  
   `discover_v2` → `jhilik_now` → `time_limited_communities` → `jhilik_drops` → `jhilik_rewards` → `video_rewards` → `free_verification` → `milestone_rewards`.

---

*Phase 1 implementation complete — awaiting user review before any commit or push.*

# KINBA pasted specification — Phase 1 implementation notes

## Source requirements translated

The supplied specification requires seven workstreams: strict user/video/transaction persistence; stable feed and notification endpoints; username/avatar profile setup; verified-only announcements and verification approval; HLS upload/transcoding with quality switching; manual bKash/Nagad verification payment submission; and end-to-end tests plus a main-branch release.

## Existing KINBA compatibility decisions

KINBA currently uses Drizzle ORM with PostgreSQL and integer identity keys, plus the existing Supabase authentication context. I will not replace working authentication with a new password/UUID system. The required entity fields will be mapped into the existing tables and conventions: profiles will own username, avatar URL, and verification state; videos will retain the current persisted quality-source model and gain/retain HLS-capable source metadata; transactions will be added as a normalized table with constrained payment method and status values.

The existing frontend already has a controlled Home shell, mobile drawer, feed tabs, quality-aware video cards, announcements, profile statistics, and theme/navigation state. The implementation will extend these real surfaces rather than create parallel mock screens or duplicate routes.

## Important production constraints

Feed and notification reads must return deterministic arrays on empty results and must not block on optional database data. Profile edits, payment submission, and verification approval require authenticated server procedures and database persistence. Announcement access must check the verified profile state on the server, not only in the client.

HLS transcoding requires FFmpeg availability and a background execution strategy. Before implementing that phase I will follow the repository/runtime guidance for persistent services and background work; if the current deploy target cannot run FFmpeg, the code must fail explicitly with a durable processing status rather than pretend transcoding completed.

Manual payments must never be auto-approved from client input. The approval operation will be protected and will update the transaction and profile verification state atomically when the approval actor has the required admin capability.

## Planned implementation order

1. Audit the current schema, routers, profile editor, upload path, and deployment/runtime capabilities.
2. Add/adjust entities and migrations for username/avatar, HLS/video source metadata, transactions, and processing state.
3. Stabilize feed/notification API contracts and add profile/payment/verification procedures.
4. Connect profile setup, Get Verified checkout, announcement access control, and HLS-aware player/upload UI.
5. Add focused regression tests, run formatting/check/build/tests, inspect the final diff, and push only after all required gates pass.

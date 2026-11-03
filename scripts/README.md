# Database scripts

This folder has accumulated many overlapping SQL files from different
points in the project's history. **Not all of them run against a real
environment.** Before adding a new `.sql` file here, read this first.

## The canonical path

`scripts/run-production-setup.mjs` is the single source of truth for the production
schema setup (`npm run db:setup:production`). Its `files` array defines the exact
execution order; its strict-migration list defines which failures stop deployment.
The list below highlights important stages and dependencies, but is not exhaustive.
Do not use it as a substitute for reading the runner when changing migration order.

1. `schema-compat-alignment.sql`
2. `complete-database-setup.sql`
3. `backend/migrations/0001_collections.sql` — shared profiles, Better Auth identity/session, Circles and Collections.
4. `backend/migrations/0009_collection_invitation_expiry.sql` — durable pending invitation expiry and status constraints.
5. `backend/migrations/0010_user_legal_acceptances.sql` — versioned Terms and Privacy acceptance, linked to Better Auth users.
6. `backend/migrations/0004_chains.sql` — canonical Chain, member and contribution tables.
7. `backend/migrations/0005_chain_collections.sql` — attach Chains to Collections.
8. `backend/migrations/0006_chain_lifecycle.sql` — remix lineage and immutable contribution revision history.
9. `premium-subscriptions-migration.sql` — Pro subscription ledger, Stripe identifiers/periods and auditable grant metadata.
10. `launch-schema-alignment.sql`
    - `creator-earnings-lifecycle.sql` — private USD-equivalent earnings ledger and source-idempotent atomic credits.
11. `loops-and-media.sql`
12. `moderation-schema.sql`
13. `moderation-integrity.sql`
14. `circles-schema-alignment.sql`
15. `enhanced-database-schema-part2.sql`
16. `enhanced-database-schema-part3.sql`
17. `wallet-and-events-schema.sql`
18. `achievements-system.sql`
19. `achievements-integrity.sql`
20. `premium-coin-purchase.sql`
21. `developer-features.sql`
22. `co-loop-sessions-schema.sql`
23. `co-loop-invitation-expiry.sql`
24. `co-loop-draft-schema.sql`
25. `co-loop-room-controls.sql`
26. `co-loop-chat-schema.sql`
27. `message-reactions-schema-fix.sql`
28. `dm-read-receipts-compat.sql`
29. `messages-edit-forward-schema.sql`
30. `circles-enhancements-schema.sql`
31. `fix-circle-event-participants.sql`
32. `circle-event-rsvp-lifecycle.sql`
33. `dev-quests-schema.sql`
34. `developer-hub-v2.sql`
35. `dev-collaborators-schema.sql`
36. `dev-repo-schema.sql`
37. `rls-policies.sql`
38. `realtime-functions.sql`
39. `coin-packs-refunds-schema.sql`
40. `fix-profiles-cosmetics-column.sql`
41. `private-profiles-schema.sql`
42. `user-blocks-schema.sql`
43. `trending-hashtags-function.sql`
44. `native-push-schema.sql`
45. `clutch-duel-ads-tags-schema.sql`
46. `awards-pro-circle-moments-schema.sql`
47. `events-moderation-schema.sql`
48. `custom-checkmarks-schema.sql`
49. `update-coin-packs.sql`
50. `open-co-loop-invites-schema.sql`
51. `curated-emojis-schema.sql`
52. `add-is-spoiler-column.sql`
53. `explore-reels-indexes.sql`
54. `community-chat-post-enhancements.sql`
55. `community-fixes-2026-09.sql`
56. `community-admin-settings-2026-09.sql`
57. `fix-duel-votes-type.sql`
58. `fix-poll-option-id-type.sql`
59. `fix-poll-votes-poll-id-type.sql`
60. `community-chat-schema.sql`
61. `community-post-enhancements.sql`

The security-sensitive migrations are strict: setup must fail rather than silently
skip verification, discovery preferences, account blocks, public-trending privacy,
moderation integrity, account appeals, Circle membership/ownership/event lifecycles,
Co-Loop lifecycle/expiry, core Collections/legal acceptance, Premium billing,
creator earnings, wallet/refund schema and purchases, and achievement integrity. In particular, `trending-hashtags-function.sql` is strict
because a missing or failed privacy filter must never leave public trend aggregation
on a permissive legacy definition. Collection expiry follows the Collection tables;
legal acceptance follows Better Auth's user/session tables. Circle membership lifecycle
runs after account suspension/deletion fields so joins, approvals, leave, kick and ban
share the same Circle row lock and canonical member count.

## Everything else in this folder

The remaining ~35 `.sql` files (`database-schema*.sql`,
`comprehensive-*.sql`, `enhanced-database-migration.sql`,
`co-loop-*.sql`, etc.) are **not** part of the automated pipeline. Some
predate it, some overlap with tables it already creates, and some were
one-off manual migrations. Treat anything not listed above as historical
reference, not a source of truth — if you need the tables/columns it
defines, verify what's actually live (`\d table_name` against the real
DB, or check `information_schema.columns`) and, if genuinely missing,
add an idempotent migration to the canonical list instead of running the
old file directly.

## One-off data-quality scripts (not schema, not in the pipeline)

`seed-user-realism.mjs`, `seed-engagement-realism.mjs`, and
`reconcile-profile-and-loop-stats.sql` were run once against the live
database to fix seed accounts that reused ~10 template sentences
verbatim across 20 profiles (duplicate bios, duplicate loop content,
sequential loop_coins), and to back their likes/comments/shares/branch
counts with real rows instead of decorative numbers (the same "no fake
engagement" principle applied elsewhere in the product). They're kept
here as a record of what changed, not as repeatable migrations — running
`seed-user-realism.mjs` again would just re-apply the same content
(harmless), but there's no reason to unless new template-duplicate seed
accounts show up. `reconcile-profile-and-loop-stats.sql` **is** safe and
useful to re-run any time counters drift, since it only recomputes from
real source-of-truth tables.

## Adding new schema

5. Prefer extending an existing canonical file (idempotent
   `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) over creating a new one.
6. If a new table is unavoidable, add it as a new idempotent `.sql` file
   and add it to the `files` array in `run-production-setup.mjs` in the
   same PR — a migration that isn't wired into the pipeline doesn't
   exist as far as any real environment is concerned.
7. Never seed fake/demo rows in a migration that's part of the canonical
   pipeline (see `developer-features.sql`'s history — it used to insert
   a canned sample project).

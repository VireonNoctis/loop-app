import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL

if (!databaseUrl) {
  console.error("DATABASE_URL or SUPABASE_DB_URL is required to run production setup SQL.")
  process.exit(1)
}

const files = [
  "scripts/schema-compat-alignment.sql",
  "scripts/complete-database-setup.sql",
  // Staff roles, scoped dashboard grants and access-change audit history.
  "scripts/admin-access-control-schema.sql",
  // Independent blue identity verification: request lifecycle, privacy and atomic review.
  // Kept separate from Premium entitlement grants.
  "scripts/verification-lifecycle.sql",
  // Viewer-owned Discover preferences for muted and explicitly preferred topics.
  "scripts/discovery-preferences.sql",
  // Rust API compatibility foundation: profiles/collections, then Chains,
  // Chain collection targets and contribution revision/remix lineage.
  "backend/migrations/0001_collections.sql",
  // Pending Collection invitations need durable expiry and status constraints.
  "backend/migrations/0009_collection_invitation_expiry.sql",
  // Explicit Terms and Privacy acceptance, keyed to Better Auth sessions/users.
  "backend/migrations/0010_user_legal_acceptances.sql",
  "backend/migrations/0004_chains.sql",
  "backend/migrations/0005_chain_collections.sql",
  "backend/migrations/0006_chain_lifecycle.sql",
  // Recurring LOOP Pro subscriptions and auditable billing grants.
  "scripts/premium-subscriptions-migration.sql",
  "scripts/launch-schema-alignment.sql",
  // Creator earnings columns, private ledger and atomic source-idempotent grants.
  "scripts/creator-earnings-lifecycle.sql",
  "scripts/loops-and-media.sql",
  "scripts/moderation-schema.sql",
  // Race-safe reports and transactional moderation actions.
  "scripts/moderation-integrity.sql",
  "scripts/circles-schema-alignment.sql",
  "scripts/enhanced-database-schema-part2.sql",
  "scripts/enhanced-database-schema-part3.sql",
  // Wallet ledger, coin gifts, and withdrawal request tables. Required for the
  // Stripe-backed coin economy (see /api/payments/webhook and /api/wallet/*).
  "scripts/wallet-and-events-schema.sql",
  "scripts/achievements-system.sql",
  "scripts/achievements-integrity.sql",
  // Install the Stripe transaction references and refund ledger before the
  // atomic Stripe/coin grant functions depend on those wallet columns.
  "scripts/coin-packs-refunds-schema.sql",
  // Atomic prepaid Pro and Stripe grants, idempotency and private wallet ledger access.
  "scripts/premium-coin-purchase.sql",
  // developer_projects and related tables backing the real Developers gallery
  // (see /api/developers/projects and components/developers/developers-content.tsx).
  "scripts/developer-features.sql",
  // Durable Co-Loop Studio session ownership + co-author roster (see
  // /api/co-loop/session-info and components/loops/co-loop-studio.tsx).
  "scripts/co-loop-sessions-schema.sql",
  "scripts/co-loop-invitation-expiry.sql",
  "scripts/co-loop-draft-schema.sql",
  "scripts/co-loop-room-controls.sql",
  "scripts/co-loop-chat-schema.sql",
  // DM reaction schema fix — see /api/messages/reactions.
  "scripts/message-reactions-schema-fix.sql",
  // DM read receipts (is_read / last_read_at) — see /api/messages/unread-count.
  "scripts/dm-read-receipts-compat.sql",
  // DM edit / delete / forward columns (edited_at, is_deleted, forwarded_*) —
  // see /api/messages/[messageId] and components/messages/messages-workspace.tsx.
  "scripts/messages-edit-forward-schema.sql",
  // Circle multi-media posts, polls, and per-member custom roles/permissions.
  "scripts/circles-enhancements-schema.sql",
  // Repair the Circle event RSVP participant FK/unique key before enabling RSVP
  // writes. This removes orphaned participant rows and recalculates attendee counts.
  "scripts/fix-circle-event-participants.sql",
  // Serialize RSVP capacity changes and enforce atomic attendee counts.
  "scripts/circle-event-rsvp-lifecycle.sql",
  // Dev Quests & bounties — coin-reward challenges in the Developer Hub
  // (see /api/developers/quests and components/developers/developer-quests.tsx).
  "scripts/dev-quests-schema.sql",
  // Developer Hub v2 — realtime for projects/comments/snippets, RLS deletes,
  // and project -> Marketplace listing link.
  "scripts/developer-hub-v2.sql",
  // project_collaborators — RLS policies, realtime, owner backfill + auto-add
  // trigger (see /api/developers/projects/[id]/collaborators).
  "scripts/dev-collaborators-schema.sql",
  // ZIP repo projects — file_tree / repo_zip_url / forked_from_id columns,
  // fork backfill, realtime + RLS (see lib/dev-project-zip.ts).
  "scripts/dev-repo-schema.sql",
  "scripts/rls-policies.sql",
  "scripts/realtime-functions.sql",
  // profiles.cosmetics column — fixes "profile_1.cosmetic does not exist"
  // that broke feed / For You branch queries (branched loops hidden).
  "scripts/fix-profiles-cosmetics-column.sql",
  // Private profiles: follow_requests table + realtime (see /api/users/follow-requests).
  "scripts/private-profiles-schema.sql",
  // Two-way account blocks are part of the profile/content privacy contract.
  "scripts/user-blocks-schema.sql",
  // Hashtag trends must only aggregate publicly visible Loops.
  "scripts/trending-hashtags-function.sql",
  // Native (Capacitor) FCM device tokens — see /api/push/native and lib/fcm.ts.
  "scripts/native-push-schema.sql",
  // Clutch Duel columns + clutch_duel_predictions, admin ad system (ads /
  // ad_settings / ad_impressions), circle post tags + threaded comment replies.
  "scripts/clutch-duel-ads-tags-schema.sql",
  // Awards (awards / user_awards), ephemeral Moments (moments table with
  // expiry), and the Pro-only circle (circles.is_premium_only + the
  // auto-membership trigger that adds/removes Pro users).
  "scripts/awards-pro-circle-moments-schema.sql",
  // Event stage moderation: ended_at/circle_id/allow_type on events, mutes
  // (all + per-user), event_rsvps, and soft-delete on event_messages.
  "scripts/events-moderation-schema.sql",
  // Admin-created custom checkmarks: verification_badges + profiles.badge_id.
  "scripts/custom-checkmarks-schema.sql",
  // Reduce coin pack bonuses and add mid/upper tiers.
  "scripts/update-coin-packs.sql",
  // Open Co-Loop Invite system: is_open_invite, max_collaborators,
  // open_invite_topic, feed_post_id on co_loop_sessions +
  // open_co_loop_participants table (see /api/co-loop/open-invite).
  "scripts/open-co-loop-invites-schema.sql",
  "scripts/co-loop-versions-schema.sql",

  "scripts/curated-emojis-schema.sql",
  // Spoiler media: is_spoiler column on loops (see SpoilerMedia component).
  "scripts/add-is-spoiler-column.sql",
  // Explore Reels grid: composite indexes for the explore sourcing queries.
  "scripts/explore-reels-indexes.sql",
  // Community chat + post enhancements: message_type, gifts, indexes.
  "scripts/community-chat-post-enhancements.sql",
  "scripts/community-fixes-2026-09.sql",
  // Community admin + settings: muted columns on circle_members, chat index.
  "scripts/community-admin-settings-2026-09.sql",
  // Fix duel votes type: loop_duel_votes.duel_id was UUID but loop_duels.id is BIGSERIAL.
  "scripts/fix-duel-votes-type.sql",
  // Fix poll option_id type: change from UUID to TEXT for string option IDs.
  "scripts/fix-poll-option-id-type.sql",
  // Fix poll votes poll_id: UUID → BIGINT for Snowflake IDs.
  "scripts/fix-poll-votes-poll-id-type.sql",
  // Community chat: add missing columns to messages table.
  "scripts/community-chat-schema.sql",
  // Account deletion/suspension fields and the private ban appeal lifecycle.
  "scripts/account-status-appeals-schema.sql",
  // Co-Loop lifecycle functions validate account status and depend on the
  // session, open-invite and version tables installed earlier in this runner.
  "scripts/co-loop-atomic-lifecycle.sql",
  // Circle membership functions require the account suspension/deletion columns.
  // Row-locked public/private joins and approvals enforce Circle capacity.
  "scripts/circle-membership-lifecycle.sql",
  // Canonical Circle ownership transfer and the owner member-role enum value.
  "scripts/circle-owner-transfer.sql",
  // Community post enhancements: view_count column.
  "scripts/community-post-enhancements.sql",
]

const ignorable = [
  /already exists/i,
  /duplicate key value/i,
  /multiple primary keys/i,
  /must be owner of/i,
  /policy .* already exists/i,
  /relation .* does not exist/i,
  /column .* does not exist/i,
  /is already a? ?member of publication/i,
  /type .* already exists/i,
  /constraint .* already exists/i,
  /trigger .* already exists/i,
  /cannot change name of type/i,
  /cannot alter type/i,
  /unsafe use of new value/i,
  /cannot change return type of existing function/i,
  /syntax error at or near \"RAISE\"/i,
]

function shouldIgnore(stderr) {
  return ignorable.some((re) => re.test(stderr))
}

function applyFile(file, { strict = false } = {}) {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) {
    console.error(`Missing SQL file: ${file}`)
    process.exit(1)
  }

  console.log(`\n=== Applying ${file} ===`)
  // Prefer full-file apply first (faster). On failure, retry statement-by-statement
  // so existing/divergent schemas can still receive the rest of the migration.
  const full = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", path], {
    encoding: "utf8",
  })

  if (full.status === 0) {
    if (full.stdout) process.stdout.write(full.stdout)
    if (full.stderr) process.stderr.write(full.stderr)
    console.log(`OK ${file}`)
    return { applied: 1, skipped: 0, failed: 0 }
  }

  console.warn(`Full apply failed for ${file}; retrying statement-by-statement...`)
  if (full.stderr) process.stderr.write(full.stderr)

  const sql = readFileSync(path, "utf8")
  // Split on statement-ending semicolons while keeping any PostgreSQL dollar-quoted block intact.
  const statements = []
  let buf = ""
  let dollarQuoteTag = null
  for (const line of sql.split(/\n/)) {
    let cursor = 0
    while (cursor < line.length) {
      if (dollarQuoteTag) {
        const closingIndex = line.indexOf(dollarQuoteTag, cursor)
        if (closingIndex < 0) break
        cursor = closingIndex + dollarQuoteTag.length
        dollarQuoteTag = null
        continue
      }

      const tagMatch = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g
      tagMatch.lastIndex = cursor
      const opening = tagMatch.exec(line)
      if (!opening) break
      dollarQuoteTag = opening[0]
      cursor = tagMatch.lastIndex
    }

    buf += line + "\n"
    if (!dollarQuoteTag && /;\s*$/.test(line)) {
      const stmt = buf.trim()
      if (stmt && !stmt.split("\n").every((l) => !l.trim() || l.trim().startsWith("--"))) {
        statements.push(stmt)
      }
      buf = ""
    }
  }
  if (buf.trim()) statements.push(buf.trim())

  let applied = 0
  let skipped = 0
  let failed = 0

  for (const statement of statements) {
    const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", statement], {
      encoding: "utf8",
    })
    if (result.status === 0) {
      applied += 1
      continue
    }
    const err = `${result.stderr || ""}\n${result.stdout || ""}`
    if (!strict && shouldIgnore(err)) {
      skipped += 1
      process.stderr.write(`skip: ${err.split("\n").find((l) => /ERROR:/i.test(l)) || "ignorable error"}\n`)
      continue
    }
    failed += 1
    process.stderr.write(`FAIL in ${file}:\n${err}\n`)
  }

  console.log(`Done ${file}: applied=${applied} skipped=${skipped} failed=${failed}`)
  if (failed > 0) process.exit(1)
  return { applied, skipped, failed }
}

for (const file of files) {
  // Verification owns private identity evidence and the admin review function;
  // never report setup success when any part of this security migration fails.
  applyFile(file, { strict: ["scripts/verification-lifecycle.sql", "scripts/discovery-preferences.sql", "scripts/wallet-and-events-schema.sql", "scripts/user-blocks-schema.sql", "scripts/trending-hashtags-function.sql", "scripts/moderation-integrity.sql", "scripts/account-status-appeals-schema.sql", "scripts/circle-membership-lifecycle.sql", "scripts/co-loop-atomic-lifecycle.sql", "scripts/co-loop-invitation-expiry.sql", "scripts/circle-owner-transfer.sql", "scripts/circle-event-rsvp-lifecycle.sql", "backend/migrations/0001_collections.sql", "backend/migrations/0009_collection_invitation_expiry.sql", "backend/migrations/0010_user_legal_acceptances.sql", "scripts/premium-subscriptions-migration.sql", "scripts/creator-earnings-lifecycle.sql", "scripts/coin-packs-refunds-schema.sql", "scripts/premium-coin-purchase.sql", "scripts/achievements-system.sql", "scripts/achievements-integrity.sql"].includes(file) })
}

if (process.argv.includes("--with-seed")) {
  const seedPath = resolve(process.cwd(), "scripts/seed-data-v2.sql")
  if (existsSync(seedPath)) {
    applyFile("scripts/seed-data-v2.sql")
  }
}

console.log("\nProduction database setup complete.")

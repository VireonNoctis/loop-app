// Applies pending idempotent schema/catalog files to Supabase using the pg
// driver (no psql dependency). Reads DATABASE_URL / SUPABASE_DB_URL from the
// environment. Statements are split and executed one at a time so statements
// like `ALTER TYPE ... ADD VALUE` (which cannot run inside a transaction
// block) commit individually.
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import pg from "pg"

const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL

if (!databaseUrl) {
  console.error("DATABASE_URL or SUPABASE_DB_URL is required to apply schema.")
  process.exit(1)
}

const DEFAULT_FILES = [
  // Enum categories used by the shop catalog (font / card_effect / …).
  "scripts/add-font-card-effect-categories.sql",
  // profiles.badge_id + verification_badges — fixes
  // "column profiles_1.badge_id does not exist" on feed/profile queries.
  "scripts/custom-checkmarks-schema.sql",
  // Animated cosmetics catalog (avatar frames / card effects).
  "scripts/animated-cosmetics-catalog.sql",
  // Full premium shop catalog — every item with unique render config.
  "scripts/premium-shop-catalog.sql",
  // Account status (suspended / deleted) + ban appeals + bot message columns.
  "scripts/account-status-appeals-schema.sql",
  // Official Welcome Bot + Moderation Bot marketplace listings.
  "scripts/community-bots-seed.sql",
  // Pro Circle workspace: channel polls + Pro Lounge daily check-in.
  "scripts/pro-circle-polls-checkins-schema.sql",
  // 100ms realtime calls: call_sessions + live_streams hms columns.
  "scripts/100ms-calls-schema.sql",
  // Inventory integrity repairs (orphaned/mismatched items).
  "scripts/user-inventory-integrity.sql",
  // Per-post link-preview toggle + owner-configurable branch limits.
  "scripts/loop-preview-and-branch-limits-schema.sql",
  // Admin tab integrity: audit tables, wallet/circle/notification columns,
  // and verification_requests (user-submitted, admin-reviewed).
  "scripts/admin-and-verification-integrity.sql",
  // profiles.has_seen_feature_tour — one-time on-feed coach-mark tour.
  "scripts/add-has-seen-feature-tour.sql",
  // sync_pro_circle_membership() declared its pro circle id as UUID while
  // circles.id is bigint, which made EVERY insert into profiles fail with
  // `invalid input syntax for type uuid: "6"` (no profiles for new signups,
  // onboarding step 1 always erroring).
  "scripts/fix-pro-circle-membership-trigger.sql",
  // circle_event_participants.event_id referenced its own table instead of
  // circle_events, and (event_id, user_id) had no unique constraint — so
  // every community event RSVP failed. Repairs the FK, adds the constraint
  // the route's ON CONFLICT needs, and resyncs attendee counts.
  "scripts/fix-circle-event-participants.sql",
  // Co-Loop version history is now stored server-side (was localStorage-only,
  // so the timeline vanished on refresh and co-authors never shared it).
  "scripts/co-loop-versions-schema.sql",
  // Draft text for a Co-Loop session, so a shared draft survives reloads.
  "scripts/co-loop-draft-schema.sql",
  // Per-session activity feed (who wrote what) + host lock/delete room controls.
  "scripts/co-loop-room-controls.sql",
  // Profile notes: 60-character line under your name, gone after 24 hours,
  // with per-note control over profile/posts/communities visibility.
  "scripts/profile-notes-schema.sql",
  // Note colour themes: the author's chosen bubble colour, constrained to the
  // list mirrored in lib/profile-note.ts.
  "scripts/profile-note-themes-schema.sql",
  // DM chat: reactions storage repairs + the participant SELECT policy that
  // lets Postgres Changes deliver a message to the other person's open thread.
  "scripts/messages-realtime-schema-fix.sql",
  "scripts/messages-chat-realtime-schema.sql",
  // Co-Loop Studio chat: durable room messages (with reactions) instead of a
  // broadcast-only feed that vanished on reload.
  "scripts/co-loop-chat-schema.sql",
  // Discussion-first community home: post_type, reply activity, and the
  // explicit community → Loop feed link. Community content stays
  // community-only unless a member opts it in.
  "scripts/community-discussions-schema.sql",
  // Community content moderation: hide / restore / lock discussions and
  // replies from the unified management panel.
  "scripts/community-moderation-schema.sql",
  // Quote rebranches: a top-level post that references the post it quotes
  // (`quoted_loop_id`) instead of copying its content.
  "scripts/quote-rebranch-schema.sql",
  // Discord-style community comments: emoji reactions on replies, stored on
  // the comment row so a thread load needs no extra query.
  "scripts/community-comment-reactions.sql",
  // LOOP Pro profile styling.
  "scripts/profile-custom-css-schema.sql",
]

// Allow a targeted run: node apply-pending-schema.mjs scripts/foo.sql …
const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES

/** Split a SQL file into top-level statements, honoring quotes + $$ blocks. */
function splitStatements(sql) {
  const statements = []
  let current = ""
  let inSingle = false
  let inDollar = false
  let dollarTag = null
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (inDollar) {
      if (dollarTag && sql.startsWith(dollarTag, i)) {
        current += dollarTag
        const len = dollarTag.length
        inDollar = false
        dollarTag = null
        i += len
        continue
      }
      current += ch
      i++
      continue
    }
    if (inSingle) {
      current += ch
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          current += "'"
          i += 2
          continue
        }
        inSingle = false
      }
      i++
      continue
    }
    if (ch === "-" && sql[i + 1] === "-") {
      // Skip -- line comments (they may contain semicolons)
      while (i < sql.length && sql[i] !== "\n") i++
      if (current.trim()) current += " "
      continue
    }
    if (ch === "'") {
      inSingle = true
      current += ch
      i++
      continue
    }
    if (ch === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/.exec(sql.slice(i))
      if (m) {
        dollarTag = m[0]
        inDollar = true
        current += dollarTag
        i += dollarTag.length
        continue
      }
    }
    if (ch === ";") {
      if (current.trim()) statements.push(current.trim())
      current = ""
      i++
      continue
    }
    current += ch
    i++
  }
  if (current.trim()) statements.push(current.trim())
  return statements
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()
  for (const file of files) {
    const path = resolve(process.cwd(), file)
    if (!existsSync(path)) {
      console.error(`Missing SQL file: ${file}`)
      continue
    }
    const sql = readFileSync(path, "utf8")
    const statements = splitStatements(sql)
    let applied = 0
    let failed = 0
    for (const stmt of statements) {
      try {
        await client.query(stmt)
        applied++
      } catch (err) {
        // Ignorable: object already exists / column already exists / enum
        // value already present — the catalog scripts are intentionally
        // idempotent and "already exists" is success.
        const msg = String(err?.message || "")
        if (/already exists|duplicate key|already a member|multiple primary keys/i.test(msg)) {
          applied++
          continue
        }
        failed++
        console.error(`  ⚠ statement failed: ${msg.slice(0, 200)}`)
      }
    }
    console.log(`${failed === 0 ? "OK " : "PARTIAL"} ${file} (${applied} statements${failed ? `, ${failed} failed` : ""})`)
  }
} finally {
  await client.end().catch(() => {})
}

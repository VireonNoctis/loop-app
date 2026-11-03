import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { canWriteCoLoopSession, checkCoLoopInvitationRevocation } from "@/lib/co-loop-session-access"

export const dynamic = "force-dynamic"

const MAX_ENTRIES_LISTED = 50
const MAX_SUMMARY = 240

const ACTIONS = [
  "edited",
  "version_saved",
  "version_restored",
  "published",
  "locked",
  "unlocked",
  "gifted",
  "invite_sent",
] as const

type ActivityAction = (typeof ACTIONS)[number]

/** A participant must be present in the persisted room roster. */
async function isParticipant(supabase: any, sessionId: string, userId: string) {
  const { data: session, error } = await supabase
    .from("co_loop_sessions")
    .select("owner_id, co_authors, deleted_at, status")
    .eq("session_id", sessionId)
    .maybeSingle()

  if (error || !session) return { ok: false, status: "missing" }
  if (session.deleted_at) return { ok: false, status: "deleted" }
  const revocation = await checkCoLoopInvitationRevocation(supabase, sessionId, userId)
  if (revocation.error || revocation.revoked) return { ok: false, status: "revoked" }
  if (session.owner_id === userId) return { ok: true, status: session, canWrite: canWriteCoLoopSession(session) }
  const inRoster = (Array.isArray(session.co_authors) ? session.co_authors : []).some((c: any) => c?.id === userId)
  if (inRoster) return { ok: true, status: session, canWrite: canWriteCoLoopSession(session) }

  const { data: openJoin } = await supabase
    .from("open_co_loop_participants")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle()

  return { ok: Boolean(openJoin), status: session, canWrite: canWriteCoLoopSession(session) }
}

/** GET – the room's timeline, newest first. */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("session_id") || searchParams.get("session")
    if (!sessionId) return NextResponse.json({ error: "session_id is required" }, { status: 400 })

    const supabase = createServerClient()
    const membership = await isParticipant(supabase, sessionId, user.id)
    if (!membership.ok) {
      return NextResponse.json(
        { error: membership.status === "deleted" ? "This room has been deleted" : "You are not in this room" },
        { status: membership.status === "deleted" ? 410 : membership.status === "missing" ? 404 : 403 },
      )
    }

    const { data, error } = await supabase
      .from("co_loop_activity")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(MAX_ENTRIES_LISTED)

    if (error) {
      // Table not migrated yet on an older deployment — degrade to empty.
      console.warn("co_loop_activity select failed:", error.message)
      return NextResponse.json({ success: true, entries: [], degraded: true })
    }

    return NextResponse.json({ success: true, entries: data || [] })
  } catch (error: any) {
    console.error("Co-Loop activity GET error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

/** POST – record one event in the room's timeline. */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createServerClient()
    const body = await request.json()

    const sessionId = body.session_id || body.sessionId
    const action = body.action as ActivityAction
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 })
    }
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Unknown activity action" }, { status: 400 })
    }

    const membership = await isParticipant(supabase, sessionId, user.id)
    if (!membership.ok) {
      return NextResponse.json(
        { error: membership.status === "deleted" ? "This room has been deleted" : "You are not in this room" },
        { status: membership.status === "deleted" ? 410 : membership.status === "missing" ? 404 : 403 }
      )
    }

    if (!membership.canWrite) {
      return NextResponse.json({ error: "This Co-Loop is no longer accepting activity" }, { status: 409 })
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("username, display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle()

    const summary =
      typeof body.summary === "string" ? body.summary.trim().slice(0, MAX_SUMMARY) : null

    const { data: inserted, error: insertError } = await supabase
      .from("co_loop_activity")
      .insert({
        session_id: sessionId,
        actor_id: user.id,
        actor_name: profile?.display_name || profile?.username || "Someone",
        action,
        summary: summary || null,
      })
      .select("*")
      .single()

    if (insertError) {
      console.error("co_loop_activity insert failed:", insertError)
      return NextResponse.json({ error: "Could not record that" }, { status: 500 })
    }

    return NextResponse.json({ success: true, entry: inserted })
  } catch (error: any) {
    console.error("Co-Loop activity POST error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

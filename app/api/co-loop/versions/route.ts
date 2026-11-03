import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCoLoopInvitationRevocation } from "@/lib/co-loop-session-access"

export const dynamic = "force-dynamic"

const MAX_CONTENT = 40_000
const MAX_VERSIONS_LISTED = 100

function normalizeHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, 20)
}

function normalizeMediaUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => {
      try {
        const url = new URL(candidate)
        return url.protocol === "https:" ? url.toString() : ""
      } catch {
        return ""
      }
    })
    .filter(Boolean)
    .slice(0, 4)
}

/** Confirm the caller owns or co-authors the session before letting them write history. */
async function getSessionAccess(supabase: any, sessionId: string, userId: string) {
  const { data: session, error } = await supabase
    .from("co_loop_sessions")
    .select("owner_id, co_authors, deleted_at, status")
    .eq("session_id", sessionId)
    .maybeSingle()
  if (error || !session || session.deleted_at) return { canRead: false, canWrite: false }
  const revocation = await checkCoLoopInvitationRevocation(supabase, sessionId, userId)
  if (revocation.error || revocation.revoked) return { canRead: false, canWrite: false }

  const inRoster = session.owner_id === userId || (Array.isArray(session.co_authors) ? session.co_authors : []).some((entry: any) => entry?.id === userId)
  let isOpenParticipant = false
  if (!inRoster) {
    const { data: openJoin, error: participantError } = await supabase
      .from("open_co_loop_participants")
      .select("id")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle()
    isOpenParticipant = !participantError && Boolean(openJoin)
  }
  const canRead = inRoster || isOpenParticipant
  return { canRead, canWrite: canRead && session.status === "active" }
}

/**
 * GET – list the shared, durable version timeline for a session.
 * Query: ?session_id=…  (the session UUID or the studio's text session id)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("session_id") || searchParams.get("session")
    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 })
    }

    const supabase = createServerClient()
    const access = await getSessionAccess(supabase, sessionId, user.id)
    if (!access.canRead) return NextResponse.json({ error: "You are not a participant in this Co-Loop" }, { status: 403 })
    const { data, error } = await supabase
      .from("co_loop_versions")
      .select("*")
      .eq("session_id", sessionId)
      .order("version_number", { ascending: false })
      .limit(MAX_VERSIONS_LISTED)

    if (error) {
      // The table may not be migrated yet on an older deployment — degrade to
      // an empty timeline rather than breaking the studio.
      console.warn("co_loop_versions select failed:", error.message)
      return NextResponse.json({ success: true, versions: [], degraded: true })
    }

    return NextResponse.json({ success: true, versions: data || [] })
  } catch (error: any) {
    console.error("Co-Loop versions GET error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

/** POST – snapshot the current draft into the session's shared timeline. */
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid snapshot payload" }, { status: 400 })
    }
    const sessionId = body.session_id || body.sessionId
    if (!sessionId || typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 160) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 })
    }

    const supabase = createServerClient()
    if (!(await getSessionAccess(supabase, sessionId, user.id)).canWrite) {
      return NextResponse.json({ error: "You are not a collaborator on this Co-Loop" }, { status: 403 })
    }

    const content = typeof body.content === "string" ? body.content.trimEnd() : ""
    const title = typeof body.title === "string" ? body.title.trim() : ""
    if (!content.trim() && !title.trim()) {
      return NextResponse.json({ error: "Nothing to snapshot yet" }, { status: 400 })
    }
    if (content.length > MAX_CONTENT || title.length > 300) {
      return NextResponse.json({ error: "Snapshot content is too large" }, { status: 400 })
    }

    const mediaUrls = normalizeMediaUrls(body.media_urls)
    const providedMediaUrl = typeof body.media_url === "string" && body.media_url.trim()
      ? normalizeMediaUrls([body.media_url])[0] || null
      : null
    if (typeof body.media_url === "string" && body.media_url.trim() && !providedMediaUrl) {
      return NextResponse.json({ error: "Media URLs must use HTTPS" }, { status: 400 })
    }
    const mediaType = ["text", "image", "video"].includes(body.media_type) ? body.media_type : "text"
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : null

    const { data: inserted, error: insertError } = await supabase.rpc("create_co_loop_version", {
      p_session_id: sessionId,
      p_actor_id: user.id,
      p_title: title,
      p_content: content,
      p_hashtags: normalizeHashtags(body.hashtags),
      p_media_url: providedMediaUrl || mediaUrls[0] || null,
      p_media_urls: mediaUrls,
      p_media_type: mediaType,
      p_label: label,
    })

    if (insertError) {
      console.error("Atomic Co-Loop version snapshot failed:", insertError.message)
      if (/co_loop_locked|co_loop_inactive/.test(insertError.message)) {
        return NextResponse.json({ error: "This room is locked or no longer accepting snapshots" }, { status: 409 })
      }
      if (/co_loop_participant_required/.test(insertError.message)) {
        return NextResponse.json({ error: "You are no longer a collaborator on this Co-Loop" }, { status: 403 })
      }
      if (/co_loop_unavailable/.test(insertError.message)) {
        return NextResponse.json({ error: "This Co-Loop is unavailable" }, { status: 404 })
      }
      return NextResponse.json({ error: "Could not save this snapshot" }, { status: 500 })
    }

    return NextResponse.json({ success: true, version: inserted })
  } catch (error) {
    console.error("Co-Loop versions POST error:", error)
    return NextResponse.json({ error: "Could not save this snapshot" }, { status: 500 })
  }
}

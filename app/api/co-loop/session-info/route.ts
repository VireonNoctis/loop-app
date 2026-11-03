import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import {
  checkCoLoopInvitationRevocation,
  decideCoLoopJoin,
  isCoLoopParticipant,
  canWriteCoLoopSession,
} from "@/lib/co-loop-session-access"

export const dynamic = "force-dynamic"

type CoAuthorEntry = {
  id: string
  username: string
  display_name: string
  avatar_url?: string | null
  role: "Co-Author"
}

function toCoAuthorEntry(profile: any): CoAuthorEntry {
  return {
    id: profile.id,
    username: profile.username,
    display_name: profile.display_name || profile.username,
    avatar_url: profile.avatar_url || null,
    role: "Co-Author",
  }
}

function mergeCoAuthors(existing: any[], addition: CoAuthorEntry) {
  const list = Array.isArray(existing) ? existing : []
  if (list.some((c) => c?.id === addition.id)) return list
  return [...list, addition]
}

export async function POST(request: NextRequest) {
  try {
    const callingUser = await getUserFromRequest(request)
    if (!callingUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createServerClient()

    const body = await request.json()
    const session_id = body.session_id || body.sessionId

    if (typeof session_id !== "string" || !session_id.trim() || session_id.length > 160) {
      return NextResponse.json({ error: "A valid session_id is required" }, { status: 400 })
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, video_avatar_url, bio, is_verified")
      .eq("id", callingUser.id)
      .maybeSingle()

    // Check existing session
    const { data: existingSession } = await supabase
      .from("co_loop_sessions")
      .select("*, owner:profiles!owner_id(id, username, display_name, avatar_url, video_avatar_url, bio, is_verified)")
      .eq("session_id", session_id)
      .maybeSingle()

    if (existingSession) {
      const revocation = await checkCoLoopInvitationRevocation(supabase, session_id, callingUser.id)
      if (revocation.error) {
        console.error("Could not verify Co-Loop revocation state:", revocation.error)
        return NextResponse.json({ error: "Could not verify room access" }, { status: 500 })
      }
      // A revocation overrides stale roster entries left behind by a partial moderation failure.
      const alreadyParticipant = !revocation.revoked && isCoLoopParticipant(existingSession, callingUser.id)
      let inviteExists = false
      if (!alreadyParticipant && !revocation.revoked) {
        const { data: invitation, error: invitationError } = await supabase
          .from("co_loop_invitations")
          .select("status")
          .eq("session_id", session_id)
          .eq("invitee_id", callingUser.id)
          .maybeSingle()
        if (invitationError) {
          console.error("Could not verify Co-Loop invitation ledger:", invitationError.message)
          return NextResponse.json({ error: "Could not verify this invitation" }, { status: 500 })
        }
        if (invitation) {
          // A pending invitation is not a join credential. The recipient
          // must explicitly accept it before entering the studio.
          inviteExists = invitation.status === "accepted"
        } else {
          // Legacy compatibility only when no ledger row exists. A declined
          // or revoked ledger record is a durable denial and cannot fall back.
          const { data: inviteNotification, error: notificationError } = await supabase
            .from("notifications")
            .select("id")
            .eq("user_id", callingUser.id)
            .eq("type", "co_loop_invite")
            .filter("data->>session_id", "eq", session_id)
            .limit(1)
            .maybeSingle()
          if (notificationError) {
            console.error("Legacy invitation lookup failed:", notificationError.message)
            return NextResponse.json({ error: "Could not verify this invitation" }, { status: 500 })
          }
          const { data: inviteMessage, error: messageError } = await supabase
            .from("messages")
            .select("id")
            .eq("recipient_id", callingUser.id)
            .eq("message_type", "co_loop_invite")
            .like("media_url", `%session=${encodeURIComponent(session_id)}%`)
            .limit(1)
            .maybeSingle()
          if (messageError) {
            console.error("Legacy invitation message lookup failed:", messageError.message)
            return NextResponse.json({ error: "Could not verify this invitation" }, { status: 500 })
          }
          inviteExists = Boolean(inviteNotification || inviteMessage)
        }
      }

      const decision = decideCoLoopJoin(existingSession, callingUser.id, inviteExists)
      if (decision !== "allowed") {
        const errors = {
          deleted: { status: 410, message: "This room has been deleted" },
          inactive: { status: 410, message: "This Co-Loop is no longer accepting collaborators" },
          locked: { status: 423, message: "The host has locked this room" },
          not_invited: { status: 403, message: "You need a direct invitation to join this Co-Loop" },
        } as const
        return NextResponse.json({ error: errors[decision].message, deleted: decision === "deleted" }, { status: errors[decision].status })
      }

      let coAuthors = Array.isArray(existingSession.co_authors) ? existingSession.co_authors : []
      if (!alreadyParticipant && callerProfile) {
        const nextCoAuthors = mergeCoAuthors(coAuthors, toCoAuthorEntry(callerProfile))
        if (nextCoAuthors.length !== coAuthors.length) {
          const { data: updated, error: rosterError } = await supabase
            .from("co_loop_sessions")
            .update({ co_authors: nextCoAuthors, updated_at: new Date().toISOString() })
            .eq("session_id", session_id)
            .eq("owner_id", existingSession.owner_id)
            .select("co_authors")
            .maybeSingle()
          if (rosterError || !updated) {
            console.error("Could not persist Co-Loop participant:", rosterError?.message)
            return NextResponse.json({ error: "Could not join this Co-Loop. Please try again." }, { status: 500 })
          }
          coAuthors = updated.co_authors || nextCoAuthors
        }
      }

      return NextResponse.json({
        success: true,
        session_id,
        owner_id: existingSession.owner_id,
        owner_username: existingSession.owner_username,
        inviter: existingSession.owner || { id: existingSession.owner_id, username: existingSession.owner_username },
        is_owner: existingSession.owner_id === callingUser.id,
        locked: Boolean(existingSession.locked),
        co_authors: coAuthors,
        draft: {
          title: existingSession.draft_title || "",
          content: existingSession.draft_content || "",
          updated_at: existingSession.draft_updated_at || null,
        },
      })
    }

    // Create session record setting caller as primary creator owner
    const ownerUsername = callerProfile?.username || callingUser.email?.split("@")[0] || "creator"
    const { data: newSession, error: insertError } = await supabase
      .from("co_loop_sessions")
      .insert({
        session_id,
        owner_id: callingUser.id,
        owner_username: ownerUsername,
        co_authors: [],
      })
      .select("*, owner:profiles!owner_id(id, username, display_name, avatar_url, video_avatar_url, bio, is_verified)")
      .single()

    if (insertError) {
      console.error("Error creating co_loop_session:", insertError.message)
      return NextResponse.json(
        { error: insertError.code === "23505" ? "This session was initialized elsewhere. Refresh and rejoin." : "Could not initialize this Co-Loop session." },
        { status: insertError.code === "23505" ? 409 : 500 },
      )
    }
    if (!newSession) {
      return NextResponse.json({ error: "Could not initialize this Co-Loop session." }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      session_id,
      owner_id: callingUser.id,
      owner_username: ownerUsername,
      inviter: callerProfile || newSession?.owner || { id: callingUser.id, username: ownerUsername },
      is_owner: true,
      locked: Boolean(newSession?.locked),
      co_authors: newSession?.co_authors || [],
      draft: {
        title: newSession?.draft_title || "",
        content: newSession?.draft_content || "",
        updated_at: newSession?.draft_updated_at || null,
      },
    })
  } catch (error: any) {
    console.error("Session info POST error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("session") || searchParams.get("id")
    if (!sessionId || !sessionId.trim() || sessionId.length > 160) {
      return NextResponse.json({ error: "A valid session ID is required" }, { status: 400 })
    }

    const supabase = createServerClient()
    const { data: session, error } = await supabase
      .from("co_loop_sessions")
      .select("session_id, owner_id, owner_username, deleted_at")
      .eq("session_id", sessionId)
      .maybeSingle()
    if (error) {
      console.error("Co-Loop preview lookup failed:", error.message)
      return NextResponse.json({ error: "Could not load this invitation" }, { status: 500 })
    }
    if (!session) return NextResponse.json({ error: "This invitation is unavailable" }, { status: 404 })
    if (session.deleted_at) return NextResponse.json({ error: "This room has been deleted" }, { status: 410 })

    const { data: inviter, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, is_verified")
      .eq("id", session.owner_id)
      .maybeSingle()
    if (profileError) {
      console.error("Co-Loop inviter lookup failed:", profileError.message)
      return NextResponse.json({ error: "Could not load the inviter" }, { status: 500 })
    }

    // Invitation preview only: never return the room roster, draft, chat or history.
    const safeInviter = inviter || {
      id: session.owner_id,
      username: session.owner_username,
      display_name: session.owner_username,
      avatar_url: null,
      is_verified: false,
    }
    return NextResponse.json({
      success: true,
      session_id: session.session_id,
      owner_id: session.owner_id,
      owner_username: session.owner_username,
      inviter: safeInviter,
    })
  } catch (error: any) {
    console.error("Co-Loop session preview error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const callingUser = await getUserFromRequest(request)
    if (!callingUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createServerClient()

    const body = await request.json()
const session_id = body.session_id || body.sessionId
    const status = body.status
    const published_loop_id = body.published_loop_id || body.publishedLoopId || null
    const hasDraft =
      typeof body.draft_title === "string" || typeof body.draft_content === "string"

    if (typeof session_id !== "string" || !session_id.trim() || session_id.length > 160) {
      return NextResponse.json({ error: "A valid session_id is required" }, { status: 400 })
    }
    if (status !== undefined && !["active", "published", "ended"].includes(status)) {
      return NextResponse.json({ error: "A valid status is required" }, { status: 400 })
    }
    if (!hasDraft && status === undefined && published_loop_id === null) {
      return NextResponse.json({ error: "No session changes were supplied" }, { status: 400 })
    }
    if (typeof body.draft_title === "string" && body.draft_title.length > 500) {
      return NextResponse.json({ error: "Draft titles cannot exceed 500 characters" }, { status: 400 })
    }
    if (typeof body.draft_content === "string" && body.draft_content.length > 40000) {
      return NextResponse.json({ error: "Draft content cannot exceed 40,000 characters" }, { status: 400 })
    }

    const { data: current, error: readError } = await supabase
      .from("co_loop_sessions")
      .select("owner_id, co_authors, locked, deleted_at, status")
      .eq("session_id", session_id)
      .maybeSingle()
    if (readError) {
      console.error("Co-Loop session access check failed:", readError.message)
      return NextResponse.json({ error: "Could not verify this room" }, { status: 500 })
    }
    if (!current) return NextResponse.json({ error: "This room does not exist" }, { status: 404 })
    if (current.deleted_at) return NextResponse.json({ error: "This room has been deleted" }, { status: 410 })
    if (!isCoLoopParticipant(current, callingUser.id)) {
      return NextResponse.json({ error: "You are not a participant in this room" }, { status: 403 })
    }
    if (!canWriteCoLoopSession(current)) {
      return NextResponse.json({ error: "This Co-Loop is no longer accepting changes" }, { status: 409 })
    }
    const isHost = current.owner_id === callingUser.id
    if (current.locked && !isHost) {
      return NextResponse.json({ error: "The host has locked this room" }, { status: 403 })
    }
    if ((status !== undefined || published_loop_id !== null) && !isHost) {
      return NextResponse.json({ error: "Only the host can change room status or publish it" }, { status: 403 })
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (status !== undefined) patch.status = status
    if (published_loop_id !== null) patch.published_loop_id = published_loop_id
    if (hasDraft) {
      // Autosave of the shared draft — durable so the room can rehydrate it.
      if (typeof body.draft_title === "string") patch.draft_title = body.draft_title.slice(0, 500)
      if (typeof body.draft_content === "string") patch.draft_content = body.draft_content.slice(0, 40_000)
      patch.draft_updated_at = new Date().toISOString()
    }

    let updateQuery = supabase
      .from("co_loop_sessions")
      .update(patch)
      .eq("session_id", session_id)
      .eq("owner_id", current.owner_id)
      .eq("status", "active")
      .is("deleted_at", null)

    // A non-host write must still target the same unlocked participant roster
    // that was authorized above. This prevents a stale request from racing a
    // lock, revocation or participant removal.
    if (!isHost) {
      updateQuery = updateQuery
        .eq("locked", false)
        .eq("co_authors", Array.isArray(current.co_authors) ? current.co_authors : [])
    }

    const { data: updatedSession, error } = await updateQuery
      .select("session_id")
      .maybeSingle()

    if (error) {
      console.error("Co-Loop conditional update failed:", error.message)
      // A missing draft column is a deployment problem, not a successful save.
      if (hasDraft && /draft_(title|content|updated_at)/i.test(error.message || "")) {
        return NextResponse.json({ error: "Draft saving is not available until the database migration is applied" }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not save this Co-Loop update" }, { status: 500 })
    }
    if (!updatedSession) {
      return NextResponse.json({ error: "This room changed while you were editing. Refresh before trying again." }, { status: 409 })
    }

    return NextResponse.json({ success: true, session_id, status, draft_persisted: hasDraft ? true : undefined })
  } catch (error: any) {
    console.error("Session info PATCH error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}


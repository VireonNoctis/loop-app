import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkBlockStatus } from "@/lib/user-blocks"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function mapInvitationError(error: { code?: string; message?: string }) {
  if (error.code === "P0002") {
    return NextResponse.json({ error: "Co-Loop or invitee was not found" }, { status: 404 })
  }
  if (error.code === "42501") {
    return NextResponse.json({ error: "You are not allowed to invite someone to this Co-Loop" }, { status: 403 })
  }
  if (error.code === "55000") {
    return NextResponse.json({ error: error.message || "This collaborator is already participating or invited" }, { status: 409 })
  }
  if (error.code === "23514") {
    return NextResponse.json({ error: "This Co-Loop has no collaborator slots available" }, { status: 409 })
  }
  if (error.code === "22023") {
    return NextResponse.json({ error: "The invitation details are invalid" }, { status: 400 })
  }
  if (["42883", "42P01", "42703"].includes(error.code || "")) {
    return NextResponse.json({ error: "Co-Loop invitations are unavailable until the database migration is applied." }, { status: 503 })
  }
  return NextResponse.json({ error: "Could not create this invitation" }, { status: 500 })
}

export async function POST(request: NextRequest) {
  try {
    const inviter = await getUserFromRequest(request)
    if (!inviter) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    let body: Record<string, unknown>
    try {
      const parsed = await request.json()
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid invitation payload" }, { status: 400 })
      }
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
    }

    const inviteeId = body.invitee_id
    const sessionId = body.session_id
    const sessionTitle = typeof body.session_title === "string" ? body.session_title.trim().slice(0, 120) : ""

    if (typeof inviteeId !== "string" || !UUID_PATTERN.test(inviteeId)
      || typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 160) {
      return NextResponse.json({ error: "A valid invitee_id and session_id are required" }, { status: 400 })
    }
    if (inviteeId === inviter.id) {
      return NextResponse.json({ error: "You cannot invite yourself" }, { status: 400 })
    }

    const supabase = createServerClient()
    const block = await checkBlockStatus(supabase, inviter.id, inviteeId)
    if (block.blocked) {
      return NextResponse.json({ error: "Invitations are unavailable for this user" }, { status: 403 })
    }

    // The row-locked RPC validates room access and reserves capacity before
    // notification or DM delivery. Pending invitations consume seats.
    const { data: reservationData, error: reservationError } = await supabase.rpc("create_co_loop_invitation", {
      p_session_id: sessionId,
      p_inviter_id: inviter.id,
      p_invitee_id: inviteeId,
    })
    if (reservationError) {
      console.error("Atomic Co-Loop invitation reservation failed:", reservationError.message)
      return mapInvitationError(reservationError)
    }

    const reservation = (Array.isArray(reservationData) ? reservationData[0] : reservationData) as {
      id?: string
      reserved_count?: number
      capacity?: number
      expires_at?: string
    } | null
    if (!reservation?.id) {
      console.error("Atomic Co-Loop invitation returned no reservation ID")
      return NextResponse.json({ error: "Could not create this invitation" }, { status: 500 })
    }

    const { data: inviterProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, video_avatar_url")
      .eq("id", inviter.id)
      .maybeSingle()
    if (profileError || !inviterProfile) {
      console.error("Co-Loop inviter profile lookup failed:", profileError?.message)
      await supabase.from("co_loop_invitations")
        .update({ status: "revoked", responded_at: new Date().toISOString() })
        .eq("id", reservation.id)
        .eq("status", "pending")
      return NextResponse.json({ error: "Could not prepare this invitation" }, { status: 500 })
    }

    const inviterName = inviterProfile.display_name || inviterProfile.username || "A collaborator"
    const titleText = sessionTitle ? `"${sessionTitle}"` : "a new Co-Loop"
    const inviterUsername = inviterProfile.username || ""
    const joinUrl = `/co-loop/join?session=${encodeURIComponent(sessionId)}&invitedBy=${encodeURIComponent(inviterUsername)}&invited=true`

    let notificationSent = false
    try {
      const { notifyUser } = await import("@/lib/notifications")
      const result = await notifyUser(supabase, {
        userId: inviteeId,
        type: "co_loop_invite",
        title: "Co-Loop Session Invitation",
        message: `${inviterName} invited you to collaborate on ${titleText}!`,
        actorId: inviter.id,
        actionUrl: joinUrl,
        data: {
          session_id: sessionId,
          invitation_id: reservation.id,
          invitation_expires_at: reservation.expires_at,
          inviter_id: inviter.id,
          inviter_name: inviterName,
          inviter_avatar: inviterProfile.avatar_url,
          action_url: joinUrl,
        },
        pushCategory: "circleInvites",
        priority: "high",
      })
      notificationSent = Boolean(result.notificationId)
    } catch (notifyError) {
      console.warn("Co-Loop invitation notification failed:", notifyError)
    }

    let conversationId: string | null = null
    const { data: myMemberships, error: myMembershipsError } = await supabase
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", inviter.id)
      .is("left_at", null)

    if (!myMembershipsError) {
      const myConversationIds = (myMemberships || []).map((membership: { conversation_id: string }) => membership.conversation_id)
      if (myConversationIds.length > 0) {
        const { data: shared, error: sharedError } = await supabase
          .from("conversation_participants")
          .select("conversation_id")
          .eq("user_id", inviteeId)
          .in("conversation_id", myConversationIds)
          .is("left_at", null)
          .limit(1)
          .maybeSingle()

        if (!sharedError && shared) conversationId = shared.conversation_id
      }
    } else {
      console.warn("Co-Loop DM lookup failed:", myMembershipsError.message)
    }

    if (!conversationId) {
      const { data: newConversation, error: conversationError } = await supabase
        .from("conversations")
        .insert({
          type: "direct",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single()

      if (!conversationError && newConversation?.id) {
        const { error: participantsError } = await supabase
          .from("conversation_participants")
          .insert([
            { conversation_id: newConversation.id, user_id: inviter.id, role: "owner" },
            { conversation_id: newConversation.id, user_id: inviteeId, role: "member" },
          ])
        if (!participantsError) conversationId = newConversation.id
      } else {
        console.warn("Could not create a Co-Loop invitation DM:", conversationError?.message)
      }
    }

    let messageSent = false
    if (conversationId) {
      const inviteMessage = [
        "**Co-Loop Collaboration Invitation**",
        `${inviterName} invited you to edit live on ${titleText}.`,
        "",
        `[Accept and join the session](${joinUrl})`,
        reservation.expires_at ? `This invitation expires ${new Date(reservation.expires_at).toLocaleString()}.` : "",
      ].filter(Boolean).join("\n")

      const { error: messageError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: inviter.id,
        author_id: inviter.id,
        recipient_id: inviteeId,
        content: inviteMessage,
        message_type: "co_loop_invite",
        media_url: joinUrl,
        created_at: new Date().toISOString(),
      })

      messageSent = !messageError
      if (messageError) {
        console.warn("Co-Loop invitation DM failed:", messageError.message)
      } else {
        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
      }
    }

    if (!notificationSent && !messageSent) {
      const { error: releaseError } = await supabase
        .from("co_loop_invitations")
        .update({ status: "revoked", responded_at: new Date().toISOString() })
        .eq("id", reservation.id)
        .eq("status", "pending")
      if (releaseError) {
        console.error("Undelivered Co-Loop invitation seat could not be released:", releaseError.message)
      }
      return NextResponse.json({ error: "Could not deliver the invitation; the reserved slot has been released where possible." }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      invitation_id: reservation.id,
      capacity: reservation.capacity,
      reserved_count: reservation.reserved_count,
      expires_at: reservation.expires_at,
      delivered_via: [notificationSent ? "notification" : null, messageSent ? "message" : null].filter(Boolean),
      message: "Invitation sent successfully.",
    })
  } catch (error) {
    console.error("Co-Loop invite error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

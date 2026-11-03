import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkBlockStatus } from "@/lib/user-blocks"

export const dynamic = "force-dynamic"


export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createServerClient()

    const [incomingRes, outgoingRes] = await Promise.all([
      supabase
        .from("follow_requests")
        .select(
          `*,
          requester:profiles!follow_requests_requester_id_fkey(id, username, display_name, avatar_url, video_avatar_url, is_verified, bio)
        `
        )
        .eq("target_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("follow_requests")
        .select(`id, target_id, status, created_at, target:profiles!follow_requests_target_id_fkey(id, username, display_name, avatar_url, video_avatar_url)`)
        .eq("requester_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ])

    if (incomingRes.error || outgoingRes.error) {
      console.error("Follow request list query failed:", incomingRes.error || outgoingRes.error)
      return NextResponse.json({ error: "Could not load follow requests" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      incoming: incomingRes.data || [],
      outgoing: outgoingRes.data || [],
    })
  } catch (error: any) {
    console.error("Follow requests error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

async function bumpProfileCount(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  field: "followers_count" | "following_count",
  delta: number,
) {
  const { data } = await supabase.from("profiles").select(field).eq("id", userId).maybeSingle()
  const current = Number((data as any)?.[field] || 0)
  await supabase
    .from("profiles")
    .update({ [field]: Math.max(0, current + delta), updated_at: new Date().toISOString() })
    .eq("id", userId)
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const requestId = body.request_id
    const action = body.action || "accept"
    const targetUserId = body.target_user_id

    if (!requestId && !(action === "cancel" && targetUserId)) {
      return NextResponse.json({ error: "request_id is required" }, { status: 400 })
    }

    const supabase = createServerClient()

    // Withdraw / cancel: requester removes their own pending request.
    if (action === "withdraw" || action === "cancel") {
      let query = supabase
        .from("follow_requests")
        .delete()
        .eq("requester_id", user.id)
        .eq("status", "pending")
      if (requestId) query = query.eq("id", requestId)
      if (targetUserId) query = query.eq("target_id", targetUserId)
      const { error: withdrawError } = await query
      if (withdrawError) {
        console.error("Follow request withdrawal failed:", withdrawError)
        return NextResponse.json({ error: "Could not withdraw follow request" }, { status: 500 })
      }
      return NextResponse.json({ success: true, action })
    }

    const { data: followRequest, error: findError } = await supabase
      .from("follow_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle()

    if (findError || !followRequest) {
      return NextResponse.json({ error: "Follow request not found" }, { status: 404 })
    }

    if (action === "accept") {
      if (followRequest.target_id !== user.id) {
        return NextResponse.json({ error: "You can only accept requests sent to you" }, { status: 403 })
      }
      if (followRequest.status !== "pending") {
        return NextResponse.json({ success: true, message: "Already handled" })
      }

      const blockStatus = await checkBlockStatus(
        supabase,
        followRequest.requester_id,
        followRequest.target_id,
      )
      if (blockStatus.blocked) {
        return NextResponse.json(
          { error: "This request cannot be accepted while either account blocks the other." },
          { status: 403 },
        )
      }

      const { data: existing } = await supabase
        .from("follows")
        .select("id")
        .eq("follower_id", followRequest.requester_id)
        .eq("following_id", followRequest.target_id)
        .maybeSingle()

      if (!existing) {
        const { error: followError } = await supabase.from("follows").insert({
          follower_id: followRequest.requester_id,
          following_id: followRequest.target_id,
          created_at: new Date().toISOString(),
        })
        if (followError && !/duplicate|unique/i.test(followError.message || "")) {
          return NextResponse.json({ error: followError.message }, { status: 500 })
        }
        if (!followError) {
          await Promise.all([
            bumpProfileCount(supabase, followRequest.target_id, "followers_count", 1),
            bumpProfileCount(supabase, followRequest.requester_id, "following_count", 1),
          ])
        }
      }

      const { error: approveError } = await supabase
        .from("follow_requests")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", requestId)
        .eq("target_id", user.id)
        .eq("status", "pending")

      if (approveError) {
        console.error("Approve follow request failed:", approveError)
        return NextResponse.json({ error: "Could not accept follow request" }, { status: 500 })
      }

      try {
        const { notifyUser } = await import("@/lib/notifications")
        const { data: actor } = await supabase
          .from("profiles")
          .select("username, display_name")
          .eq("id", user.id)
          .maybeSingle()
        await notifyUser(supabase, {
          userId: followRequest.requester_id,
          type: "follow",
          title: "Follow request accepted",
          message: `${actor?.display_name || actor?.username || "Your request"} accepted your follow request`,
          actorId: user.id,
          actionUrl: `/profile/${actor?.username || ""}`,
          data: { follower_id: user.id },
          pushCategory: "social",
        })
      } catch (notifyErr) {
        console.warn("Accept follow request notify failed:", notifyErr)
      }

      return NextResponse.json({ success: true, action: "accepted" })
    }

    if (action === "decline") {
      if (followRequest.target_id !== user.id) {
        return NextResponse.json({ error: "You can only decline requests sent to you" }, { status: 403 })
      }
      const { error: declineError } = await supabase
        .from("follow_requests")
        .update({ status: "declined", updated_at: new Date().toISOString() })
        .eq("id", requestId)
        .eq("target_id", user.id)
        .eq("status", "pending")
      if (declineError) {
        console.error("Decline follow request failed:", declineError)
        return NextResponse.json({ error: "Could not decline follow request" }, { status: 500 })
      }
      return NextResponse.json({ success: true, action: "declined" })
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 })
  } catch (error: any) {
    console.error("Follow request action error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

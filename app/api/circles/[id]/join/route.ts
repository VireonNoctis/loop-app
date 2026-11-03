import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { notifyUsers } from "@/lib/notifications";
import { getUserFromRequest } from "@/lib/server-auth";

const supabase = createServerClient()


export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Circle membership service is unavailable" }, { status: 503 })
    }
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: circleId } = await params
    const { data: circle, error: circleError } = await supabase
      .from("circles")
      .select("id, name, is_private, owner_id, creator_id")
      .eq("id", circleId)
      .maybeSingle()

    if (circleError) {
      console.error("Could not load Circle before join:", circleError)
      return NextResponse.json({ error: "Could not load Circle" }, { status: 500 })
    }
    if (!circle) return NextResponse.json({ error: "Circle not found" }, { status: 404 })

    // One row-locked database operation enforces account status, existing
    // membership, private approval and max_members consistently under load.
    const { data, error: joinError } = await supabase.rpc("join_circle", {
      p_circle_id: circleId,
      p_user_id: user.id,
    })

    if (joinError) {
      console.error("Atomic Circle join failed:", joinError)
      if (joinError.code === "P0002") return NextResponse.json({ error: "Circle or account not found" }, { status: 404 })
      if (joinError.code === "42501") {
        return NextResponse.json({ error: joinError.message || "This account cannot join the Circle" }, { status: 403 })
      }
      if (joinError.code === "22023") {
        return NextResponse.json({ error: joinError.message || "This Circle is full" }, { status: 409 })
      }
      if (["42883", "42P01", "42703"].includes(joinError.code || "")) {
        return NextResponse.json({ error: "Circle membership is unavailable until the database migration is applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Failed to update Circle membership" }, { status: 500 })
    }

    const result = (Array.isArray(data) ? data[0] : data) as {
      status?: string
      already_member?: boolean
      is_private?: boolean
    } | null

    if (!result || !["active", "pending"].includes(result.status || "")) {
      console.error("join_circle returned an unexpected result")
      return NextResponse.json({ error: "Circle membership returned an invalid result" }, { status: 500 })
    }

    if (result.already_member) {
      return NextResponse.json({
        success: true,
        status: result.status,
        message: result.status === "pending" ? "Join request is already pending" : "Already a member",
      })
    }

    if (result.status === "pending") {
      const { data: requesterProfile } = await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("id", user.id)
        .maybeSingle()
      const requesterName = requesterProfile?.display_name || requesterProfile?.username || "Someone"

      const { data: moderators } = await supabase
        .from("circle_members")
        .select("user_id")
        .eq("circle_id", circleId)
        .eq("status", "active")
        .in("role", ["owner", "admin", "moderator"])

      const recipients = new Set<string>([circle.owner_id, circle.creator_id].filter(Boolean) as string[])
      for (const moderator of moderators || []) recipients.add(moderator.user_id)
      recipients.delete(user.id)

      await notifyUsers(supabase, Array.from(recipients), {
        type: "circle_join_request",
        title: "New join request",
        message: `${requesterName} wants to join ${circle.name}`,
        actionUrl: `/circles/${circleId}/admin`,
        actorId: user.id,
        pushCategory: "circleInvites",
        data: { circleId },
      })
      return NextResponse.json({
        success: true,
        message: "Join request sent to moderators",
        status: "pending",
      }, { status: 202 })
    }

    // Post-commit effects are idempotent/best-effort; membership is already
    // committed and the canonical member count was updated by the DB function.
    try {
      const { data: defaultRole } = await supabase
        .from("community_roles")
        .select("id")
        .eq("circle_id", circleId)
        .eq("is_default", true)
        .maybeSingle()
      if (defaultRole?.id) {
        await supabase
          .from("community_member_roles")
          .upsert(
            { circle_id: circleId, user_id: user.id, role_id: defaultRole.id },
            { onConflict: "user_id,role_id" },
          )
      }
    } catch (error) {
      console.error("Default Circle power grant failed:", error)
    }

    try {
      const { runWelcomeBot } = await import("@/lib/circle-bots")
      await runWelcomeBot(supabase, circleId, user.id)
    } catch (error) {
      console.error("Circle welcome bot failed:", error)
    }

    try {
      const { trackQuestAction } = await import("@/lib/quest-tracker")
      await trackQuestAction(supabase, user.id, "join_circle")
    } catch (error) {
      console.error("Circle join quest tracking failed:", error)
    }

    return NextResponse.json({
      success: true,
      message: "Successfully joined Circle",
      status: "active",
    })
  } catch (error) {
    console.error("Error joining Circle:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Circle membership service is unavailable" }, { status: 503 })
    }
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: circleId } = await params
    const { data, error } = await supabase.rpc("manage_circle_member", {
      p_circle_id: circleId,
      p_actor_id: user.id,
      p_target_user_id: user.id,
      p_action: "leave",
    })

    if (error) {
      console.error("Atomic Circle leave failed:", error)
      if (error.code === "42501") return NextResponse.json({ error: error.message || "This account cannot leave the Circle" }, { status: 403 })
      if (error.code === "P0002") return NextResponse.json({ error: "Circle membership not found" }, { status: 404 })
      if (error.code === "55000") return NextResponse.json({ error: error.message || "This membership can no longer be withdrawn" }, { status: 409 })
      if (error.code === "22023") return NextResponse.json({ error: error.message || "Transfer ownership before leaving" }, { status: 409 })
      if (["42883", "42P01", "42703"].includes(error.code || "")) {
        return NextResponse.json({ error: "Atomic Circle leave is unavailable until the database migration is applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not update Circle membership" }, { status: 500 })
    }

    const result = (Array.isArray(data) ? data[0] : data) as {
      circle_id?: string
      user_id?: string
      status?: string
      member_count?: number
    } | null
    if (result?.circle_id !== circleId || result.user_id !== user.id || !["left", "cancelled"].includes(result.status || "")) {
      return NextResponse.json({ error: "Circle leave returned an invalid result" }, { status: 500 })
    }

    try {
      await supabase.channel(`circle-admin:${circleId}`).send({
        type: "broadcast",
        event: "admin_refresh",
        payload: { action: "leave", userId: user.id },
      })
    } catch {
      /* realtime refresh is best-effort; the database result is canonical */
    }

    const wasMember = result.status === "left"
    return NextResponse.json({
      success: true,
      status: result.status,
      member_count: result.member_count,
      message: wasMember ? "Successfully left Circle" : "Join request cancelled",
    })
  } catch (error) {
    console.error("Error updating Circle membership:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

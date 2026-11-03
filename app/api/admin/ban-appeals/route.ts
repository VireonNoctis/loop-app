import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { requireModerator } from "@/lib/server-auth"
import { parseBanAppealReview } from "@/lib/ban-appeals"

export const dynamic = "force-dynamic"

function boundedInteger(value: string | null, fallback: number, maximum: number) {
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null
}

export async function GET(request: NextRequest) {
  const { response } = await requireModerator(request)
  if (response) return response

  const params = request.nextUrl.searchParams
  const status = params.get("status") || "pending"
  if (!["pending", "approved", "denied", "all"].includes(status)) {
    return NextResponse.json({ error: "Choose a valid appeal status" }, { status: 400 })
  }

  const limit = boundedInteger(params.get("limit"), 50, 100)
  const offset = boundedInteger(params.get("offset"), 0, 1_000_000)
  if (limit === null || limit < 1 || offset === null) {
    return NextResponse.json({ error: "Invalid appeal pagination" }, { status: 400 })
  }

  try {
    const supabase = createServerClient()
    let query = supabase
      .from("ban_appeals")
      .select("*, user:profiles!user_id(id, username, display_name, avatar_url, email, is_banned, ban_reason, is_deleted, created_at)")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
    if (status !== "all") query = query.eq("status", status)

    const { data: appeals, error } = await query
    if (error) {
      console.error("Could not load ban appeals:", error)
      return NextResponse.json({ error: "Could not load appeals" }, { status: 500 })
    }
    return NextResponse.json({ success: true, appeals: appeals || [], hasMore: appeals?.length === limit })
  } catch (error) {
    console.error("Ban appeals queue error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireModerator(request)
  if (response) return response
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
  }

  const parsed = parseBanAppealReview(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const supabase = createServerClient()
    const { data, error } = await supabase.rpc("review_ban_appeal", {
      p_appeal_id: parsed.value.appealId,
      p_reviewer_id: user.id,
      p_decision: parsed.value.decision,
      p_admin_notes: parsed.value.adminNotes,
    })

    if (error) {
      console.error("Atomic ban appeal review failed:", error)
      if (error.code === "42501") return NextResponse.json({ error: "Moderator access required" }, { status: 403 })
      if (error.code === "P0002") return NextResponse.json({ error: "Appeal or account not found" }, { status: 404 })
      if (error.code === "55000") return NextResponse.json({ error: "This appeal has already been reviewed" }, { status: 409 })
      if (["22023", "23503"].includes(error.code || "")) return NextResponse.json({ error: error.message }, { status: 400 })
      if (["42883", "42P01", "42703"].includes(error.code || "")) {
        return NextResponse.json({ error: "Appeal review is unavailable until the database migration is applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not complete appeal review" }, { status: 500 })
    }

    const appeal = (Array.isArray(data) ? data[0] : data) as { id?: string; user_id?: string } | null
    if (!appeal?.id || !appeal.user_id) {
      console.error("Ban appeal review RPC returned an unexpected result")
      return NextResponse.json({ error: "Appeal review returned an invalid result" }, { status: 500 })
    }

    const approved = parsed.value.decision === "approve"
    const { error: notificationError } = await supabase.from("notifications").insert({
      user_id: appeal.user_id,
      type: "system",
      title: approved ? "Appeal approved" : "Appeal denied",
      message: approved
        ? "Your suspension has been lifted. You can sign in and use Loop again."
        : parsed.value.adminNotes,
      data: { appeal_id: appeal.id },
    })
    if (notificationError) console.error("Appeal decision notification failed:", notificationError)

    return NextResponse.json({
      success: true,
      status: approved ? "approved" : "denied",
      appeal,
    })
  } catch (error) {
    console.error("Ban appeal review error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

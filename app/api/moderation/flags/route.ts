import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { requireModerator, getUserFromRequest } from "@/lib/server-auth"
import { parseContentFlagSubmission } from "@/lib/moderation-flags"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
  }

  const parsed = parseContentFlagSubmission(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { contentType, contentId, flagType, description } = parsed.value

  if (contentType === "profile" && contentId === user.id) {
    return NextResponse.json({ error: "You cannot report your own profile" }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: existing, error: duplicateError } = await supabase
    .from("content_flags")
    .select("id")
    .eq("reporter_id", user.id)
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle()

  if (duplicateError) {
    console.error("Could not check duplicate report:", duplicateError)
    return NextResponse.json({ error: "Could not submit this report right now" }, { status: 500 })
  }
  if (existing) {
    return NextResponse.json({ error: "You already have a pending report for this content" }, { status: 409 })
  }

  const { data: flag, error: insertError } = await supabase
    .from("content_flags")
    .insert({
      content_type: contentType,
      content_id: contentId,
      reporter_id: user.id,
      flag_type: flagType,
      description,
      status: "pending",
    })
    .select()
    .single()

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "You already have a pending report for this content" }, { status: 409 })
    }
    console.error("Report insert error:", insertError)
    return NextResponse.json({ error: "Failed to submit report" }, { status: 500 })
  }

  // Receipt for the reporter; moderators receive live queue updates from content_flags.
  const { error: notificationError } = await supabase.from("notifications").insert({
    user_id: user.id,
    type: "report_received",
    title: "Report received",
    message: "Your report has been received for review.",
    data: { report_id: flag.id, content_type: contentType },
    is_read: false,
  })
  if (notificationError) console.error("Report receipt notification failed:", notificationError)

  return NextResponse.json({ success: true, flag }, { status: 201 })
}

export async function GET(request: NextRequest) {
  const { response } = await requireModerator(request)
  if (response) return response

  const params = request.nextUrl.searchParams
  const status = params.get("status") || "pending"
  if (!["pending", "reviewed", "resolved", "dismissed", "all"].includes(status)) {
    return NextResponse.json({ error: "Choose a valid report status" }, { status: 400 })
  }

  const boundedInt = (value: string | null, fallback: number, max: number) => {
    if (value === null) return fallback
    if (!/^\d+$/.test(value)) return null
    const number = Number(value)
    return Number.isSafeInteger(number) && number <= max ? number : null
  }
  const limit = boundedInt(params.get("limit"), 50, 100)
  const offset = boundedInt(params.get("offset"), 0, 1_000_000)
  if (limit === null || limit < 1 || offset === null) {
    return NextResponse.json({ error: "Invalid report pagination" }, { status: 400 })
  }

  try {
    const supabase = createServerClient()
    let query = supabase
      .from("content_flags")
      .select("*, reporter:profiles!reporter_id(id, username, display_name, avatar_url)")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)
    if (status !== "all") query = query.eq("status", status)

    const { data: flags, error } = await query
    if (error) {
      console.error("Could not load moderation queue:", error)
      return NextResponse.json({ error: "Could not load moderation queue" }, { status: 500 })
    }
    return NextResponse.json({ success: true, flags: flags || [], hasMore: flags?.length === limit })
  } catch (error) {
    console.error("Moderation queue error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

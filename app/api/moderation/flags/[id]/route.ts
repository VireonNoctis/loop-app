import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { requireModerator } from "@/lib/server-auth"
import { isUuid, parseContentFlagReview } from "@/lib/moderation-flags"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ id: string }> }

async function reviewFlag(request: NextRequest, params: Promise<{ id: string }>) {
  const { user, response } = await requireModerator(request)
  if (response) return response
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid report ID" }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: existing, error: lookupError } = await supabase
    .from("content_flags")
    .select("id, content_type, content_id, status")
    .eq("id", id)
    .maybeSingle()

  if (lookupError) {
    console.error("Could not load moderation report:", lookupError)
    return NextResponse.json({ error: "Could not load moderation report" }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: "Moderation report not found" }, { status: 404 })
  if (existing.status !== "pending") return NextResponse.json({ error: "This report has already been reviewed" }, { status: 409 })

  const parsed = parseContentFlagReview(body, existing.content_type)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data, error } = await supabase.rpc("review_content_flag", {
    p_flag_id: id,
    p_moderator_id: user.id,
    p_status: parsed.value.status,
    p_action_taken: parsed.value.actionTaken,
    p_moderator_notes: parsed.value.moderatorNotes,
  })

  if (error) {
    console.error("Atomic moderation review failed:", error)
    if (error.code === "42501") return NextResponse.json({ error: "Moderator access required for this action" }, { status: 403 })
    if (error.code === "P0002") return NextResponse.json({ error: "Moderation report or target profile not found" }, { status: 404 })
    if (error.code === "55000") return NextResponse.json({ error: "This report has already been reviewed" }, { status: 409 })
    if (["22023", "23503"].includes(error.code || "")) return NextResponse.json({ error: error.message }, { status: 400 })
    if (["42883", "42P01", "42703"].includes(error.code || "")) {
      return NextResponse.json({ error: "Moderation review is unavailable until the database migration is applied." }, { status: 503 })
    }
    return NextResponse.json({ error: "Could not complete moderation review" }, { status: 500 })
  }

  return NextResponse.json({ success: true, flag: data })
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  return reviewFlag(request, params)
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  return reviewFlag(request, params)
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { response } = await requireModerator(request)
  if (response) return response

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid report ID" }, { status: 400 })

  const supabase = createServerClient()
  const { data: flag, error } = await supabase
    .from("content_flags")
    .select("*, reporter:profiles!reporter_id(id, username, display_name, avatar_url)")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    console.error("Could not load moderation report:", error)
    return NextResponse.json({ error: "Could not load moderation report" }, { status: 500 })
  }
  if (!flag) return NextResponse.json({ error: "Moderation report not found" }, { status: 404 })

  return NextResponse.json({ success: true, flag })
}

import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { requireUser } from "@/lib/server-auth"
import { parseBanAppealSubmission } from "@/lib/ban-appeals"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser(request)
  if (response) return response
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createServerClient()
  const { data: appeal, error } = await supabase
    .from("ban_appeals")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("Could not load ban appeal status:", error)
    return NextResponse.json({ error: "Could not load appeal status" }, { status: 500 })
  }
  return NextResponse.json({ success: true, appeal: appeal || null })
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request)
  if (response) return response
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
  }
  const parsed = parseBanAppealSubmission(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const supabase = createServerClient()
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("is_banned, is_deleted")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      console.error("Could not load account status for appeal:", profileError)
      return NextResponse.json({ error: "Could not verify account status" }, { status: 500 })
    }
    if (profile?.is_deleted) return NextResponse.json({ error: "Deleted accounts cannot appeal" }, { status: 400 })
    if (!profile?.is_banned) return NextResponse.json({ error: "Your account is not suspended" }, { status: 400 })

    const { data: pending, error: pendingError } = await supabase
      .from("ban_appeals")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle()

    if (pendingError) {
      console.error("Could not check pending appeals:", pendingError)
      return NextResponse.json({ error: "Could not check your existing appeal" }, { status: 500 })
    }
    if (pending) return NextResponse.json({ error: "You already have a pending appeal" }, { status: 409 })

    const { data: appeal, error } = await supabase
      .from("ban_appeals")
      .insert({
        user_id: user.id,
        reason: parsed.value.reason,
        status: "pending",
      })
      .select("*")
      .single()

    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "You already have a pending appeal" }, { status: 409 })
      console.error("Could not submit ban appeal:", error)
      return NextResponse.json({ error: "Could not submit your appeal" }, { status: 500 })
    }
    return NextResponse.json({ success: true, appeal }, { status: 201 })
  } catch (error) {
    console.error("Ban appeal submission error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

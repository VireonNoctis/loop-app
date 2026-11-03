import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest, requireAdmin } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const VALID_CATEGORIES = ["technical", "billing", "account", "content", "suggestion", "privacy", "other"]
const VALID_PRIORITIES = ["low", "medium", "high"]
const VALID_STATUSES = ["open", "in_progress", "resolved", "closed"]

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createServerClient()

    // Admins see all tickets; regular users see only their own.
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin, is_moderator")
      .eq("id", user.id)
      .maybeSingle()

    const isStaff = Boolean(profile?.is_admin || profile?.is_moderator)

    let query = supabase
      .from("support_tickets")
      .select(`
        *,
        user:profiles!user_id(id, username, display_name, avatar_url, video_avatar_url),
        last_message:support_messages(id, message, is_from_support, created_at)
      `)
      .order("updated_at", { ascending: false })
      .limit(200)

    if (!isStaff) {
      query = query.eq("user_id", user.id)
    }

    const { data: tickets, error } = await query

    if (error) {
      // Fallback without the nested last_message if relationship not indexed
      const fallback = await supabase
        .from("support_tickets")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(200)
      if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 })
      return NextResponse.json({ tickets: fallback.data || [] })
    }

    // Attach a last-message preview
    const withPreview = await Promise.all(
      (tickets || []).map(async (ticket: any) => {
        const last = Array.isArray(ticket.last_message) ? ticket.last_message[0] : ticket.last_message
        if (last) return { ...ticket, last_message: last }
        const { data: msg } = await supabase
          .from("support_messages")
          .select("id, message, is_from_support, created_at")
          .eq("ticket_id", ticket.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        return { ...ticket, last_message: msg || null }
      }),
    )

    return NextResponse.json({ tickets: withPreview })
  } catch (error) {
    console.error("Support tickets GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const subject = String(body.subject || "").trim()
    const message = String(body.message || "").trim()
    const category = VALID_CATEGORIES.includes(body.category) ? body.category : "technical"
    const priority = VALID_PRIORITIES.includes(body.priority) ? body.priority : "medium"

    if (!subject || !message) {
      return NextResponse.json({ error: "Subject and message are required" }, { status: 400 })
    }

    const supabase = createServerClient()

    const { data: ticket, error } = await supabase
      .from("support_tickets")
      .insert({
        user_id: user.id,
        subject: subject.slice(0, 140),
        category,
        priority,
        status: "open",
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: supportMsg, error: msgError } = await supabase
      .from("support_messages")
      .insert({
        ticket_id: ticket.id,
        sender_id: user.id,
        message,
        is_from_support: false,
      })
      .select()
      .single()

    if (msgError) return NextResponse.json({ error: msgError.message }, { status: 500 })

    return NextResponse.json({ success: true, ticket, message: supportMsg })
  } catch (error) {
    console.error("Support ticket POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createServerClient()
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin, is_moderator")
      .eq("id", user.id)
      .maybeSingle()

    const isStaff = Boolean(profile?.is_admin || profile?.is_moderator)
    if (!isStaff) {
      return NextResponse.json({ error: "Staff access required" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const { ticketId, status } = body

    if (!ticketId || !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "ticketId and a valid status are required" }, { status: 400 })
    }

    const { data: ticket, error } = await supabase
      .from("support_tickets")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", ticketId)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, ticket })
  } catch (error) {
    console.error("Support ticket PATCH error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

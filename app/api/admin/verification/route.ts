import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { requireAdmin } from "@/lib/server-auth"
import { parseVerificationReview } from "@/lib/verification-review"

export async function GET(request: NextRequest) {
  const { response } = await requireAdmin(request)
  if (response) return response

  try {
    const supabase = createServerClient()
    const { data: requests, error } = await supabase
      .from("verification_requests")
      .select("*, user:profiles!verification_requests_user_id_fkey(id, username, display_name, avatar_url, is_verified)")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Failed to load verification review queue:", error)
      return NextResponse.json({ error: "Could not load verification requests" }, { status: 500 })
    }

    return NextResponse.json({ requests: requests || [] })
  } catch (error) {
    console.error("Error fetching verification requests:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireAdmin(request)
  if (response) return response
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
  }

  const parsed = parseVerificationReview(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  try {
    const supabase = createServerClient()
    const { data, error } = await supabase.rpc("review_verification_request", {
      p_request_id: parsed.value.requestId,
      p_reviewer_id: user.id,
      p_action: parsed.value.action,
      p_admin_notes: parsed.value.adminNotes,
    })

    if (error) {
      console.error("Atomic verification review failed:", error)
      if (error.code === "42501") {
        return NextResponse.json({ error: "Administrator access required" }, { status: 403 })
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Verification request not found" }, { status: 404 })
      }
      if (error.code === "55000") {
        return NextResponse.json({ error: "This verification request has already been reviewed" }, { status: 409 })
      }
      if (["22023", "23503"].includes(error.code || "")) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (["42883", "42P01", "42703"].includes(error.code || "")) {
        return NextResponse.json(
          { error: "Verification review is unavailable until the database migration is applied." },
          { status: 503 },
        )
      }
      return NextResponse.json({ error: "Could not complete the verification review" }, { status: 500 })
    }

    const reviewed = (Array.isArray(data) ? data[0] : data) as Record<string, any> | null
    if (!reviewed?.id || !reviewed?.user_id) {
      console.error("Atomic verification review returned an unexpected result")
      return NextResponse.json({ error: "Verification review returned an invalid result" }, { status: 500 })
    }

    // Notifications are best-effort after the state transaction commits.
    const approved = parsed.value.action === "approved"
    const { error: notificationError } = await supabase.from("notifications").insert({
      user_id: reviewed.user_id,
      type: approved ? "verification_approved" : "verification_rejected",
      title: approved ? "Verification approved" : "Verification request reviewed",
      message: approved
        ? "Your account has been verified."
        : "Your verification request was not approved. Review the feedback in Verification settings.",
      data: {
        verification_type: reviewed.verification_type,
        verification_request_id: reviewed.id,
      },
    })
    if (notificationError) {
      console.error("Verification decision notification could not be delivered:", notificationError)
    }

    const { data: requestWithUser } = await supabase
      .from("verification_requests")
      .select("*, user:profiles!verification_requests_user_id_fkey(id, username, display_name, avatar_url, is_verified)")
      .eq("id", parsed.value.requestId)
      .maybeSingle()

    return NextResponse.json({
      success: true,
      request: requestWithUser || reviewed,
    })
  } catch (error) {
    console.error("Error processing verification request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

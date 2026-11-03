import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { requireAdmin } from "@/lib/server-auth"
import { parseVerificationAppealReview } from "@/lib/verification-appeal"

export async function GET(request: NextRequest) {
  const { response } = await requireAdmin(request)
  if (response) return response

  try {
    const supabase = createServerClient()
    const { data: appeals, error } = await supabase
      .from("verification_appeals")
      .select(`
        id, request_id, user_id, reason, evidence_url, status,
        rejection_reason, reviewer_notes, created_at, reviewed_at,
        user:profiles!verification_appeals_user_id_fkey(id, username, display_name, avatar_url),
        request:verification_requests!verification_appeals_request_id_fkey(id, reason, verification_type, status, created_at, rejection_reason)
      `)
      .order("created_at", { ascending: false })
      .limit(100)

    if (error) {
      console.error("Failed to load verification appeals:", error)
      if (error.code === "42P01") {
        return NextResponse.json({ error: "Verification appeals are unavailable until the database migration is applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not load verification appeals" }, { status: 500 })
    }

    return NextResponse.json({ appeals: appeals || [] })
  } catch (error) {
    console.error("Error loading verification appeals:", error)
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
  const parsed = parseVerificationAppealReview(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const supabase = createServerClient()
    const { data, error } = await supabase.rpc("review_verification_appeal", {
      p_appeal_id: parsed.value.appealId,
      p_reviewer_id: user.id,
      p_action: parsed.value.action,
      p_rejection_reason: parsed.value.rejectionReason,
      p_admin_notes: parsed.value.adminNotes,
    })

    if (error) {
      console.error("Verification appeal review failed:", error)
      if (error.code === "42501") return NextResponse.json({ error: "Administrator access required" }, { status: 403 })
      if (error.code === "P0002") return NextResponse.json({ error: "Verification appeal not found" }, { status: 404 })
      if (error.code === "55000") return NextResponse.json({ error: error.message }, { status: 409 })
      if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 400 })
      if (["42883", "42P01", "42703"].includes(error.code || "")) {
        return NextResponse.json({ error: "Verification appeal review is unavailable until the database migration is applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not complete the appeal review" }, { status: 500 })
    }

    const result = (Array.isArray(data) ? data[0] : data) as {
      appeal?: { id?: string; user_id?: string; status?: string }
      request_status?: string
    } | null
    const appeal = result?.appeal
    if (!result || !appeal?.id || !appeal.user_id || !["accepted", "rejected"].includes(appeal.status || "")) {
      return NextResponse.json({ error: "Verification appeal review returned an invalid result" }, { status: 500 })
    }

    const accepted = appeal.status === "accepted"
    const { error: notificationError } = await supabase.from("notifications").insert({
      user_id: appeal.user_id,
      type: accepted ? "verification_appeal_accepted" : "verification_appeal_rejected",
      title: accepted ? "Appeal accepted" : "Appeal reviewed",
      message: accepted
        ? "Your verification application has been returned to the review queue. This does not mean your account is verified."
        : "Your verification appeal was not accepted. Review the feedback in Verification settings.",
      data: { verification_appeal_id: appeal.id },
    })
    if (notificationError) console.error("Verification appeal notification failed:", notificationError)

    return NextResponse.json({ success: true, appeal, request_status: result.request_status })
  } catch (error) {
    console.error("Error reviewing verification appeal:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

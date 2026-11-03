import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { parseVerificationAppeal } from "@/lib/verification-appeal"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function mapAppealError(error: { code?: string; message?: string }) {
  if (error.code === "P0002") return NextResponse.json({ error: "Verification request not found" }, { status: 404 })
  if (error.code === "55000" || error.code === "23505") {
    return NextResponse.json({ error: error.message || "This request can no longer be appealed" }, { status: 409 })
  }
  if (error.code === "22023") return NextResponse.json({ error: error.message || "Invalid appeal details" }, { status: 400 })
  if (error.code === "42501") return NextResponse.json({ error: "You cannot appeal this request" }, { status: 403 })
  if (["42883", "42P01", "42703"].includes(error.code || "")) {
    return NextResponse.json({ error: "Verification appeals are unavailable until the database migration is applied." }, { status: 503 })
  }
  return NextResponse.json({ error: "Could not process the verification appeal" }, { status: 500 })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Invalid verification request ID" }, { status: 400 })

    const supabase = createServerClient()
    const { data: appeal, error } = await supabase
      .from("verification_appeals")
      .select("id, request_id, reason, evidence_url, status, rejection_reason, created_at, reviewed_at")
      .eq("request_id", id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (error) {
      console.error("Failed to load applicant verification appeal:", error)
      if (error.code === "42P01") {
        return NextResponse.json({ error: "Verification appeals are unavailable until the database migration is applied." }, { status: 503 })
      }
      return NextResponse.json({ error: "Could not load the verification appeal" }, { status: 500 })
    }

    return NextResponse.json({ appeal: appeal || null })
  } catch (error) {
    console.error("Error loading verification appeal:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { id } = await params
    if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Invalid verification request ID" }, { status: 400 })

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
    }
    const parsed = parseVerificationAppeal(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const supabase = createServerClient()
    const { data, error } = await supabase.rpc("submit_verification_appeal", {
      p_request_id: id,
      p_user_id: user.id,
      p_reason: parsed.value.reason,
      p_evidence_url: parsed.value.evidenceUrl,
    })
    if (error) {
      console.error("Verification appeal submission failed:", error)
      return mapAppealError(error)
    }

    return NextResponse.json({ success: true, appeal: data }, { status: 201 })
  } catch (error) {
    console.error("Error submitting verification appeal:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { parseVerificationSubmission } from "@/lib/verification-submission"

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
    }

    const parsed = parseVerificationSubmission(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const supabase = createServerClient()
    const { realName, socialLinks, reason, verificationType, documentsUrl } = parsed.value

    // The username is resolved from the signed-in user's canonical profile.
    // A request body must never be able to apply for another account.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, is_verified")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      console.error("Failed to load verification applicant profile:", profileError)
      return NextResponse.json({ error: "Could not load your account profile" }, { status: 500 })
    }
    if (!profile?.username) {
      return NextResponse.json({ error: "Complete your account profile before applying" }, { status: 409 })
    }
    if (profile.is_verified) {
      return NextResponse.json({ error: "Your account is already verified" }, { status: 409 })
    }

    const { data: existingRequest, error: existingError } = await supabase
      .from("verification_requests")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle()

    if (existingError) {
      console.error("Failed to check pending verification request:", existingError)
      return NextResponse.json({ error: "Could not check your existing requests" }, { status: 500 })
    }
    if (existingRequest) {
      return NextResponse.json(
        { error: "You already have a pending verification request" },
        { status: 409 },
      )
    }

    const baseRow = {
      user_id: user.id,
      real_name: realName,
      username: profile.username,
      social_links: socialLinks,
      reason,
      verification_type: verificationType,
      documents_url: documentsUrl,
      status: "pending",
    }

    let { data: verificationRequest, error } = await supabase
      .from("verification_requests")
      .insert({ ...baseRow, category: verificationType })
      .select("id, status, verification_type, created_at")
      .single()

    if (error?.code === "42703") {
      // Older deployments may not yet have the category column.
      ;({ data: verificationRequest, error } = await supabase
        .from("verification_requests")
        .insert(baseRow)
        .select("id, status, verification_type, created_at")
        .single())
    }

    if (error) {
      console.error("Failed to insert verification request:", error)
      if (error.code === "42P01") {
        return NextResponse.json(
          { error: "Verification is temporarily unavailable because the database migration is missing." },
          { status: 503 },
        )
      }
      if (error.code === "23514") {
        return NextResponse.json(
          { error: "Verification categories are not up to date. Apply the current verification migration before accepting applications." },
          { status: 503 },
        )
      }
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "You already have a pending verification request" },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: "Could not submit your verification request" }, { status: 500 })
    }

    if (!verificationRequest) {
      return NextResponse.json({ error: "Could not submit your verification request" }, { status: 500 })
    }

    // Admin notification content is based on the trusted profile, not client input.
    const { data: admins, error: adminsError } = await supabase
      .from("profiles")
      .select("id")
      .eq("is_admin", true)

    if (!adminsError && admins?.length) {
      await supabase.from("notifications").insert(
        admins.map((admin) => ({
          user_id: admin.id,
          type: "verification_request",
          title: "New verification request",
          message: `@${profile.username} submitted a ${verificationType} verification request.`,
          data: {
            request_id: verificationRequest.id,
            username: profile.username,
            verification_type: verificationType,
          },
        })),
      )
    }

    return NextResponse.json(
      {
        success: true,
        message: "Verification request submitted successfully",
        request: verificationRequest,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("Error submitting verification request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createServerClient()
    // Applicant history intentionally omits legal names, evidence links and
    // private application text. The reviewer endpoint owns those fields.
    const { data: requests, error } = await supabase
      .from("verification_requests")
      .select("id, verification_type, status, rejection_reason, created_at, reviewed_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Failed to fetch verification request history:", error)
      return NextResponse.json({ error: "Could not load verification request history" }, { status: 500 })
    }

    return NextResponse.json({ requests: requests || [] })
  } catch (error) {
    console.error("Error fetching verification requests:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { notifyUser } from "@/lib/notifications"
import { requireAdmin } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const VALID_STATUSES = ["pending_review", "approved", "paid", "rejected"]

export async function GET(request: NextRequest) {
  const { response } = await requireAdmin(request)
  if (response) return response

  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")

  let query = supabase
    .from("withdrawal_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200)

  if (status && VALID_STATUSES.includes(status)) {
    query = query.eq("status", status)
  }

  const { data: requests, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, requests: requests || [] })
}

export async function PATCH(request: NextRequest) {
  const { user, response } = await requireAdmin(request)
  if (response) return response
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === "string" ? body.id : ""
  const status = typeof body.status === "string" ? body.status : ""
  const adminNote = typeof body.admin_note === "string" ? body.admin_note.trim() : null

  if (!id || !["approved", "paid", "rejected"].includes(status)) {
    return NextResponse.json(
      { error: "id and a valid transition (approved, paid, rejected) are required" },
      { status: 400 },
    )
  }
  if (adminNote && adminNote.length > 1000) {
    return NextResponse.json({ error: "Admin note must be 1,000 characters or fewer." }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase.rpc("review_coin_withdrawal", {
    p_admin_id: user.id,
    p_withdrawal_id: id,
    p_status: status,
    p_admin_note: adminNote,
  })

  if (error) {
    console.error("Atomic payout review failed:", error)
    if (error.code === "42501") {
      return NextResponse.json({ error: "Administrator access is required." }, { status: 403 })
    }
    if (error.code === "P0002") {
      return NextResponse.json({ error: "Withdrawal request or owner profile not found." }, { status: 404 })
    }
    if (error.code === "55000") {
      return NextResponse.json({ error: error.message || "This payout can no longer be changed." }, { status: 409 })
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: error.message || "Invalid payout review request." }, { status: 400 })
    }
    if (["42883", "42P01", "42703"].includes(error.code || "")) {
      return NextResponse.json({ error: "Secure payout review is unavailable until the wallet migration has been applied." }, { status: 503 })
    }
    return NextResponse.json({ error: "Could not update withdrawal request." }, { status: 500 })
  }

  const result = (Array.isArray(data) ? data[0] : data) as {
    request?: Record<string, unknown>
    already_processed?: boolean
  } | null
  if (!result?.request || typeof result.request.status !== "string" || result.request.id !== id) {
    return NextResponse.json({ error: "Payout review returned an invalid result." }, { status: 500 })
  }

  if (!result.already_processed) {
    try {
      await notifyStatusChange(supabase, result.request)
    } catch (notificationError) {
      // The status transition and any refund are already committed.
      console.error("Could not send payout status notification:", notificationError)
    }
  }

  return NextResponse.json({
    success: true,
    request: result.request,
    already_processed: Boolean(result.already_processed),
  })
}

async function notifyStatusChange(supabase: any, request: any) {
  if (!request?.user_id) return
  const statusCopy: Record<string, string> = {
    approved: "Your payout request was approved and is being processed.",
    paid: `Your payout of ${request.coins_amount} coins (~$${request.estimated_usd}) has been sent.`,
    rejected: "Your payout request was declined. The coins have been returned to your balance.",
  }
  const message = statusCopy[request.status]
  if (!message) return
  await notifyUser(supabase, {
    userId: request.user_id,
    type: "payout_status",
    title: "Payout update",
    message,
    actionUrl: "/wallet?tab=withdrawals",
  })
}

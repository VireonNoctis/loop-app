import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function unavailable() {
  return NextResponse.json(
    { error: "Circle ownership management is unavailable until the server database configuration is ready." },
    { status: 503 },
  )
}

function mapTransferError(error: { code?: string }) {
  if (error.code === "P0002") return NextResponse.json({ error: "Circle or recipient account not found" }, { status: 404 })
  if (error.code === "42501") return NextResponse.json({ error: "Only the current owner can transfer ownership to an active, eligible Circle member" }, { status: 403 })
  if (error.code === "22023") return NextResponse.json({ error: "Choose a different, valid Circle member" }, { status: 400 })
  if (error.code === "55000") return NextResponse.json({ error: "Circle ownership changed. Refresh and try again." }, { status: 409 })
  if (["42883", "42P01", "42703"].includes(error.code || "")) {
    return NextResponse.json({ error: "Circle ownership transfer is unavailable until the database migration is applied." }, { status: 503 })
  }
  return NextResponse.json({ error: "Could not transfer Circle ownership" }, { status: 500 })
}

/** The current viewer's ownership capability; never trusts a client-sent role. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return unavailable()

    const { id: circleId } = await params
    if (!UUID_PATTERN.test(circleId)) return NextResponse.json({ error: "Invalid Circle ID" }, { status: 400 })

    const supabase = createServerClient()
    const { data: circle, error } = await supabase
      .from("circles")
      .select("id, owner_id")
      .eq("id", circleId)
      .maybeSingle()

    if (error) {
      console.error("Circle ownership lookup failed:", error.message)
      return NextResponse.json({ error: "Could not verify Circle ownership" }, { status: 503 })
    }
    if (!circle) return NextResponse.json({ error: "Circle not found" }, { status: 404 })

    return NextResponse.json({
      circle_id: circle.id,
      owner_id: circle.owner_id,
      can_transfer: circle.owner_id === user.id,
    })
  } catch (error) {
    console.error("Circle ownership lookup failed:", error)
    return NextResponse.json({ error: "Could not verify Circle ownership" }, { status: 500 })
  }
}

/** Transfers ownership atomically; the database verifies both parties and membership. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return unavailable()

    const { id: circleId } = await params
    if (!UUID_PATTERN.test(circleId)) return NextResponse.json({ error: "Invalid Circle ID" }, { status: 400 })

    let body: Record<string, unknown>
    try {
      const parsed = await request.json()
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid ownership transfer payload" }, { status: 400 })
      }
      body = parsed as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
    }

    const newOwnerId = body.new_owner_id
    if (typeof newOwnerId !== "string" || !UUID_PATTERN.test(newOwnerId)) {
      return NextResponse.json({ error: "A valid new_owner_id is required" }, { status: 400 })
    }
    if (newOwnerId === user.id) {
      return NextResponse.json({ error: "You already own this Circle" }, { status: 400 })
    }

    const supabase = createServerClient()
    const { data, error } = await supabase.rpc("transfer_circle_ownership", {
      p_circle_id: circleId,
      p_actor_id: user.id,
      p_new_owner_id: newOwnerId,
    })

    if (error) {
      console.error("Atomic Circle ownership transfer failed:", error.message)
      return mapTransferError(error)
    }

    const result = (Array.isArray(data) ? data[0] : data) as {
      circle_id?: string
      previous_owner_id?: string
      owner_id?: string
      member_count?: number
    } | null

    if (!result?.circle_id || result.previous_owner_id !== user.id || result.owner_id !== newOwnerId) {
      console.error("Circle ownership RPC returned an invalid transfer result")
      return NextResponse.json({ error: "Ownership transfer returned an invalid result" }, { status: 500 })
    }

    try {
      await supabase.channel(`circle-admin:${circleId}`).send({
        type: "broadcast",
        event: "ownership_transferred",
        payload: { circleId, previousOwnerId: user.id, newOwnerId },
      })
    } catch (broadcastError) {
      console.warn("Circle ownership refresh broadcast failed:", broadcastError)
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error("Circle ownership transfer failed:", error)
    return NextResponse.json({ error: "Could not transfer Circle ownership" }, { status: 500 })
  }
}

import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access";

async function getUser(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return null
  return user
}

async function getMember(circleId: string, userId: string) {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from("circle_members")
    .select("role, status")
    .eq("circle_id", circleId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw new Error("Could not verify Circle membership")
  return data && ["active", "approved"].includes(String(data.status || "")) ? data : null
}

function canManage(role?: string) {
  return role === "owner" || role === "admin" || role === "moderator"
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
    const access = await checkCirclePrivateAccess(id, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

  const supabase = createServerClient()
  const { data: bots, error } = await supabase.from("circle_bots").select("*").eq("circle_id", id).order("created_at", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, bots: bots || [] })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Circle bot management is unavailable" }, { status: 503 })
  }
  const member = await getMember(id, user.id)
  if (!canManage(member?.role)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const supabase = createServerClient()
  const botType = body.bot_type || "welcome"
  const payload: Record<string, unknown> = {
    circle_id: id,
    name: body.name || "Loop Bot",
    bot_type: botType,
    enabled: body.enabled ?? true,
    configuration: body.configuration || {},
    updated_at: new Date().toISOString(),
  }
  if (body.id) payload.id = body.id

  const { data: bot, error } = await supabase
    .from("circle_bots")
    .upsert(payload, { onConflict: body.id ? "id" : "circle_id,bot_type" })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, bot })
}

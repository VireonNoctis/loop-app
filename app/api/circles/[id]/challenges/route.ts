import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth";
import { checkCirclePrivateAccess } from "@/lib/circle-access";

async function getUser(request: NextRequest) {
  return getUserFromRequest(request)
}

async function getMember(circleId: string, userId: string) {
  const supabase = createServerClient()
  const { data: circle, error: circleError } = await supabase
    .from("circles")
    .select("owner_id")
    .eq("id", circleId)
    .maybeSingle()
  if (circleError) throw new Error("Could not verify Circle ownership")
  if (!circle) return null
  if (circle.owner_id === userId) return { role: "owner", status: "active" }

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
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Circle challenges are unavailable" }, { status: 503 })
  }
  const access = await checkCirclePrivateAccess(id, request.headers.get("authorization"))
  if (access.isPrivate && !access.canView) {
    return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
  }
  const supabase = createServerClient()
  const { data: challenges, error } = await supabase.from("circle_challenges").select("*").eq("circle_id", id).order("created_at", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, challenges: challenges || [] })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Circle challenge management is unavailable" }, { status: 503 })
  }
  const { id } = await params
  let member: { role: string; status: string } | null
  try {
    member = await getMember(id, user.id)
  } catch {
    return NextResponse.json({ error: "Could not verify Circle permissions" }, { status: 503 })
  }
  if (!canManage(member?.role)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  const body = await request.json()
  if (!body.title?.trim()) return NextResponse.json({ error: "Challenge title is required" }, { status: 400 })
  const supabase = createServerClient()
  const { data: challenge, error } = await supabase.from("circle_challenges").insert({
    circle_id: id,
    title: body.title.trim(),
    description: body.description || "",
    challenge_type: body.challenge_type || "creative",
    reward_coins: Number(body.reward_coins || 0),
    starts_at: body.starts_at || new Date().toISOString(),
    ends_at: body.ends_at || null,
    created_by: user.id,
    status: body.status || "active",
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, challenge })
}

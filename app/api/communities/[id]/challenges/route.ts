import { type NextRequest, NextResponse } from "next/server"
import { communityClient, logCommunityActivity, canModerate } from "@/lib/community-engine"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await checkCirclePrivateAccess(id, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }
    const sb = communityClient()

    const { data: challenges, error } = await sb
      .from("circle_challenges")
      .select(`
        *,
        entries:community_challenge_entries(count),
        participants:community_challenge_entries(user_id),
        creator:profiles!created_by(id, username, display_name, avatar_url, is_verified)
      `)
      .eq("circle_id", id)
      .order("created_at", { ascending: false })
      .limit(20)

    if (error) return NextResponse.json({ error: "Failed to load challenges" }, { status: 500 })

    const enriched = (challenges || []).map((c: any) => {
      const entryRows = c.participants || []
      const uniqueParticipants = new Set(entryRows.map((e: any) => e.user_id)).size
      return {
        ...c,
        entry_count: Number(Array.isArray(c.entries) ? c.entries[0]?.count : c.entries || 0),
        participant_count: uniqueParticipants,
        entries: undefined,
        participants: undefined,
      }
    })

    return NextResponse.json({ challenges: enriched })
  } catch (e: any) {
    console.error("[challenges] GET error:", e)
    return NextResponse.json({ error: e.message || "Failed to load challenges" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Sign in to create a challenge" }, { status: 401 })
    const sb = communityClient()

    const { data: membership } = await sb.from("circle_members").select("role, status").eq("circle_id", id).eq("user_id", user.id).maybeSingle()
    if (!membership || !["active", "approved"].includes(String(membership.status))) {
      return NextResponse.json({ error: "Join the Circle first" }, { status: 403 })
    }

    const body = await request.json()
    const title = typeof body.title === "string" ? body.title.trim() : ""
    const description = typeof body.description === "string" ? body.description.trim() : ""
    const requestedType = typeof body.challenge_type === "string" ? body.challenge_type.trim() : "creative"
    const allowedTypes = new Set(["creative", "photography", "poll", "guessing", "collaborative", "discussion"])
    if (!title || title.length > 120) return NextResponse.json({ error: "Challenge title must be 1–120 characters" }, { status: 400 })
    if (description.length > 2000) return NextResponse.json({ error: "Challenge description is too long" }, { status: 400 })
    if (!allowedTypes.has(requestedType)) return NextResponse.json({ error: "Choose a supported community activity format" }, { status: 400 })
    const challenge_type = requestedType
    const reward_coins = 0

    const startDate = body.starts_at ? new Date(body.starts_at) : new Date()
    const endDate = body.ends_at ? new Date(body.ends_at) : new Date(startDate.getTime() + 7 * 86400000)
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || endDate <= startDate) {
      return NextResponse.json({ error: "Choose an end time after the start time" }, { status: 400 })
    }
    if (endDate.getTime() <= Date.now()) {
      return NextResponse.json({ error: "A Drop must end in the future" }, { status: 400 })
    }

    const { data: challenge, error } = await sb
      .from("circle_challenges")
      .insert({
        circle_id: id,
        title,
        description,
        challenge_type,
        reward_coins,
        starts_at: startDate.toISOString(),
        ends_at: endDate.toISOString(),
        created_by: user.id,
        status: "active",
      })
      .select()
      .single()

    if (error || !challenge) {
      return NextResponse.json({ error: "Failed to create challenge: " + (error?.message || "") }, { status: 500 })
    }

    await logCommunityActivity(sb, id, user.id, "challenge_created", "challenge", challenge.id, { title: challenge.title })
    return NextResponse.json({ challenge }, { status: 201 })
  } catch (e: any) {
    console.error("[challenges] POST error:", e)
    return NextResponse.json({ error: e.message || "Failed to create challenge" }, { status: 500 })
  }
}
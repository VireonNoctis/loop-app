import { type NextRequest, NextResponse } from "next/server"
import { communityClient } from "@/lib/community-engine"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; challengeId: string }> },
) {
  try {
    const { id: circleId, challengeId } = await params
    const supabase = communityClient()
    const { data: challenge, error } = await supabase
      .from("circle_challenges")
      .select(`
        id,
        circle_id,
        title,
        description,
        challenge_type,
        status,
        starts_at,
        ends_at,
        created_at,
        created_by,
        creator:profiles!created_by(id, username, display_name, avatar_url, is_verified)
      `)
      .eq("id", challengeId)
      .eq("circle_id", circleId)
      .maybeSingle()

    if (error) {
      console.error("Challenge detail lookup failed:", error)
      return NextResponse.json({ error: "Could not load this Drop" }, { status: 500 })
    }
    if (!challenge) return NextResponse.json({ error: "Drop not found" }, { status: 404 })

    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const user = await getUserFromRequest(request)
    const [{ data: membership }, { data: circle }] = user
      ? await Promise.all([
          supabase
            .from("circle_members")
            .select("status")
            .eq("circle_id", circleId)
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("circles")
            .select("owner_id")
            .eq("id", circleId)
            .maybeSingle(),
        ])
      : [{ data: null }, { data: null }]

    const now = Date.now()
    const startsAt = challenge.starts_at ? new Date(challenge.starts_at).getTime() : 0
    const endsAt = challenge.ends_at ? new Date(challenge.ends_at).getTime() : Number.POSITIVE_INFINITY
    const isOpen = challenge.status === "active" && startsAt <= now && endsAt >= now
    const isMember = Boolean(membership && ["active", "approved"].includes(String(membership.status)))
    const canCreateChain = Boolean(
      user && (circle?.owner_id === user.id || isMember),
    )

    return NextResponse.json({
      success: true,
      challenge,
      can_submit: Boolean(user && isMember && isOpen),
      is_member: isMember,
      can_create_chain: canCreateChain,
      viewer_id: user?.id || null,
    })
  } catch (error) {
    console.error("Challenge detail error:", error)
    return NextResponse.json({ error: "Could not load this Drop" }, { status: 500 })
  }
}

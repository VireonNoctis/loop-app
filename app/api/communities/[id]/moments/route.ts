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

    const { data: challengeRows } = await sb.from("circle_challenges").select("id").eq("circle_id", id).limit(200)
    const challengeIds = (challengeRows || []).map((c: any) => c.id)

    const [{ data: manual }, { data: topPost }, { data: hotPost }, { data: topEntryRows }] = await Promise.all([
      sb.from("community_moments").select("*").eq("circle_id", id).eq("is_manual", true).order("created_at", { ascending: false }).limit(20),
      sb.from("circle_posts").select("id, content, like_count").eq("circle_id", id).order("like_count", { ascending: false }).limit(1),
      sb.from("circle_posts").select("id, content, comment_count").eq("circle_id", id).order("comment_count", { ascending: false }).limit(1),
      challengeIds.length > 0
        ? sb.from("community_challenge_entries").select("id, content, vote_count").in("challenge_id", challengeIds).order("vote_count", { ascending: false }).limit(1)
        : Promise.resolve({ data: [] }),
    ])
    const topEntry = topEntryRows?.[0] || null

    const auto: any[] = []
    if (topPost?.length && (topPost[0].like_count || 0) >= 5) {
      auto.push({ kind: "favorite", emoji: "🎨", title: "Community favorite", description: (topPost[0].content || "").slice(0, 100), ref_type: "post", ref_id: topPost[0].id, is_auto: true })
    }
    if (hotPost?.length && (hotPost[0].comment_count || 0) >= 5) {
      auto.push({ kind: "most_discussed", emoji: "🔥", title: "Most discussed", description: (hotPost[0].content || "").slice(0, 100), ref_type: "post", ref_id: hotPost[0].id, is_auto: true })
    }
    if (topEntry && (topEntry.vote_count || 0) >= 3) {
      auto.push({ kind: "top_contribution", emoji: "🏆", title: "Top contribution", description: (topEntry.content || "").slice(0, 100), ref_type: "challenge_entry", ref_id: topEntry.id, is_auto: true })
    }

    return NextResponse.json({ moments: { manual: manual || [], auto } })
  } catch (e: any) {
    console.error("[moments] GET error:", e)
    return NextResponse.json({ error: e.message || "Failed to load moments" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sb = communityClient()

    const { data: membership } = await sb.from("circle_members").select("role").eq("circle_id", id).eq("user_id", user.id).maybeSingle()
    if (!canModerate(membership?.role)) {
      return NextResponse.json({ error: "Only moderators and above can feature moments" }, { status: 403 })
    }

    const body = await request.json()
    const { kind = "featured", title, description = "", ref_type, ref_id, ref_url } = body
    if (!title || !title.trim()) return NextResponse.json({ error: "Moment needs a title" }, { status: 400 })

    const { data: moment, error } = await sb
      .from("community_moments")
      .insert({
        circle_id: id,
        kind,
        title: title.trim().slice(0, 150),
        description: description.slice(0, 1000),
        ref_type: ref_type || null,
        ref_id: ref_id != null ? String(ref_id) : null,
        ref_url: ref_url || null,
        is_manual: true,
        featured_by: user.id,
      })
      .select()
      .single()

    if (error || !moment) return NextResponse.json({ error: "Failed to feature moment" }, { status: 500 })
    await logCommunityActivity(sb, id, user.id, "moment_featured", "moment", moment.id, { title: moment.title })
    return NextResponse.json({ moment }, { status: 201 })
  } catch (e: any) {
    console.error("[moments] POST error:", e)
    return NextResponse.json({ error: e.message || "Failed to feature moment" }, { status: 500 })
  }
}
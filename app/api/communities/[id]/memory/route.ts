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

    const [{ data: manual }, { count: memberCount }, { count: postCount }] = await Promise.all([
      sb.from("community_memory").select("*").eq("circle_id", id).order("happened_at", { ascending: false }).limit(50),
      sb.from("circle_members").select("id", { count: "exact", head: true }).eq("circle_id", id).neq("status", "banned"),
      sb.from("circle_posts").select("id", { count: "exact", head: true }).eq("circle_id", id),
    ])

    // Auto milestones computed from real data
    const auto: any[] = []
    if ((memberCount || 0) >= 10) auto.push({ title: `Reached ${memberCount} members`, description: "The world is growing.", is_auto: true })
    if ((postCount || 0) >= 100) auto.push({ title: `100+ discussions (${postCount})`, description: "The community never stops talking.", is_auto: true })
    if ((postCount || 0) >= 1000) auto.push({ title: `1,000+ discussions (${postCount})`, description: "A legendary archive.", is_auto: true })

    return NextResponse.json({ memory: { manual: manual || [], auto }, member_count: memberCount || 0, post_count: postCount || 0 })
  } catch (e: any) {
    console.error("[memory] GET error:", e)
    return NextResponse.json({ error: e.message || "Failed to load memory" }, { status: 500 })
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
      return NextResponse.json({ error: "Only moderators and above can write history" }, { status: 403 })
    }

    const body = await request.json()
    const { title, description = "", kind = "memory", media_url, happened_at } = body
    if (!title || !title.trim()) return NextResponse.json({ error: "Memory needs a title" }, { status: 400 })

    const { data: memory, error } = await sb
      .from("community_memory")
      .insert({
        circle_id: id,
        kind,
        title: title.trim().slice(0, 150),
        description: description.slice(0, 1000),
        media_url: media_url || null,
        happened_at: happened_at ? new Date(happened_at).toISOString() : new Date().toISOString(),
        is_auto: false,
        created_by: user.id,
      })
      .select()
      .single()

    if (error || !memory) return NextResponse.json({ error: "Failed to save memory" }, { status: 500 })
    await logCommunityActivity(sb, id, user.id, "memory_added", "memory", memory.id, { title: memory.title })
    return NextResponse.json({ memory }, { status: 201 })
  } catch (e: any) {
    console.error("[memory] POST error:", e)
    return NextResponse.json({ error: e.message || "Failed to save memory" }, { status: 500 })
  }
}
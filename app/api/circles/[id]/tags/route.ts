import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

function getCircleTagsClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createServerClient()
}

// GET — any visitor may read the circle's tag vocabulary.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: circleId } = await params
    const supabase = getCircleTagsClient()
    if (!supabase) return NextResponse.json({ error: "Circle tags are unavailable" }, { status: 503 })
    const access = await checkCirclePrivateAccess(circleId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const { data: tags, error } = await supabase
      .from("circle_tags")
      .select("*")
      .eq("circle_id", circleId)
      .order("name", { ascending: true })

    if (error) {
      console.error("circle tags GET:", error)
      return NextResponse.json({ success: true, tags: [] })
    }

    const { data: posts } = await supabase
      .from("circle_posts")
      .select("tags")
      .eq("circle_id", circleId)
      .not("tags", "is", null)
      .limit(200)
    const usedCounts: Record<string, number> = {}
    for (const post of posts || []) {
      for (const tag of post.tags || []) {
        usedCounts[tag] = (usedCounts[tag] || 0) + 1
      }
    }

    return NextResponse.json({
      success: true,
      tags: (tags || []).map((t) => ({ ...t, post_count: usedCounts[t.name] || 0 })),
    })
  } catch (error) {
    console.error("circle tags GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST — staff (owner/admin/moderator) create tags; members may not.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const supabase = getCircleTagsClient()
    if (!supabase) return NextResponse.json({ error: "Circle tags are unavailable" }, { status: 503 })

    const { id: circleId } = await params
    const body = await request.json().catch(() => ({}))
    const name = String(body.name || "").trim().replace(/^#/, "").toLowerCase()
    if (!name || name.length > 24) {
      return NextResponse.json({ error: "Tag name is required and must be 24 characters or fewer" }, { status: 400 })
    }
    if (!/^[a-z0-9 _-]+$/.test(name)) {
      return NextResponse.json({ error: "Tags can only contain letters, numbers, spaces, _ and -" }, { status: 400 })
    }

    const { data: member } = await supabase
      .from("circle_members")
      .select("role")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .in("status", ["active", "approved"])
      .maybeSingle()
    if (!member || !["owner", "admin", "moderator"].includes(member.role)) {
      return NextResponse.json({ error: "Only circle admins can create tags" }, { status: 403 })
    }

    const { data: tag, error } = await supabase
      .from("circle_tags")
      .insert({ circle_id: circleId, name, created_by: user.id })
      .select()
      .single()

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "That tag already exists" }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, tag })
  } catch (error: any) {
    console.error("circle tags POST:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

// DELETE — staff delete tags; posts keep the string but it leaves the vocabulary.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; tagId: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const supabase = getCircleTagsClient()
    if (!supabase) return NextResponse.json({ error: "Circle tags are unavailable" }, { status: 503 })

    const { id: circleId, tagId } = await params
    const { data: member } = await supabase
      .from("circle_members")
      .select("role")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .in("status", ["active", "approved"])
      .maybeSingle()
    if (!member || !["owner", "admin", "moderator"].includes(member.role)) {
      return NextResponse.json({ error: "Only circle admins can delete tags" }, { status: 403 })
    }

    const { error } = await supabase.from("circle_tags").delete().eq("id", tagId).eq("circle_id", circleId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("circle tags DELETE:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

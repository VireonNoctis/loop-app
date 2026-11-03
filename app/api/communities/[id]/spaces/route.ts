import { type NextRequest, NextResponse } from "next/server"
import { communityClient, logCommunityActivity, canModerate } from "@/lib/community-engine"
import { getUserFromRequest } from "@/lib/server-auth"
import { SPACE_TYPES } from "@/lib/community-categories"
import { canViewCommunitySpace } from "@/lib/community-space-access"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getUserFromRequest(request)
    const sb = communityClient()

    const { data: circle } = await sb.from("circles").select("is_private, owner_id").eq("id", id).maybeSingle()
    if (!circle) return NextResponse.json({ error: "Community not found" }, { status: 404 })

    const { data: membership } = user
      ? await sb.from("circle_members").select("status, role").eq("circle_id", id).eq("user_id", user.id).maybeSingle()
      : { data: null }
    const isOwner = Boolean(user && circle.owner_id === user.id)
    const isMember = isOwner || membership?.status === "active" || membership?.status === "approved"
    const isModerator = isMember && (isOwner || canModerate(membership?.role))
    if (circle.is_private && !isMember) return NextResponse.json({ error: "Private community" }, { status: 403 })

    const { data: spaces, error } = await sb
      .from("community_spaces")
      .select("*")
      .eq("circle_id", id)
      .eq("is_archived", false)
      .order("sort_order")
      .limit(60)
    if (error) return NextResponse.json({ error: "Failed to load spaces" }, { status: 500 })
    const visibleSpaces = (spaces || []).filter((space: { visibility?: string }) =>
      canViewCommunitySpace(space.visibility, Boolean(isMember), Boolean(isModerator)),
    )
    return NextResponse.json({ spaces: visibleSpaces })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to load spaces" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Sign in to manage spaces" }, { status: 401 })
    const sb = communityClient()

    const { data: circle } = await sb.from("circles").select("owner_id").eq("id", id).maybeSingle()
    if (!circle) return NextResponse.json({ error: "Community not found" }, { status: 404 })
    const { data: membership } = await sb.from("circle_members").select("role, status").eq("circle_id", id).eq("user_id", user.id).maybeSingle()
    const isOwner = circle.owner_id === user.id
    const isMember = isOwner || membership?.status === "active" || membership?.status === "approved"
    if (!isMember || (!isOwner && !canModerate(membership?.role))) {
      return NextResponse.json({ error: "Only moderators and above can create spaces" }, { status: 403 })
    }

    const body = await request.json()
    const { name, type = "discussion", icon, description = "", visibility = "members", permissions = {}, content_rules = {} } = body

    if (typeof name !== "string" || !name.trim() || name.trim().length > 60) {
      return NextResponse.json({ error: "Space names must contain 1 to 60 characters" }, { status: 400 })
    }
    if (!SPACE_TYPES.some((entry) => entry.id === type)) {
      return NextResponse.json({ error: "Choose a supported space type" }, { status: 400 })
    }
    if (!["public", "members", "mods"].includes(visibility)) {
      return NextResponse.json({ error: "Visibility must be public, members or mods" }, { status: 400 })
    }
    if (typeof description !== "string" || description.length > 300) {
      return NextResponse.json({ error: "Space descriptions are limited to 300 characters" }, { status: 400 })
    }
    const isRecord = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value)
    if (!isRecord(permissions) || !isRecord(content_rules)) {
      return NextResponse.json({ error: "Space permissions and content rules must be objects" }, { status: 400 })
    }
    const validType = type

    const { count } = await sb.from("community_spaces").select("id", { count: "exact", head: true }).eq("circle_id", id)
    const { data: space, error } = await sb
      .from("community_spaces")
      .insert({
        circle_id: id,
        name: name.trim().slice(0, 60),
        slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        type: validType,
        icon: typeof icon === "string" && icon.trim() ? icon.trim().slice(0, 32) : "hash",
        description: description.trim(),
        visibility,
        permissions: permissions || {},
        content_rules: content_rules || {},
        sort_order: count || 0,
        created_by: user.id,
      })
      .select()
      .single()

    if (error || !space) {
      return NextResponse.json({ error: "Failed to create space: " + (error?.message || "") }, { status: 500 })
    }

    await logCommunityActivity(sb, id, user.id, "space_created", "space", space.id, { name: space.name, type: space.type })
    return NextResponse.json({ space }, { status: 201 })
  } catch (e: any) {
    console.error("[spaces] POST error:", e)
    return NextResponse.json({ error: e.message || "Failed to create space" }, { status: 500 })
  }
}
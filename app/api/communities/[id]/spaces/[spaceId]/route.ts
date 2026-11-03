import { type NextRequest, NextResponse } from "next/server"
import { communityClient, logCommunityActivity, canModerate } from "@/lib/community-engine"
import { SPACE_TYPES } from "@/lib/community-categories"
import { getUserFromRequest } from "@/lib/server-auth"

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; spaceId: string }> }) {
  try {
    const { id, spaceId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sb = communityClient()

    const { data: circle } = await sb.from("circles").select("owner_id").eq("id", id).maybeSingle()
    if (!circle) return NextResponse.json({ error: "Community not found" }, { status: 404 })
    const { data: membership } = await sb.from("circle_members").select("role, status").eq("circle_id", id).eq("user_id", user.id).maybeSingle()
    const isOwner = circle.owner_id === user.id
    const isMember = isOwner || membership?.status === "active" || membership?.status === "approved"
    if (!isMember || (!isOwner && !canModerate(membership?.role))) {
      return NextResponse.json({ error: "Only moderators and above can edit spaces" }, { status: 403 })
    }

    const body = await request.json()
    const allowed: Record<string, unknown> = {}
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 60) return NextResponse.json({ error: "Space names must contain 1 to 60 characters" }, { status: 400 })
      const name = body.name.trim()
      allowed.name = name
      allowed.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    }
    if (body.type !== undefined) {
      if (typeof body.type !== "string" || !SPACE_TYPES.some((entry) => entry.id === body.type)) return NextResponse.json({ error: "Choose a supported space type" }, { status: 400 })
      allowed.type = body.type
    }
    if (body.visibility !== undefined) {
      if (!["public", "members", "mods"].includes(body.visibility)) return NextResponse.json({ error: "Visibility must be public, members or mods" }, { status: 400 })
      allowed.visibility = body.visibility
    }
    if (body.icon !== undefined) {
      if (typeof body.icon !== "string" || body.icon.length > 32) return NextResponse.json({ error: "Icon value is invalid" }, { status: 400 })
      allowed.icon = body.icon
    }
    if (body.description !== undefined) {
      if (typeof body.description !== "string" || body.description.length > 300) return NextResponse.json({ error: "Space descriptions are limited to 300 characters" }, { status: 400 })
      allowed.description = body.description
    }
    for (const key of ["permissions", "content_rules"]) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== "object" || body[key] === null || Array.isArray(body[key])) return NextResponse.json({ error: `Space ${key.replace("_", " ")} must be an object` }, { status: 400 })
        allowed[key] = body[key]
      }
    }
    if (body.pinned_content !== undefined) {
      if (!Array.isArray(body.pinned_content) || body.pinned_content.length > 20) return NextResponse.json({ error: "Pinned content must be a list of at most 20 items" }, { status: 400 })
      allowed.pinned_content = body.pinned_content
    }
    if (body.is_archived !== undefined) {
      if (typeof body.is_archived !== "boolean") return NextResponse.json({ error: "Archive state must be true or false" }, { status: 400 })
      allowed.is_archived = body.is_archived
    }
    if (body.sort_order !== undefined) {
      if (!Number.isInteger(body.sort_order) || body.sort_order < 0 || body.sort_order > 10000) return NextResponse.json({ error: "Sort order must be an integer from 0 to 10000" }, { status: 400 })
      allowed.sort_order = body.sort_order
    }
    if (Object.keys(allowed).length === 0) return NextResponse.json({ error: "No valid space changes were supplied" }, { status: 400 })
    allowed.updated_at = new Date().toISOString()

    const { data: space, error } = await sb.from("community_spaces").update(allowed).eq("id", spaceId).eq("circle_id", id).select().single()
    if (error || !space) {
      return NextResponse.json({ error: "Failed to update space" }, { status: 500 })
    }

    await logCommunityActivity(sb, id, user.id, "space_updated", "space", spaceId, {
      name: space.name,
      archived: Boolean(allowed.is_archived),
    })
    return NextResponse.json({ space })
  } catch (e: any) {
    console.error("[space] PATCH error:", e)
    return NextResponse.json({ error: e.message || "Failed to update space" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; spaceId: string }> }) {
  try {
    const { id, spaceId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sb = communityClient()

    const { data: circle } = await sb.from("circles").select("owner_id").eq("id", id).maybeSingle()
    if (!circle) return NextResponse.json({ error: "Community not found" }, { status: 404 })
    const { data: membership } = await sb.from("circle_members").select("role, status").eq("circle_id", id).eq("user_id", user.id).maybeSingle()
    const isOwner = circle.owner_id === user.id
    const isMember = isOwner || membership?.status === "active" || membership?.status === "approved"
    if (!isMember || (!isOwner && !canModerate(membership?.role))) {
      return NextResponse.json({ error: "Only moderators and above can delete spaces" }, { status: 403 })
    }

    const { data: space } = await sb.from("community_spaces").select("name").eq("id", spaceId).eq("circle_id", id).maybeSingle()
    if (!space) return NextResponse.json({ error: "Space not found" }, { status: 404 })

    // Move posts back to General before deleting
    await sb.from("circle_posts").update({ space_id: null }).eq("space_id", spaceId)
    const { error } = await sb.from("community_spaces").delete().eq("id", spaceId).eq("circle_id", id)
    if (error) return NextResponse.json({ error: "Failed to delete space" }, { status: 500 })

    await logCommunityActivity(sb, id, user.id, "space_deleted", "space", spaceId, { name: space.name })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error("[space] DELETE error:", e)
    return NextResponse.json({ error: e.message || "Failed to delete space" }, { status: 500 })
  }
}
import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"
import { canEditCircleStudio } from "@/lib/circle-permissions"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await checkCirclePrivateAccess(id, request.headers.get("authorization"))
  if (access.isPrivate && !access.canView) {
    return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
  }

  const supabase = createServerClient()
  const { data: circle, error } = await supabase
    .from("circles")
    .select("id, settings, theme_id")
    .eq("id", id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: "Could not load Circle Studio" }, { status: 500 })
  if (!circle) return NextResponse.json({ error: "Circle not found" }, { status: 404 })

  return NextResponse.json({
    success: true,
    studio: circle.settings?.community_studio || {},
    theme_id: circle.theme_id || null,
  })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid Studio update" }, { status: 400 })
  }

  const studioPatch = body.studio === undefined ? body : body.studio
  if (!studioPatch || typeof studioPatch !== "object" || Array.isArray(studioPatch)) {
    return NextResponse.json({ error: "Studio settings must be an object" }, { status: 400 })
  }
  if (Buffer.byteLength(JSON.stringify(studioPatch), "utf8") > 16 * 1024) {
    return NextResponse.json({ error: "Studio settings exceed the 16 KiB limit" }, { status: 413 })
  }
  if (body.theme_id !== undefined && body.theme_id !== null && (
    typeof body.theme_id !== "string" || body.theme_id.length > 120
  )) {
    return NextResponse.json({ error: "Invalid Circle theme" }, { status: 400 })
  }

  const { id } = await params
  const supabase = createServerClient()
  const { data: circle, error: circleError } = await supabase
    .from("circles")
    .select("id, owner_id, creator_id, settings, theme_id")
    .eq("id", id)
    .maybeSingle()
  if (circleError) return NextResponse.json({ error: "Could not load Circle" }, { status: 500 })
  if (!circle) return NextResponse.json({ error: "Circle not found" }, { status: 404 })

  const { data: member, error: memberError } = await supabase
    .from("circle_members")
    .select("role, status")
    .eq("circle_id", id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (memberError) return NextResponse.json({ error: "Could not verify Circle permissions" }, { status: 500 })

  const isOwner = (circle.owner_id || circle.creator_id) === user.id
  if (!canEditCircleStudio(member?.role, member?.status, isOwner)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const settings = {
    ...(circle.settings || {}),
    community_studio: {
      ...(circle.settings?.community_studio || {}),
      ...studioPatch,
    },
  }
  const updates: Record<string, unknown> = {
    settings,
    updated_at: new Date().toISOString(),
  }
  if (body.theme_id !== undefined) updates.theme_id = body.theme_id

  const { data: updated, error } = await supabase
    .from("circles")
    .update(updates)
    .eq("id", id)
    .select("id, settings, theme_id")
    .single()
  if (error) return NextResponse.json({ error: "Could not save Circle Studio" }, { status: 500 })

  return NextResponse.json({
    success: true,
    studio: updated.settings?.community_studio || {},
    theme_id: updated.theme_id || null,
  })
}

import { type NextRequest, NextResponse } from "next/server"
import { communityClient, logCommunityActivity, canAdmin } from "@/lib/community-engine"
import { getUserFromRequest } from "@/lib/server-auth"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sb = communityClient()

    const { data: membership, error: membershipError } = await sb
      .from("circle_members")
      .select("role, status")
      .eq("circle_id", id)
      .eq("user_id", user.id)
      .maybeSingle()
    if (membershipError) {
      return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 503 })
    }
    if (
      !membership ||
      !["active", "approved"].includes(String(membership.status || "")) ||
      !canAdmin(membership.role)
    ) {
      return NextResponse.json({ error: "Only the founder and admins can evolve this community" }, { status: 403 })
    }

    const body = await request.json()
    const { action, recommendation_id, recommendation } = body
    if (action !== "dismiss" && action !== "apply") {
      return NextResponse.json({ error: "Unsupported evolution action" }, { status: 400 })
    }

    if (action === "dismiss") {
      if (!recommendation_id) return NextResponse.json({ error: "Missing recommendation" }, { status: 400 })
      const { error } = await sb
        .from("community_evolution_recommendations")
        .update({ status: "dismissed" })
        .eq("id", recommendation_id)
        .eq("circle_id", id)
      if (error) return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    // Apply a recommendation — can be a persisted one or a fresh computed one
    const rec = recommendation || null
    if (!rec) return NextResponse.json({ error: "Missing recommendation" }, { status: 400 })

    const applied: string[] = []

    // 1. Feature toggle
    if (rec.payload?.feature) {
      const { data: circle } = await sb.from("circles").select("enabled_features").eq("id", id).maybeSingle()
      const features = { ...((circle?.enabled_features as any) || {}), [rec.payload.feature]: true }
      await sb.from("circles").update({ enabled_features: features }).eq("id", id)
      applied.push(`feature ${rec.payload.feature}`)
    }

    // 2. New space
    if (rec.payload?.space) {
      const s = rec.payload.space
      const { count } = await sb.from("community_spaces").select("id", { count: "exact", head: true }).eq("circle_id", id)
      const { data: space, error } = await sb
        .from("community_spaces")
        .insert({
          circle_id: id,
          name: s.name,
          slug: s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          type: s.type || "discussion",
          icon: s.icon || "hash",
          description: s.description || "Added through community evolution",
          visibility: "members",
          sort_order: count || 0,
          created_by: user.id,
        })
        .select()
        .single()
      if (error) return NextResponse.json({ error: "Failed to add space" }, { status: 500 })
      applied.push(`space "${space.name}"`)
    }

    // 3. Custom role
    if (rec.payload?.role) {
      const r = rec.payload.role
      const { data: circle } = await sb.from("circles").select("custom_roles").eq("id", id).maybeSingle()
      const roles = Array.isArray(circle?.custom_roles) ? circle.custom_roles : []
      if (!roles.some((x: any) => x.name === r.name)) {
        roles.push({ name: r.name, color: r.color || "#8b5cf6", icon: r.icon || "star", permissions: r.permissions || [] })
        await sb.from("circles").update({ custom_roles: roles }).eq("id", id)
        applied.push(`role "${r.name}"`)
      }
    }

    // Persist as applied
    if (recommendation_id) {
      await sb.from("community_evolution_recommendations")
        .update({ status: "applied", applied_at: new Date().toISOString() })
        .eq("id", recommendation_id)
        .eq("circle_id", id)
    } else {
      await sb.from("community_evolution_recommendations").insert({
        circle_id: id,
        kind: rec.kind || "feature",
        title: rec.title || "Applied recommendation",
        description: rec.description || "",
        payload: rec.payload || {},
        status: "applied",
        applied_at: new Date().toISOString(),
      })
    }

    await logCommunityActivity(sb, id, user.id, "community_evolved", "circle", id, { applied })
    return NextResponse.json({ success: true, applied })
  } catch (e: any) {
    console.error("[evolution] POST error:", e)
    return NextResponse.json({ error: e.message || "Failed to apply recommendation" }, { status: 500 })
  }
}
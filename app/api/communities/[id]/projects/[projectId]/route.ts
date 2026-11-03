import { type NextRequest, NextResponse } from "next/server"
import { communityClient, logCommunityActivity, canModerate } from "@/lib/community-engine"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; projectId: string }> }) {
  try {
    const { id, projectId } = await params
    const access = await checkCirclePrivateAccess(id, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const user = await getUserFromRequest(request)
    const sb = communityClient()

    const { data: project, error } = await sb
      .from("community_projects")
      .select(`
        *,
        creator:profiles!created_by(id, username, display_name, avatar_url, is_verified),
        members:community_project_members(user_id, role, joined_at, user:profiles!user_id(id, username, display_name, avatar_url)),
        tasks:community_project_tasks(*)
      `)
      .eq("id", projectId)
      .eq("circle_id", id)
      .single()

    if (error || !project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const tasks = project.tasks || []
    const done = tasks.filter((t: any) => t.status === "done").length
    const progress = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : project.progress || 0

    const isContributor = Boolean(
      user && (project.members || []).some((m: any) => m.user_id === user.id)
    )

    return NextResponse.json({
      project: { ...project, progress, done_task_count: done, task_count: tasks.length },
      is_contributor: isContributor,
      is_lead: Boolean(user && (project.members || []).some((m: any) => m.user_id === user.id && m.role === "lead")),
    })
  } catch (e: any) {
    console.error("[project] GET error:", e)
    return NextResponse.json({ error: e.message || "Failed to load project" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; projectId: string }> }) {
  try {
    const { id, projectId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sb = communityClient()

    const { data: membership } = await sb.from("circle_members").select("role").eq("circle_id", id).eq("user_id", user.id).maybeSingle()
    const { data: contributor } = await sb.from("community_project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle()

    const canEdit = canModerate(membership?.role) || contributor?.role === "lead"
    if (!canEdit) return NextResponse.json({ error: "Only leads and moderators can edit this project" }, { status: 403 })

    const body = await request.json()
    const allowed: Record<string, any> = {}
    for (const key of ["title", "description", "cover_url", "status", "tags", "progress"]) {
      if (body[key] !== undefined) allowed[key] = body[key]
    }
    allowed.updated_at = new Date().toISOString()

    const { data: project, error } = await sb
      .from("community_projects")
      .update(allowed)
      .eq("id", projectId)
      .eq("circle_id", id)
      .select()
      .single()
    if (error || !project) return NextResponse.json({ error: "Failed to update project" }, { status: 500 })

    await logCommunityActivity(sb, id, user.id, "project_updated", "project", projectId, { title: project.title, status: project.status })
    return NextResponse.json({ project })
  } catch (e: any) {
    console.error("[project] PATCH error:", e)
    return NextResponse.json({ error: e.message || "Failed to update project" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; projectId: string }> }) {
  try {
    const { id, projectId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sb = communityClient()

    const { data: membership } = await sb.from("circle_members").select("role").eq("circle_id", id).eq("user_id", user.id).maybeSingle()
    const { data: contributor } = await sb.from("community_project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle()
    const canEdit = canModerate(membership?.role) || contributor?.role === "lead"
    if (!canEdit) return NextResponse.json({ error: "Not allowed" }, { status: 403 })

    const { error } = await sb.from("community_projects").delete().eq("id", projectId).eq("circle_id", id)
    if (error) return NextResponse.json({ error: "Failed to delete project" }, { status: 500 })
    await logCommunityActivity(sb, id, user.id, "project_deleted", "project", projectId)
    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error("[project] DELETE error:", e)
    return NextResponse.json({ error: e.message || "Failed to delete project" }, { status: 500 })
  }
}

/** Join or leave a project (POST with { action: "join" | "leave" }) */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; projectId: string }> }) {
  try {
    const { id, projectId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Sign in to join projects" }, { status: 401 })
    const sb = communityClient()

    const { data: membership } = await sb.from("circle_members").select("status").eq("circle_id", id).eq("user_id", user.id).maybeSingle()
    if (membership?.status !== "active") return NextResponse.json({ error: "Join the community first" }, { status: 403 })

    const { data: project } = await sb.from("community_projects").select("id").eq("id", projectId).eq("circle_id", id).maybeSingle()
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const body = await request.json()
    const action = body?.action || "join"

    if (action === "leave") {
      await sb.from("community_project_members").delete().eq("project_id", projectId).eq("user_id", user.id)
      return NextResponse.json({ success: true, joined: false })
    }

    const { data: existing } = await sb
      .from("community_project_members")
      .select("id")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!existing) {
      await sb.from("community_project_members").insert({ project_id: projectId, user_id: user.id, role: "contributor" })
      await logCommunityActivity(sb, id, user.id, "project_joined", "project", projectId)
    }
    return NextResponse.json({ success: true, joined: true })
  } catch (e: any) {
    console.error("[project] POST error:", e)
    return NextResponse.json({ error: e.message || "Failed to join project" }, { status: 500 })
  }
}
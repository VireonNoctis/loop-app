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

    const sb = communityClient()

    const { data: tasks, error } = await sb
      .from("community_project_tasks")
      .select(`
        *,
        assignee:profiles!assigned_to(id, username, display_name, avatar_url)
      `)
      .eq("project_id", projectId)
      .order("sort_order")
    if (error) return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 })
    return NextResponse.json({ tasks: tasks || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to load tasks" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; projectId: string }> }) {
  try {
    const { id, projectId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sb = communityClient()

    const { data: contributor } = await sb
      .from("community_project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle()
    const { data: membership } = await sb.from("circle_members").select("role").eq("circle_id", id).eq("user_id", user.id).maybeSingle()

    const canEdit = Boolean(contributor) || canModerate(membership?.role)
    if (!canEdit) return NextResponse.json({ error: "Join the project to manage tasks" }, { status: 403 })

    const body = await request.json()
    const { action, title, description = "", assigned_to, status } = body

    if (action === "update") {
      const { task_id, ...updates } = body
      const allowed: Record<string, any> = {}
      for (const key of ["title", "description", "assigned_to", "status", "sort_order", "priority", "due_date"]) {
        if (updates[key] !== undefined) allowed[key] = updates[key]
      }
      // Validate priority if provided (server-side, never trust the client)
      if (allowed.priority !== undefined) {
        const validPriorities = ["low", "medium", "high", "urgent"]
        allowed.priority = validPriorities.includes(allowed.priority) ? allowed.priority : "medium"
      }
      if (allowed.due_date !== undefined) {
        allowed.due_date = allowed.due_date ? new Date(allowed.due_date).toISOString() : null
      }
      if (allowed.status === "done") allowed.completed_at = new Date().toISOString()
      if (allowed.status && allowed.status !== "done") allowed.completed_at = null

      const { data: task, error } = await sb
        .from("community_project_tasks")
        .update(allowed)
        .eq("id", task_id)
        .eq("project_id", projectId)
        .select()
        .single()
      if (error || !task) return NextResponse.json({ error: "Failed to update task" }, { status: 500 })
      if (allowed.status) await logCommunityActivity(sb, id, user.id, "task_updated", "task", task.id, { status: allowed.status })

      // Keep project progress in sync
      await syncProjectProgress(sb, projectId)
      return NextResponse.json({ task })
    }

    if (action === "delete") {
      const { error } = await sb.from("community_project_tasks").delete().eq("id", body.task_id).eq("project_id", projectId)
      if (error) return NextResponse.json({ error: "Failed to delete task" }, { status: 500 })
      await syncProjectProgress(sb, projectId)
      return NextResponse.json({ success: true })
    }

    // Default: create
    if (!title || !title.trim()) return NextResponse.json({ error: "Task needs a title" }, { status: 400 })
    const { count } = await sb.from("community_project_tasks").select("id", { count: "exact", head: true }).eq("project_id", projectId)
    const validPriorities = ["low", "medium", "high", "urgent"]
    const priority = validPriorities.includes(body.priority) ? body.priority : "medium"
    const due_date = body.due_date ? new Date(body.due_date).toISOString() : null
    const { data: task, error } = await sb
      .from("community_project_tasks")
      .insert({
        project_id: projectId,
        title: title.trim().slice(0, 200),
        description: description.slice(0, 1000),
        assigned_to: assigned_to || null,
        status: status || "todo",
        priority,
        due_date,
        created_by: user.id,
        sort_order: count || 0,
      })
      .select()
      .single()

    if (error || !task) return NextResponse.json({ error: "Failed to create task" }, { status: 500 })
    await logCommunityActivity(sb, id, user.id, "task_created", "task", task.id, { title: task.title })
    await syncProjectProgress(sb, projectId)
    return NextResponse.json({ task }, { status: 201 })
  } catch (e: any) {
    console.error("[tasks] POST error:", e)
    return NextResponse.json({ error: e.message || "Failed to manage tasks" }, { status: 500 })
  }
}

async function syncProjectProgress(sb: any, projectId: number | string) {
  const { data: tasks } = await sb.from("community_project_tasks").select("status").eq("project_id", projectId)
  const total = tasks?.length || 0
  const done = (tasks || []).filter((t: any) => t.status === "done").length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0
  await sb.from("community_projects").update({ progress }).eq("id", projectId)
}
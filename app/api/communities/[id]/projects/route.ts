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

    const { data: projects, error } = await sb
      .from("community_projects")
      .select(`
        *,
        creator:profiles!created_by(id, username, display_name, avatar_url, is_verified),
        contributors:community_project_members(count),
        tasks:community_project_tasks(count),
        done_tasks:community_project_tasks(count)
      `)
      .eq("circle_id", id)
      .order("created_at", { ascending: false })
      .limit(30)

    if (error) return NextResponse.json({ error: "Failed to load projects" }, { status: 500 })

    // done_tasks count needs a filter — post-process
    const taskCounts = new Map<number, { total: number; done: number }>()
    if (projects && projects.length > 0) {
      const projectIds = projects.map((p) => p.id)
      const { data: tasks } = await sb
        .from("community_project_tasks")
        .select("project_id, status")
        .in("project_id", projectIds)
      for (const t of tasks || []) {
        const cur = taskCounts.get(t.project_id) || { total: 0, done: 0 }
        cur.total++
        if (t.status === "done") cur.done++
        taskCounts.set(t.project_id, cur)
      }
    }

    const enriched = (projects || []).map((p) => {
      const counts = taskCounts.get(p.id) || { total: 0, done: 0 }
      const progress = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : p.progress || 0
      return {
        ...p,
        progress,
        contributor_count: Number(Array.isArray(p.contributors) ? p.contributors[0]?.count : p.contributors || 0),
        task_count: counts.total,
        done_task_count: counts.done,
        tasks: undefined,
        done_tasks: undefined,
        contributors: undefined,
      }
    })

    return NextResponse.json({ projects: enriched })
  } catch (e: any) {
    console.error("[projects] GET error:", e)
    return NextResponse.json({ error: e.message || "Failed to load projects" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Sign in to create a project" }, { status: 401 })
    const sb = communityClient()

    const { data: membership } = await sb.from("circle_members").select("role, status").eq("circle_id", id).eq("user_id", user.id).maybeSingle()
    if (membership?.status !== "active") return NextResponse.json({ error: "Join the community first" }, { status: 403 })

    const body = await request.json()
    const { title, description = "", cover_url, tags = [] } = body
    if (!title || !title.trim()) return NextResponse.json({ error: "Project needs a title" }, { status: 400 })

    const { data: project, error } = await sb
      .from("community_projects")
      .insert({
        circle_id: id,
        title: title.trim().slice(0, 120),
        description: description.slice(0, 3000),
        cover_url: cover_url || null,
        tags: Array.isArray(tags) ? tags.slice(0, 15) : [],
        created_by: user.id,
      })
      .select()
      .single()

    if (error || !project) {
      return NextResponse.json({ error: "Failed to create project: " + (error?.message || "") }, { status: 500 })
    }

    // Creator becomes lead contributor
    await sb.from("community_project_members").insert({ project_id: project.id, user_id: user.id, role: "lead" })
    await logCommunityActivity(sb, id, user.id, "project_created", "project", project.id, { title: project.title })

    return NextResponse.json({ project }, { status: 201 })
  } catch (e: any) {
    console.error("[projects] POST error:", e)
    return NextResponse.json({ error: e.message || "Failed to create project" }, { status: 500 })
  }
}
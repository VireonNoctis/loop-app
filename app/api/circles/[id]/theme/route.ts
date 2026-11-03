import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"
import { validateThemeConfig, type CircleThemeConfig } from "@/lib/circle-themes"

function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing Supabase configuration")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/** GET — Fetch the theme_config for a circle */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await checkCirclePrivateAccess(id, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const supabase = createServerClient()

    const { data: circle, error } = await supabase
      .from("circles")
      .select("theme_config")
      .eq("id", id)
      .single()

    if (error || !circle) {
      return NextResponse.json({ error: "Circle not found" }, { status: 404 })
    }

    const theme = validateThemeConfig(circle.theme_config)
    return NextResponse.json({ success: true, theme })
  } catch (error) {
    console.error("Error fetching circle theme:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** PUT — Update the theme_config for a circle (owner/admin only) */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const supabase = createServerClient()

    // Check ownership/admin
    const { data: circle } = await supabase
      .from("circles")
      .select("owner_id, creator_id")
      .eq("id", id)
      .single()

    if (!circle) return NextResponse.json({ error: "Circle not found" }, { status: 404 })
    if (circle.owner_id !== user.id && circle.creator_id !== user.id) {
      // Check admin membership
      const { data: member } = await supabase
        .from("circle_members")
        .select("role")
        .eq("circle_id", id)
        .eq("user_id", user.id)
        .maybeSingle()

      if (!member || !["owner", "admin"].includes(member.role)) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
      }
    }

    const body = await request.json()
    const themeConfig = validateThemeConfig(body.theme_config)

    const { error: updateError } = await supabase
      .from("circles")
      .update({ theme_config: themeConfig })
      .eq("id", id)

    if (updateError) {
      console.error("Error updating circle theme:", updateError)
      return NextResponse.json({ error: "Failed to update theme" }, { status: 500 })
    }

    return NextResponse.json({ success: true, theme: themeConfig })
  } catch (error) {
    console.error("Error updating circle theme:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

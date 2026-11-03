import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { mergeDiscoveryPreferences, normalizeDiscoveryPreferences } from "@/lib/discovery-preferences"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { data, error } = await createServerClient().from("profiles")
    .select("discovery_preferences").eq("id", user.id).maybeSingle()
  if (error || !data) {
    console.error("Discover preferences lookup failed:", error)
    return NextResponse.json({ error: "Could not load Discover preferences" }, { status: 500 })
  }
  return NextResponse.json({ success: true, preferences: normalizeDiscoveryPreferences(data.discovery_preferences) })
}

export async function PUT(request: NextRequest) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a preferences object" }, { status: 400 })
  }
  const supabase = createServerClient()
  const { data: profile, error: readError } = await supabase.from("profiles")
    .select("discovery_preferences").eq("id", user.id).maybeSingle()
  if (readError || !profile) {
    console.error("Discover preferences lookup failed:", readError)
    return NextResponse.json({ error: "Could not load Discover preferences" }, { status: 500 })
  }
  const merged = mergeDiscoveryPreferences(profile.discovery_preferences, body)
  if (!merged.ok) return NextResponse.json({ error: merged.error }, { status: 400 })
  const { data, error } = await supabase.from("profiles")
    .update({ discovery_preferences: merged.value }).eq("id", user.id)
    .select("discovery_preferences").maybeSingle()
  if (error || !data) {
    console.error("Discover preferences update failed:", error)
    return NextResponse.json({ error: "Could not save Discover preferences" }, { status: 500 })
  }
  return NextResponse.json({ success: true, preferences: normalizeDiscoveryPreferences(data.discovery_preferences) })
}

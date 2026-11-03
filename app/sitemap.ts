import type { MetadataRoute } from "next"
import { createServerClient } from "@/lib/supabase"

// Dynamic sitemap — regenerated hourly. Google currently crawls the site
// without a sitemap (robots.txt already points at /sitemap.xml but the file
// never existed), which contributes to the "not indexed" and 5xx crawl
// issues in Search Console.
export const revalidate = 3600

const BASE = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://loopapp.me"

const STATIC_ROUTES: Array<{ path: string; priority?: number; changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
  { path: "", priority: 1.0, changeFrequency: "hourly" },
  { path: "/explore", priority: 0.9, changeFrequency: "hourly" },
  { path: "/trending", priority: 0.9, changeFrequency: "hourly" },
  { path: "/developers", priority: 0.7, changeFrequency: "weekly" },
  { path: "/events", priority: 0.7, changeFrequency: "weekly" },
  { path: "/games", priority: 0.6, changeFrequency: "weekly" },
  { path: "/marketplace", priority: 0.6, changeFrequency: "weekly" },
  { path: "/verification", priority: 0.5, changeFrequency: "monthly" },
  { path: "/help", priority: 0.4, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${BASE}${route.path}`,
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))

  const supabase = createServerClient()

  // Public profiles (users with a username)
  try {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("username, updated_at")
      .not("username", "is", null)
      .limit(10000)
    for (const profile of profiles || []) {
      if (!profile.username) continue
      entries.push({
        url: `${BASE}/profile/${profile.username}`,
        lastModified: profile.updated_at ? new Date(profile.updated_at) : new Date(),
        changeFrequency: "weekly",
        priority: 0.8,
      })
    }
  } catch (error) {
    console.error("sitemap: profiles query failed:", error)
  }

  // Active communities (circles)
  try {
    const { data: circles } = await supabase
      .from("circles")
      .select("id, updated_at")
      .eq("is_active", true)
      .limit(2000)
    for (const circle of circles || []) {
      entries.push({
        url: `${BASE}/circles/${circle.id}`,
        lastModified: circle.updated_at ? new Date(circle.updated_at) : new Date(),
        changeFrequency: "daily",
        priority: 0.8,
      })
    }
  } catch (error) {
    console.error("sitemap: circles query failed:", error)
  }

  // Recent loops (deep links bring most crawl value)
  try {
    const { data: loops } = await supabase
      .from("loops")
      .select("id, created_at")
      .order("created_at", { ascending: false })
      .limit(500)
    for (const loop of loops || []) {
      entries.push({
        url: `${BASE}/loop/${loop.id}`,
        lastModified: loop.created_at ? new Date(loop.created_at) : new Date(),
        changeFrequency: "weekly",
        priority: 0.7,
      })
    }
  } catch (error) {
    console.error("sitemap: loops query failed:", error)
  }

  return entries
}
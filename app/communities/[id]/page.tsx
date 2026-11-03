import { Metadata } from "next"
import { Header } from "@/components/header"
import { ForumHome } from "@/components/communities/forum/forum-home"
import { createClient } from "@/lib/supabase"
import { getAbsoluteAppUrl } from "@/lib/app-url"
import { buildOgMetadata } from "@/lib/og/metadata"

export const dynamic = "force-dynamic"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder",
)

interface CommunityPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: CommunityPageProps): Promise<Metadata> {
  const { id } = await params
  const baseUrl = await getAbsoluteAppUrl()

  let title = "Community — Loop Social OS"
  let description = "Join a community on Loop Social OS, build together, and watch it evolve."
  let avatarUrl = ""
  let bannerUrl = ""
  let communityName = ""
  let category = ""
  let isPrivate = false
  let isVerified = false
  let memberCount = 0

  try {
    const [{ data: circle }, { count }] = await Promise.all([
      supabase
        .from("circles")
        .select("name, description, avatar_url, banner_url, category, is_private, is_verified")
        .eq("id", id)
        .single(),
      supabase
        .from("circle_members")
        .select("id", { count: "exact", head: true })
        .eq("circle_id", id)
        .eq("status", "active"),
    ])

    if (circle?.is_private) {
      // Metadata is fetched without a viewer session, so never expose private
      // Circle identity, artwork, description or member count in link previews.
      title = "Private Circle — Loop"
      description = "This Circle is private. Sign in and request access to view it."
      isPrivate = true
      memberCount = 0
    } else if (circle) {
      title = `${circle.name} — Circle on Loop`
      if (circle.description) description = circle.description.slice(0, 160)
      avatarUrl = circle.avatar_url || ""
      communityName = circle.name || ""
      bannerUrl = (circle as any).banner_url || ""
      category = circle.category || ""
      isVerified = Boolean(circle.is_verified)
      memberCount = count || 0
    }
  } catch (err) {
    console.error("Error generating community metadata:", err)
  }

  return buildOgMetadata({
    baseUrl,
    path: `/communities/${id}`,
    type: "community",
    title,
    description,
    params: {
      name: communityName,
      avatar: avatarUrl,
      media: bannerUrl,
      category,
      is_private: isPrivate,
      verified: isVerified,
      stat: memberCount || undefined,
      stat_label: memberCount === 1 ? "member" : "members",
      url: `loopapp.me/communities/${id}`,
    },
  })
}

export default async function CommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="w-full py-4">
        <ForumHome communityId={id} />
      </main>
    </div>
  )
}

import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"
import { isCommunityMember, canModerateCommunity, newBotToken, logBotActivity, type BotRow } from "@/lib/bot-helpers"

export const dynamic = "force-dynamic"

/** GET /api/communities/[id]/bots — every bot in the community + live status. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: communityId } = await params
    const access = await checkCirclePrivateAccess(communityId, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const supabase = createServerClient()
    const currentUser = await getUserFromRequest(request)

    const { data: rows, error } = await supabase
      .from("community_bots")
      .select(`
        *,
        owner:profiles!owner_id(id, username, display_name, avatar_url, is_verified)
      `)
      .eq("community_id", communityId)
      .order("created_at", { ascending: false })

    if (error) return NextResponse.json({ error: "Failed to load bots" }, { status: 500 })

    const bots: BotRow[] = rows || []

    // Attach activity + chat counts so cards feel alive.
    const botIds = bots.map((b) => b.id)
    if (botIds.length > 0) {
      const [act, chat] = await Promise.all([
        supabase.from("bot_activity").select("bot_id", { count: "exact", head: false }).in("bot_id", botIds),
        supabase.from("bot_chat_messages").select("bot_id", { count: "exact", head: false }).in("bot_id", botIds),
      ])
      const actCount = new Map<string, number>()
      for (const r of act.data || []) actCount.set(r.bot_id, (actCount.get(r.bot_id) || 0) + 1)
      const chatCount = new Map<string, number>()
      for (const r of chat.data || []) chatCount.set(r.bot_id, (chatCount.get(r.bot_id) || 0) + 1)
      for (const b of bots) {
        b.activity_count = actCount.get(b.id) || 0
        b.chat_count = chatCount.get(b.id) || 0
      }
    }

    return NextResponse.json({
      success: true,
      bots: bots.map((b) => ({
        ...b,
        secret_token: currentUser && b.owner_id === currentUser.id ? b.secret_token : undefined,
      })),
    })
  } catch (e: any) {
    console.error("list bots error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** POST /api/communities/[id]/bots — create + deploy a new bot. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: communityId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const supabase = createServerClient()

    const member = await isCommunityMember(supabase, communityId, user.id)
    const mod = await canModerateCommunity(supabase, communityId, user.id)
    if (!member && !mod) {
      return NextResponse.json({ error: "Join the community to add bots" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const name = String(body.name || "").trim()
    if (!name || name.length > 60) {
      return NextResponse.json({ error: "Bot name is required (max 60 characters)" }, { status: 400 })
    }
    const deploymentType = body.deployment_type === "source" ? "source" : "hosted"
    const secret = newBotToken()

    const { data: bot, error } = await supabase
      .from("community_bots")
      .insert({
        community_id: communityId,
        owner_id: user.id,
        name,
        slug: String(body.slug || "").trim() || undefined,
        description: String(body.description || "").slice(0, 500),
        avatar_url: body.avatar_url || null,
        category: String(body.category || "utility").slice(0, 40),
        deployment_type: deploymentType,
        webhook_url: body.webhook_url || null,
        invite_link: body.invite_link || null,
        source_url: body.source_url || null,
        auto_reply: String(body.auto_reply || "").slice(0, 500) || null,
        commands: Array.isArray(body.commands) ? body.commands.map(String).slice(0, 50) : [],
        secret_token: secret,
      })
      .select(`*, owner:profiles!owner_id(id, username, display_name, avatar_url, is_verified)`)
      .single()

    if (error || !bot) {
      if (String(error?.message || "").includes("duplicate")) {
        return NextResponse.json({ error: "A bot with this name already exists in the community" }, { status: 409 })
      }
      return NextResponse.json({ error: "Failed to create bot" }, { status: 500 })
    }

    await logBotActivity(supabase, {
      bot_id: bot.id,
      community_id: communityId,
      actor_id: user.id,
      type: "created",
      title: `${bot.name} went live`,
      message: `${user.user_metadata?.username || user.name || "A member"} deployed ${bot.name} in this community.`,
    })

    return NextResponse.json({ success: true, bot, secret_token: secret }, { status: 201 })
  } catch (e: any) {
    console.error("create bot error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { can } from "@/lib/community-permissions"
import { getUserFromRequest } from "@/lib/server-auth"
import { GoogleGenAI } from "@google/genai"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: circleId } = await params
    const body = await request.json().catch(() => ({}))
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Circle bots are unavailable" }, { status: 503 })
    }
    const triggerType = String(body.trigger_type || "chat")
    if (!["welcome", "chat", "moderation"].includes(triggerType)) {
      return NextResponse.json({ error: "Unsupported bot trigger" }, { status: 400 })
    }
    const userMessage = String(body.message || "").trim().slice(0, 1500)
    const supabase = createServerClient()

    const { data: membership, error: membershipError } = await supabase
      .from("circle_members")
      .select("role, status, permissions, is_muted, muted_until")
      .eq("circle_id", circleId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (membershipError) return NextResponse.json({ error: "Could not verify Circle membership" }, { status: 503 })
    if (!membership || !["active", "approved"].includes(String(membership.status || ""))) {
      return NextResponse.json({ error: "Join this Circle before using its bots" }, { status: 403 })
    }
    if (membership.is_muted && (!membership.muted_until || new Date(membership.muted_until).getTime() > Date.now())) {
      return NextResponse.json({ error: "Muted members cannot trigger Circle bots" }, { status: 403 })
    }

    const isStaff = ["owner", "admin", "moderator"].includes(String(membership.role || ""))
    if (triggerType === "moderation" && !isStaff) {
      return NextResponse.json({ error: "Only Circle staff can run moderation bot actions" }, { status: 403 })
    }
    if (
      body.save_as_post &&
      !isStaff &&
      !(Array.isArray(membership.permissions) && can(membership.permissions, "post.create"))
    ) {
      return NextResponse.json({ error: "You do not have permission to create Circle posts" }, { status: 403 })
    }

    // Get active circle bots
    const { data: botConfig } = await supabase
      .from("circle_bots")
      .select("*")
      .eq("circle_id", circleId)
      .eq("enabled", true)
      .maybeSingle()

    // Get Circle metadata
    const { data: circle } = await supabase
      .from("circles")
      .select("id, name, description")
      .eq("id", circleId)
      .single()

    const circleName = circle?.name || "the Circle"

    let replyMessage = ""
    let botName = botConfig?.name || "Loop AI Assistant"

    if (triggerType === "welcome") {
      replyMessage = `👋 Welcome to ${circleName}! I'm ${botName}. Feel free to ask any questions or share your thoughts with the community!`
    } else if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
        const prompt = `You are ${botName}, an helpful and friendly AI bot inside the online community circle "${circleName}".
Circle Description: ${circle?.description || "A community of creators and enthusiasts."}
User message: "${userMessage}"
Generate a short, engaging response under 3 sentences as the circle bot.`

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
        })
        replyMessage = response.text || `Thanks for sharing in ${circleName}!`
      } catch (err) {
        console.error("Gemini AI bot generation error:", err)
        replyMessage = `Hello from ${botName}! I'm here to help answer questions in ${circleName}.`
      }
    } else {
      replyMessage = `🤖 [${botName}]: Thanks for posting in ${circleName}! Let us know if you have any questions.`
    }

    // Insert bot post/reply into circle posts if requested
    // (circle_posts uses author_id, not user_id)
    if (body.save_as_post) {
      await supabase.from("circle_posts").insert({
        circle_id: circleId,
        author_id: user.id, // Or bot virtual post
        content: `🤖 **${botName}**: ${replyMessage}`,
        created_at: new Date().toISOString()
      })
    }

    return NextResponse.json({
      success: true,
      bot_name: botName,
      reply: replyMessage
    })
  } catch (error) {
    console.error("Bot trigger error:", error)
    return NextResponse.json({ error: "Failed to trigger bot" }, { status: 500 })
  }
}

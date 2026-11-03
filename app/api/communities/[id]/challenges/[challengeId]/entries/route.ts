import { type NextRequest, NextResponse } from "next/server"
import { communityClient, logCommunityActivity, canModerate } from "@/lib/community-engine"
import { getUserFromRequest } from "@/lib/server-auth"
import { checkCirclePrivateAccess } from "@/lib/circle-access"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; challengeId: string }> }) {
  try {
    const { id, challengeId } = await params
    const user = await getUserFromRequest(request)
    const sb = communityClient()

    const { data: challenge } = await sb.from("circle_challenges").select("id, circle_id").eq("id", challengeId).eq("circle_id", id).maybeSingle()
    if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 })

    const access = await checkCirclePrivateAccess(id, request.headers.get("authorization"))
    if (access.isPrivate && !access.canView) {
      return NextResponse.json({ error: "This Circle is private", locked: true }, { status: 403 })
    }

    const { data: entries, error } = await sb
      .from("community_challenge_entries")
      .select(`
        *,
        author:profiles!user_id(id, username, display_name, avatar_url, is_verified),
        votes:community_challenge_votes(user_id)
      `)
      .eq("challenge_id", challengeId)
      .order("vote_count", { ascending: false })
      .limit(50)

    if (error) return NextResponse.json({ error: "Failed to load entries" }, { status: 500 })

    const enriched = (entries || []).map((e: any) => ({
      ...e,
      has_voted: Boolean(user && (e.votes || []).some((v: any) => v.user_id === user.id)),
      votes: undefined,
    }))

    return NextResponse.json({ entries: enriched })
  } catch (e: any) {
    console.error("[entries] GET error:", e)
    return NextResponse.json({ error: e.message || "Failed to load entries" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; challengeId: string }> }) {
  try {
    const { id, challengeId } = await params
    const user = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ error: "Sign in to submit" }, { status: 401 })
    const sb = communityClient()

    const { data: membership } = await sb
      .from("circle_members")
      .select("status")
      .eq("circle_id", id)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!membership || !["active", "approved"].includes(String(membership.status))) {
      return NextResponse.json({ error: "Join the Circle first" }, { status: 403 })
    }

    const { data: challenge } = await sb
      .from("circle_challenges")
      .select("id, status, starts_at, ends_at")
      .eq("id", challengeId)
      .eq("circle_id", id)
      .maybeSingle()
    if (!challenge) return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
    if (challenge.status !== "active") return NextResponse.json({ error: "This challenge is closed" }, { status: 400 })

    const now = Date.now()
    const startsAt = challenge.starts_at ? new Date(challenge.starts_at).getTime() : 0
    const endsAt = challenge.ends_at ? new Date(challenge.ends_at).getTime() : Number.POSITIVE_INFINITY
    if (startsAt > now) return NextResponse.json({ error: "This Drop has not started yet" }, { status: 400 })
    if (endsAt < now) return NextResponse.json({ error: "This Drop has ended" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const action = typeof body.action === "string" ? body.action : ""
    const content = typeof body.content === "string" ? body.content.trim() : ""
    const mediaUrl = typeof body.media_url === "string" ? body.media_url.trim() : ""

    if (mediaUrl) {
      let parsed: URL
      try {
        parsed = new URL(mediaUrl)
      } catch {
        return NextResponse.json({ error: "The image URL is invalid" }, { status: 400 })
      }
      if (parsed.protocol !== "https:") {
        return NextResponse.json({ error: "Uploaded media must use HTTPS" }, { status: 400 })
      }
    }

    // Vote on an entry
    if (action === "vote") {
      const entryId = typeof body.entry_id === "string" ? body.entry_id : ""
      const { data: entry } = await sb
        .from("community_challenge_entries")
        .select("id, user_id")
        .eq("id", entryId)
        .eq("challenge_id", challengeId)
        .maybeSingle()
      if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 })
      if (entry.user_id === user.id) {
        return NextResponse.json({ error: "You cannot vote for your own entry" }, { status: 400 })
      }

      const { data: existing } = await sb
        .from("community_challenge_votes")
        .select("id")
        .eq("entry_id", entryId)
        .eq("user_id", user.id)
        .maybeSingle()

      let voted: boolean
      if (existing) {
        const { error: deleteError } = await sb
          .from("community_challenge_votes")
          .delete()
          .eq("id", existing.id)
        if (deleteError) return NextResponse.json({ error: "Could not remove your vote" }, { status: 500 })
        voted = false
      } else {
        const { error: insertError } = await sb
          .from("community_challenge_votes")
          .insert({ entry_id: entryId, user_id: user.id })
        if (insertError) return NextResponse.json({ error: "Could not record your vote" }, { status: 500 })
        voted = true
        await logCommunityActivity(sb, id, user.id, "challenge_vote", "challenge_entry", entryId)
      }

      const { count, error: countError } = await sb
        .from("community_challenge_votes")
        .select("id", { count: "exact", head: true })
        .eq("entry_id", entryId)
      if (countError) return NextResponse.json({ error: "Vote was saved but the total could not refresh" }, { status: 500 })

      const voteCount = count || 0
      const { error: countUpdateError } = await sb
        .from("community_challenge_entries")
        .update({ vote_count: voteCount })
        .eq("id", entryId)
      if (countUpdateError) return NextResponse.json({ error: "Vote was saved but the total could not refresh" }, { status: 500 })

      return NextResponse.json({ success: true, voted, vote_count: voteCount })
    }

    // Creative submissions are text/image contributions only. Votes are
    // community feedback and carry no coins, stakes or payouts.
    if (content.length > 2000) return NextResponse.json({ error: "Entry text is too long" }, { status: 400 })
    if (!content && !mediaUrl) return NextResponse.json({ error: "Add some text or an image" }, { status: 400 })
    const { data: entry, error } = await sb
      .from("community_challenge_entries")
      .insert({
        challenge_id: challengeId,
        user_id: user.id,
        content,
        media_url: mediaUrl || null,
      })
      .select()
      .single()

    if (error || !entry) return NextResponse.json({ error: "Failed to submit entry" }, { status: 500 })
    await logCommunityActivity(sb, id, user.id, "challenge_entry", "challenge_entry", entry.id, { challenge_id: challengeId })
    return NextResponse.json({ entry }, { status: 201 })
  } catch (e: any) {
    console.error("[entries] POST error:", e)
    return NextResponse.json({ error: e.message || "Failed to submit" }, { status: 500 })
  }
}
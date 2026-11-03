import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { normalizeLoops } from "@/lib/normalize-loop"
import { enrichLoopsWithPollsAndDuels } from "@/lib/enrich-loops"
import { applyRealCommentCounts, applyRealBranchCounts } from "@/lib/loop-stats" 
import { getUserFromRequest } from "@/lib/server-auth"
import { diversifyByAuthor } from "@/lib/discovery-ranking"
import { isCirclePubliclyDiscoverable } from "@/lib/circle-membership-state"
import { normalizeDiscoveryPreferences } from "@/lib/discovery-preferences"
import { filterPrivateContent, getFollowingIds, getPrivateProfileIds, getBlockedProfileIds } from "@/lib/privacy"
import { filterCircleScopedContent } from "@/lib/circle-content-privacy"

function engagementScore(loop: any) {
  const stats = Array.isArray(loop.loop_stats) ? loop.loop_stats[0] : loop.loop_stats
  return (
    Number(stats?.likes_count || 0) * 3 +
    Number(stats?.comments_count || 0) * 4 +
    Number(stats?.branches_count || 0) * 5 +
    Number(stats?.shares_count || 0) * 4 +
    Number(stats?.views_count || 0)
  )
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") || "hashtags"
    const sort = searchParams.get("sort") || "recent"
    const limit = Math.max(1, Math.min(Number.parseInt(searchParams.get("limit") || "20", 10) || 20, 50))
    const requestedOffset = Number.parseInt(searchParams.get("offset") || "0", 10)
    const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.min(requestedOffset, 500)) : 0
    const daysBack = Math.min(Math.max(Number.parseInt(searchParams.get("days") || "7", 10) || 7, 1), 30)
    const user = await getUserFromRequest(request)

    switch (type) {
      case "hashtags": {
        const { data: hashtags, error: hashtagError } = await supabase.rpc("get_trending_hashtags", {
          days_back: daysBack,
          result_limit: limit,
        })

        if (hashtagError) {
          const { data: loops } = await supabase
            .from("loops")
            .select("hashtags, author_id, circle_id")
            .eq("visibility", "public")
            .is("parent_loop_id", null)
            .not("hashtags", "is", null)
            .order("created_at", { ascending: false })
            .limit(120)

          const following = await getFollowingIds(supabase, user?.id || null)
          let visibleLoops = await filterPrivateContent(supabase, loops || [], user?.id || null, following)
          visibleLoops = await filterCircleScopedContent(supabase, visibleLoops, user?.id || null)

          const counts = new Map<string, number>()
          for (const loop of visibleLoops) {
            for (const tag of loop.hashtags || []) {
              const key = String(tag).toLowerCase().replace(/^#/, "")
              if (!key) continue
              counts.set(key, (counts.get(key) || 0) + 1)
            }
          }

          const derived = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([tag, usage_count]) => ({ tag, usage_count, count: usage_count, growth: "live" }))

          return NextResponse.json({ success: true, data: derived, hashtags: derived })
        }

        const normalized = (hashtags || []).map((row: any) => ({
          tag: row.tag || row.hashtag,
          usage_count: Number(row.usage_count ?? row.count ?? 0),
          count: Number(row.usage_count ?? row.count ?? 0),
          growth: row.growth ?? "hot",
        }))
        return NextResponse.json({ success: true, data: normalized, hashtags: normalized })
      }

      case "users": {
        const { data: users, error: usersError } = await supabase
          .from("profiles")
          .select(
            "id, username, display_name, avatar_url, video_avatar_url, is_verified, is_premium, bio, followers_count, loops_count, created_at",
          )
          .order("followers_count", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(limit)

        if (usersError) {
          return NextResponse.json({ error: "Failed to fetch trending users" }, { status: 500 })
        }

        // Private profiles never rank in trending users unless the viewer
        // already follows them.
        const following = await getFollowingIds(supabase, user?.id || null)
        const hiddenIds = await getBlockedProfileIds(supabase, user?.id || null, (users || []).map((entry: any) => entry.id))
        const privateIds = await getPrivateProfileIds(supabase, (users || []).map((u: any) => u.id))
        const visible = (users || []).filter((u: any) => {
          if (user && u.id === user.id) return true
          if (hiddenIds.has(u.id)) return false
          if (!privateIds.has(u.id)) return true
          return following.has(u.id)
        })

        return NextResponse.json({ success: true, data: visible })
      }

      case "discovery": {
        // Participation discovery — answers "what can I participate in right
        // now?": active duels, open co-loops, growing circles, rising creators.
        const nowIso = new Date().toISOString()

        const [duelsRes, coLoopsRes, circlesRes, creatorsRes] = await Promise.all([
          supabase
            .from("loop_duels")
            .select(`
              id, creator_id, prompt, status, expires_at, stake_coins, loop_id, created_at,
              creator:profiles!creator_id(id, username, display_name, avatar_url, video_avatar_url),
              entries:loop_duel_entries(id, side, title, content, votes_count)
            `)
            .eq("status", "active")
            .gt("expires_at", nowIso)
            .order("created_at", { ascending: false })
            .limit(30),
          supabase
            .from("loops")
            .select(`
              id, content_text, content, created_at, author_id, circle_id, is_co_loop, content_metadata,
              author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url),
              loop_stats(likes_count, comments_count)
            `)
            .eq("visibility", "public")
            .not("content_metadata->co_authors", "is", null)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("circles")
            .select("id, name, description, avatar_url, video_avatar_url, category, is_premium_only, is_private, member_count:circle_members(count)")
            .limit(60),
          supabase
            .from("profiles")
            .select("id, username, display_name, avatar_url, video_avatar_url, is_verified, is_premium, bio, followers_count, created_at")
            .order("followers_count", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
            .limit(30),
        ])

        // Resolve the viewer's approved follows once, then apply the same
        // two-way block and profile-visibility gate to every participation
        // surface. A public Loop/duel is not permission to expose a restricted
        // creator's profile or content.
        const following = await getFollowingIds(supabase, user?.id || null)
        const duelRows = await filterPrivateContent(
          supabase,
          (duelsRes.data || []).map((duel: any) => ({
            ...duel,
            author_id: duel.creator_id || duel.creator?.id,
          })),
          user?.id || null,
          following,
        )

        // 1) Active duels ranked by current vote totals with live splits
        const duels = duelRows
          .map((duel: any) => {
            const entries = Array.isArray(duel.entries) ? duel.entries : []
            const votesA = Number(entries.find((e: any) => e.side === "A")?.votes_count || 0)
            const votesB = Number(entries.find((e: any) => e.side === "B")?.votes_count || 0)
            const total = votesA + votesB
            return {
              id: duel.id,
              loop_id: duel.loop_id,
              prompt: duel.prompt,
              expires_at: duel.expires_at,
              stake_coins: duel.stake_coins,
              creator: Array.isArray(duel.creator) ? duel.creator[0] : duel.creator,
              entries,
              votes_a: votesA,
              votes_b: votesB,
              total_votes: total,
              percent_a: total > 0 ? Math.round((votesA / total) * 100) : 50,
              percent_b: total > 0 ? Math.round((votesB / total) * 100) : 50,
            }
          })
          .sort((a: any, b: any) => b.total_votes - a.total_votes)
          .slice(0, 4)

        // 2) Open co-loops — recent collaborative posts
        let coLoopRows = coLoopsRes.data || []
        if (!coLoopRows.length) {
          const { data: fallback } = await supabase
            .from("loops")
            .select(`
              id, content_text, content, created_at, author_id, circle_id, is_co_loop, content_metadata,
              author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url),
              loop_stats(likes_count, comments_count)
            `)
            .eq("visibility", "public")
            .order("created_at", { ascending: false })
            .limit(60)
          coLoopRows = (fallback || []).filter((l: any) => {
            const meta = l.content_metadata
            return l.is_co_loop || (Array.isArray(meta?.co_authors) && meta.co_authors.length > 0)
          })
        }
        // Participation discovery must honour the same private-profile and
        // block rules as the primary Explore feed, including its fallback query.
        coLoopRows = await filterPrivateContent(
          supabase,
          coLoopRows,
          user?.id || null,
          following,
        )
        coLoopRows = await filterCircleScopedContent(supabase, coLoopRows, user?.id || null)
        const coLoops = coLoopRows.slice(0, 4).map((loop: any) => {
          const meta = loop.content_metadata
          const coAuthors = Array.isArray(meta?.co_authors) ? meta.co_authors : []
          const stats = Array.isArray(loop.loop_stats) ? loop.loop_stats[0] : loop.loop_stats
          return {
            id: loop.id,
            content: String(loop.content_text || loop.content || "").slice(0, 140),
            created_at: loop.created_at,
            author: Array.isArray(loop.author) ? loop.author[0] : loop.author,
            co_author_count: coAuthors.length + 1,
            likes_count: Number(stats?.likes_count || 0),
            comments_count: Number(stats?.comments_count || 0),
          }
        })

        // 3) Growing circles by real member count (non-premium-only visible to everyone)
        const circleRows = circlesRes.data || []
        const circles = circleRows
          .filter((c: any) => isCirclePubliclyDiscoverable({
            isPrivate: c.is_private,
            isPremiumOnly: c.is_premium_only,
          }))
          .map((c: any) => ({
            ...c,
            member_count: Number(
              Array.isArray(c.member_count) ? c.member_count[0]?.count || 0 : c.member_count || 0,
            ),
          }))
          .sort((a: any, b: any) => b.member_count - a.member_count)
          .slice(0, 4)

        // 4) Rising creators (private profiles filtered out)
        const hiddenIds = await getBlockedProfileIds(supabase, user?.id || null, (creatorsRes.data || []).map((entry: any) => entry.id))
        const privateIds = await getPrivateProfileIds(supabase, (creatorsRes.data || []).map((u: any) => u.id))
        const visibleCreators = (creatorsRes.data || []).filter((u: any) => {
          if (user && u.id === user.id) return true
          if (hiddenIds.has(u.id)) return false
          if (following.has(u.id)) return true
          return !privateIds.has(u.id)
        })
        const creators = visibleCreators.slice(0, 4)

        return NextResponse.json({
          success: true,
          data: { duels, coLoops, circles, creators },
          duels,
          coLoops,
          circles,
          creators,
        })
      }

      case "loops": {
        if (!["recent", "creative", "deepest", "following", "community", "personalized"].includes(sort)) {
          return NextResponse.json({ error: "Unsupported discovery mode" }, { status: 400 })
        }

        const followedIds = sort === "following"
          ? [...await getFollowingIds(supabase, user?.id || null)]
          : []
        if (sort === "following" && followedIds.length === 0) {
          return NextResponse.json({
            success: true,
            data: [],
            loops: [],
            pagination: { limit, offset, has_more: false, next_offset: offset },
          })
        }

        if (sort === "personalized") {
          if (!user) {
            return NextResponse.json({ error: "Sign in to use your personalized Discover feed." }, { status: 401 })
          }

          const { data: viewerProfile, error: preferencesError } = await supabase
            .from("profiles").select("discovery_preferences").eq("id", user.id).maybeSingle()

          if (preferencesError || !viewerProfile) {
            console.error("Discover preferences could not be loaded:", preferencesError)
            return NextResponse.json({ error: "Could not load your Discover preferences." }, { status: 500 })
          }

          const preferences = normalizeDiscoveryPreferences(viewerProfile.discovery_preferences)
          if (!preferences.personalization_enabled) {
            return NextResponse.json({
              success: true, data: [], loops: [], personalization_enabled: false,
              recommendation_basis: "Personalized recommendations are paused. Recent, Following and From Circles remain available.",
            })
          }

          const mutedTopics = new Set(preferences.muted_topics)
          // Personalization combines member-selected topics with public liked/saved
          // Loop signals. Private posts are never used as a recommendation source.
          const { data: interactions, error: interactionError } = await supabase
            .from("loop_interactions").select("loop_id").eq("user_id", user.id)
            .in("interaction_type", ["like", "save"]).order("created_at", { ascending: false }).limit(120)
          if (interactionError) {
            console.error("Personalized Discover signals failed:", interactionError)
            return NextResponse.json({ error: "Could not load your interest signals." }, { status: 500 })
          }

          const signalIds = [...new Set((interactions || []).map((row: any) => row.loop_id).filter(Boolean))]
          let signalLoops: any[] = []
          if (signalIds.length > 0) {
            const { data, error: signalError } = await supabase.from("loops")
              .select("id, author_id, hashtags").in("id", signalIds)
              .eq("visibility", "public").is("parent_loop_id", null)
            if (signalError) {
              console.error("Personalized Discover source Loops failed:", signalError)
              return NextResponse.json({ error: "Could not load your public interest signals." }, { status: 500 })
            }
            signalLoops = data || []
          }

          const following = await getFollowingIds(supabase, user.id)
          const visibleSignals = await filterPrivateContent(supabase, signalLoops, user.id, following)
          const interestWeights = new Map<string, number>(
            preferences.preferred_topics.map((tag, index): [string, number] => [tag, 8 - index]),
          )
          for (const loop of visibleSignals) {
            for (const rawTag of loop.hashtags || []) {
              const tag = String(rawTag).toLowerCase().replace(/^#/, "")
              if (tag && !mutedTopics.has(tag)) interestWeights.set(tag, (interestWeights.get(tag) || 0) + 1)
            }
          }

          const preferredTags = [...interestWeights.entries()]
            .sort((left, right) => right[1] - left[1])
            .slice(0, 8)

          if (preferredTags.length === 0) {
            return NextResponse.json({
              success: true,
              data: [],
              loops: [],
              recommendation_basis: "Choose a topic or like/save public Loops with topic tags to build your interest feed.",
            })
          }

          const queries = await Promise.all(preferredTags.map(async ([tag]) => {
            let candidateQuery = supabase
              .from("loops")
              .select(`
                *,
                author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, active_cosmetics, cosmetics, badge_id),
                loop_stats(likes_count, comments_count, branches_count, shares_count, views_count)
              `)
              .eq("visibility", "public")
              .is("parent_loop_id", null)
              .contains("hashtags", [tag])

            if (signalIds.length > 0) {
              candidateQuery = candidateQuery.not("id", "in", `(${signalIds.join(",")})`)
            }

            const { data, error } = await candidateQuery
              .order("created_at", { ascending: false })
              .limit(Math.min(500, Math.max((offset + limit) * 2, 24)))
            return { tag, data: data || [], error }
          }))

          if (queries.every((query) => query.error)) {
            console.error("Personalized Discover candidates failed:", queries.map((query) => query.error))
            return NextResponse.json({ error: "Could not load interest-based recommendations." }, { status: 500 })
          }

          const candidates = new Map<string, { loop: any; matched: Set<string> }>()
          for (const query of queries) {
            if (query.error) continue
            for (const loop of query.data) {
              if (!candidates.has(loop.id)) candidates.set(loop.id, { loop, matched: new Set() })
              candidates.get(loop.id)?.matched.add(query.tag)
            }
          }

          // Apply profile privacy gates before ranking and pagination so private
          // creators cannot occupy recommendation slots or affect visible ordering.
          type RankedCandidate = {
            id: string
            author_id?: string
            circle_id?: string | null
            created_at: string
            matchedTags: string[]
            [key: string]: any
          }
          const candidateRows = [...candidates.values()]
            .filter(({ loop }) => {
              const tags = Array.isArray(loop.hashtags)
                ? loop.hashtags.map((tag: unknown) => String(tag).toLowerCase().replace(/^#/, ""))
                : []
              return !tags.some((tag: string) => mutedTopics.has(tag))
            })
            .map(({ loop, matched }) => ({
              ...loop,
              id: String(loop.id),
              author_id: typeof loop.author_id === "string" ? loop.author_id : undefined,
              created_at: String(loop.created_at),
              matchedTags: [...matched],
            })) as RankedCandidate[]
          const visibleProfileCandidates = await filterPrivateContent(
            supabase,
            candidateRows,
            user.id,
            following,
          )
          const visibleCandidates = await filterCircleScopedContent(
            supabase,
            visibleProfileCandidates,
            user.id,
          )

          const sortedCandidates = visibleCandidates.sort((left, right) => {
            const leftInterest = left.matchedTags.reduce((sum, tag) => sum + (interestWeights.get(tag) || 0), 0)
            const rightInterest = right.matchedTags.reduce((sum, tag) => sum + (interestWeights.get(tag) || 0), 0)
            return rightInterest - leftInterest
              || engagementScore(right) - engagementScore(left)
              || new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
              || String(right.id).localeCompare(String(left.id))
          })

          // Keep the feed varied without starving a small community: select up
          // to two recommendations per creator first, then fill remaining slots
          // from the ranked tail if fewer than the requested items were found.
          const candidatePage = diversifyByAuthor(sortedCandidates, Math.min(501, offset + limit + 1), 2)
          const hasMore = candidatePage.length > offset + limit
          const selected = candidatePage.slice(offset, offset + limit)

          const ranked = selected.map((loop) => ({
            ...loop,
            discovery_reason: "Matches your interest in " + loop.matchedTags.slice(0, 2).map((tag) => "#" + tag).join(" and "),
          }))

          const visibleRows = ranked
          const enriched = await enrichLoopsWithPollsAndDuels(supabase, visibleRows)
          await applyRealCommentCounts(supabase, enriched)
          await applyRealBranchCounts(supabase, enriched)

          const interactionMap = new Map<string, string[]>()
          if (enriched.length > 0) {
            const { data: candidateInteractions } = await supabase
              .from("loop_interactions")
              .select("loop_id, interaction_type")
              .eq("user_id", user.id)
              .in("loop_id", enriched.map((loop: any) => loop.id))
            for (const interaction of candidateInteractions || []) {
              if (!interactionMap.has(interaction.loop_id)) interactionMap.set(interaction.loop_id, [])
              interactionMap.get(interaction.loop_id)?.push(interaction.interaction_type)
            }
          }

          const results = normalizeLoops(enriched, interactionMap).map((loop) => ({
            ...loop,
            discovery_reason: ranked.find((item) => item.id === loop.id)?.discovery_reason || "Based on your public interests",
          }))
          return NextResponse.json({
            success: true,
            data: results,
            loops: results,
            recommendation_basis: "Based on topics you choose and tags from public Loops you have liked or saved. Muted topics, private content and inaccessible creator profiles are excluded.",
            pagination: { limit, offset, has_more: hasMore, next_offset: offset + results.length },
          })
        }

        // Fetch a bounded candidate window, then apply profile/Circle privacy
        // before ranking and paging. Filtering afterwards can starve a page and
        // let inaccessible content occupy a rank.
        const fetchLimit = Math.min(2_000, offset + Math.max(limit * 4, 40))
        let loopQuery = supabase
          .from("loops")
          .select(`
            *,
            author:profiles!author_id(id, username, display_name, avatar_url, video_avatar_url, is_verified, is_team_member, is_sponsor, is_premium, active_cosmetics, cosmetics, badge_id),
            loop_stats(likes_count, comments_count, branches_count, shares_count, views_count)
          `)
          .is("parent_loop_id", null)
          .eq("visibility", "public")
        if (sort === "following") {
          loopQuery = loopQuery.in("author_id", followedIds)
        }
        if (sort === "community") {
          loopQuery = loopQuery.not("circle_id", "is", null)
        }
        const { data: loops, error: loopsError } = await loopQuery
          .order("created_at", { ascending: false })
          .range(0, fetchLimit - 1)

        if (loopsError) {
          console.error("Error fetching explore loops:", loopsError)
          return NextResponse.json({ error: loopsError.message || "Failed to fetch loops" }, { status: 500 })
        }

        const following = await getFollowingIds(supabase, user?.id || null)
        let rows = await filterPrivateContent(supabase, loops || [], user?.id || null, following)
        rows = await filterCircleScopedContent(supabase, rows, user?.id || null)

        if (sort === "creative") {
          rows = [...rows].sort((a, b) => engagementScore(b) - engagementScore(a))
        } else if (sort === "deepest") {
          rows = [...rows].sort((a, b) => {
            const aStats = Array.isArray(a.loop_stats) ? a.loop_stats[0] : a.loop_stats
            const bStats = Array.isArray(b.loop_stats) ? b.loop_stats[0] : b.loop_stats
            const aDepth = Number(a.tree_depth || aStats?.branches_count || 0)
            const bDepth = Number(b.tree_depth || bStats?.branches_count || 0)
            return bDepth - aDepth || engagementScore(b) - engagementScore(a)
          })
        }
        const hasMore = rows.length > offset + limit
        rows = rows.slice(offset, offset + limit)

        const interactionMap = new Map<string, string[]>()
        if (user && rows.length > 0) {
          const { data: interactions } = await supabase
            .from("loop_interactions")
            .select("loop_id, interaction_type")
            .eq("user_id", user.id)
            .in(
              "loop_id",
              rows.map((loop) => loop.id),
            )

          interactions?.forEach((interaction) => {
            if (!interactionMap.has(interaction.loop_id)) interactionMap.set(interaction.loop_id, [])
            interactionMap.get(interaction.loop_id)?.push(interaction.interaction_type)
          })
        }

        const enriched = await enrichLoopsWithPollsAndDuels(supabase, rows)
        await applyRealCommentCounts(supabase, enriched)
        await applyRealBranchCounts(supabase, enriched)
        const normalized = normalizeLoops(enriched, interactionMap)
        return NextResponse.json({
          success: true,
          data: normalized,
          loops: normalized,
          pagination: { limit, offset, has_more: hasMore, next_offset: offset + normalized.length },
        })
      }

      default:
        return NextResponse.json({ error: "Invalid type parameter" }, { status: 400 })
    }
  } catch (error) {
    console.error("Trending API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {

    const supabase = createServerClient()
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { hashtag, loop_id } = body

    if (!hashtag || !loop_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const { error } = await supabase.from("hashtag_usage").insert({
      hashtag: String(hashtag).toLowerCase(),
      loop_id,
      user_id: user.id,
    })

    if (error) {
      console.error("Error recording hashtag usage:", error)
      return NextResponse.json({ error: "Failed to record hashtag usage" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Hashtag tracking error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

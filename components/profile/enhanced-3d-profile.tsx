"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Calendar, Coins, Edit, Flame, Gift, Heart, Link as LinkIcon, Lock, MapPin, MessageCircle, MoreHorizontal, Pin, PinOff, Plus, Palette, Share2, Wand2, Zap, Trophy, Upload, Users, Package, Building2, } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LoopCard } from "@/components/loop-card"
import { useAuth } from "@/hooks/use-auth"
import { ProfileShareCard } from "@/components/profile/profile-share-card"
import { ProfileSkeleton } from "@/components/loading-states"
import { EmptyState as PageEmptyState } from "@/components/ui/empty-state"
import { ProxyImg } from "@/components/ui/proxy-img"
import { ReportContentButton } from "@/components/moderation/report-content-button"
import { BlockUserButton } from "@/components/moderation/block-user-button"
import { GiftModal } from "@/components/gifting/gift-modal"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { CosmeticAvatar } from "@/components/profile/cosmetic-avatar"
import { VideoAvatar } from "@/components/cosmetics/video-avatar"
import { VideoCover } from "@/components/cosmetics/video-cover"
import { ImageCropDialog } from "@/components/ui/image-crop-dialog"
import { ProfileBanner3D } from "@/components/profile/profile-banner-3d"
import { cosmeticsFromInventory, fontStyle, type ActiveCosmetics } from "@/lib/cosmetics"
import { ensureCosmeticFonts } from "@/lib/cosmetic-fonts"
import { isShopThemePayload } from "@/lib/theme-css"
import { xpForNextLevel } from "@/lib/xp"
import { uploadMediaFile } from "@/lib/client-media-upload"
import { UserBadges } from "@/components/user-badge"
import { usePfpFrame } from "@/hooks/use-pfp-frame"
import { useVerificationBadges } from "@/hooks/use-verification-badges"
import { ProfileAboutTab } from "@/components/profile/profile-about-tab"
import { ProfileCompletionIndicator } from "@/components/profile/profile-completion"
import { ProfileCreativeWork } from "@/components/profile/profile-creative-work"
import { ActivityHeatmap } from "@/components/profile/activity-heatmap"
import { ProfileMediaGrid } from "@/components/profile/profile-media-grid"
import { SimilarCreators } from "@/components/profile/similar-creators"
import { AccountStatusScreen } from "@/components/profile/account-status-screen"
import { RichContent } from "@/components/content/rich-content"
import { BioCommunityTags } from "@/components/profile/bio-community-tags"
import { useProfileNote } from "@/hooks/use-profile-note"
import { NoteBubble } from "@/components/notes/note-bubble"
import { NoteComposer } from "@/components/notes/note-composer"
import { ProfileAwards, ProfileAwardsGrid } from "@/components/profile/profile-awards"
import { ProfileAchievementShowcase } from "@/components/profile/profile-achievement-showcase"
import { stripCircleBioTokens } from "@/lib/circle-bio-tokens"
import { isRustApiUnavailable, rustApiRequest } from "@/lib/rust-api"
import { EnhancedMediaViewer } from "@/components/media/enhanced-media-viewer"

interface Achievement {
  id: string
  name: string
  description: string
  badge_url: string
  earned_at: string
  rarity: "common" | "rare" | "epic" | "legendary"
}

interface UserProfile {
  id: string
  username: string
  display_name: string
  bio?: string
  profile_custom_css?: string | null
  tagged_circles?: Array<{ id: string; name: string; avatar_url?: string | null }>
  avatar_url?: string
  banner_url?: string
  is_blocked?: boolean
  block_direction?: "by_me" | "by_them" | null
  followers_count: number
  following_count: number
  loops_count: number
  branches_count: number
  comments_count?: number
  likes_received: number
  views_received?: number
  level: number
  xp_points: number
  loop_coins: number
  is_verified: boolean
  is_team_member?: boolean
  is_sponsor?: boolean
  is_premium: boolean
  status?: string
  is_deleted?: boolean
  is_suspended?: boolean
  ban_reason?: string | null
  badge_id?: string | null
  is_organization?: boolean
  organization_name?: string
  organization_badge_url?: string
  pronouns?: string | null
  organization_config?: {
    coin_rate_multiplier?: number
    custom_boost_discount?: number
    circle_perk_price?: number
    exclusive_rewards_enabled?: boolean
  }
  created_at: string
  website?: string
  location?: string
  achievements: Achievement[]
  recent_loops: any[]
  recent_branches?: any[]
  media_loops?: any[]
  is_following?: boolean
  active_effects?: any[]
  active_cosmetics?: ActiveCosmetics | null
  theme_preferences?: any
  available_earnings?: number
  total_earnings?: number
}

function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return String(value)
}

export function Enhanced3DProfile({ username }: { username: string }) {
  const router = useRouter()
  const { user, getAuthHeader, refreshUser, applyServerProfile } = useAuth()
  const { toast } = useToast()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const verificationBadges = useVerificationBadges()
  const profileBadge = profile?.badge_id ? (verificationBadges[profile.badge_id] || null) : null
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("loops")
  const [isFollowing, setIsFollowing] = useState(false)
  const [followRequestPending, setFollowRequestPending] = useState(false)
  const [isPrivateProfile, setIsPrivateProfile] = useState(false)
  const [canViewFull, setCanViewFull] = useState(true)
  const [uploadingCover, setUploadingCover] = useState(false)
  // Cover picked from the file dialog, waiting to be framed in the cropper.
  const [coverCrop, setCoverCrop] = useState<File | null>(null)
  const [showGiftModal, setShowGiftModal] = useState(false)
  // Tapping the profile photo or cover opens it full-screen (zoom / swipe).
  const [photoViewer, setPhotoViewer] = useState<{
    url: string
    type: "image" | "video"
    alt: string
  } | null>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const profileFrame = usePfpFrame((profile as any)?.equipped_frame_id)
  // The short 24h note under the name. Owner and visitors read the same row;
  // whether it is visible at all is the author's per-note choice.
  const {
    note: profileNote,
    refresh: refreshProfileNote,
  } = useProfileNote({ userId: (profile as any)?.id, surface: "profile", enabled: Boolean((profile as any)?.id) })

  const fetchProfileRef = useRef<{ inFlight?: boolean; lastUsername?: string }>({})

  const fetchProfile = useCallback(async (opts?: { silent?: boolean }) => {
    // Guard: skip if this exact username was already fetched and is still in-flight
    // or if the profile is already up-to-date for this username.
    const key = `${username}:${user?.id ?? "guest"}`
    if (fetchProfileRef.current.inFlight && fetchProfileRef.current.lastUsername === key) return
    fetchProfileRef.current.inFlight = true
    fetchProfileRef.current.lastUsername = key

    try {
      if (!opts?.silent) setLoading(true)
      const response = await fetch(`/api/users/profile?username=${encodeURIComponent(username)}`, {
        headers: user ? getAuthHeader() : undefined,
        cache: "no-store",
      })
      if (response.ok) {
        const data = await response.json()
        const newProfile = data.profile
        setProfile(newProfile)
        setIsFollowing(Boolean(newProfile?.is_following))
        setFollowRequestPending(Boolean(newProfile?.has_pending_follow_request))
        setIsPrivateProfile(Boolean(newProfile?.is_private))
        setCanViewFull(newProfile?.can_view_full !== false)

        // The Rust social graph is the write authority. Refresh the relationship
        // state from the same API so profile controls don't depend on the legacy
        // Next.js follow route during the staged migration.
        if (user && newProfile?.id && newProfile.id !== user.id && !newProfile?.is_blocked) {
          try {
            const followState = await rustApiRequest<{
              is_following: boolean
              has_pending_follow_request: boolean
              is_private: boolean
              followers_count: number
              following_count: number
            }>(`users/${encodeURIComponent(newProfile.id)}/follow-state`, {
              headers: getAuthHeader(),
            })
            setIsFollowing(followState.is_following)
            setFollowRequestPending(followState.has_pending_follow_request)
            setIsPrivateProfile(followState.is_private)
            setProfile((current) => {
              if (!current || current.id !== newProfile.id) return current
              return { ...current, followers_count: followState.followers_count }
            })
          } catch {
            // Keep the existing profile payload as a compatibility fallback
            // until the Rust API is deployed for this environment.
          }
        }
        // Sync only slim auth fields for own profile — never full payload.
        // Only update if the username actually differs to avoid unnecessary auth
        // state churn that can trigger re-render loops.
        if (user && newProfile?.id === user.id && newProfile.username !== user.username) {
          applyServerProfile({
            username: newProfile.username,
            display_name: newProfile.display_name,
            avatar_url: newProfile.avatar_url,
            banner_url: newProfile.banner_url,
            bio: newProfile.bio,
            tagged_circles: Array.isArray(newProfile.tagged_circles) ? newProfile.tagged_circles : [],
            loop_coins: newProfile.loop_coins,
            is_premium: newProfile.is_premium,
            is_verified: newProfile.is_verified,
            is_admin: newProfile.is_admin,
            theme_preferences: newProfile.theme_preferences,
            location: newProfile.location,
            website: newProfile.website,
          })
          if (typeof window !== "undefined" && isShopThemePayload(newProfile.theme_preferences)) {
            window.dispatchEvent(
              new CustomEvent("loop-profile-theme", { detail: newProfile.theme_preferences }),
            )
          }
        }
      } else {
        setProfile(null)
      }
    } catch (error) {
      console.error("Error fetching profile:", error)
    } finally {
      fetchProfileRef.current.inFlight = false
      if (!opts?.silent) setLoading(false)
    }
  }, [username, user?.id, user?.username, getAuthHeader, applyServerProfile])

  useEffect(() => {
    void fetchProfile()
    // Intentionally only re-fetch when the route username or signed-in user changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, user?.id])

  const [pinningId, setPinningId] = useState<string | null>(null)
  const handleTogglePin = async (loopId: string, nextPinned: boolean) => {
    setPinningId(loopId)
    try {
      const res = await fetch(`/api/loops/${loopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ is_pinned: nextPinned }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to update pin")
      toast({ description: nextPinned ? "Pinned to your profile" : "Unpinned from your profile" })
      await fetchProfile({ silent: true })
    } catch (error: any) {
      toast({ title: "Couldn't update pin", description: error.message, variant: "destructive" })
    } finally {
      setPinningId(null)
    }
  }

  useEffect(() => {
    if (!profile?.id) return

    const channel = supabase
      .channel(`profile-live:${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `id=eq.${profile.id}` },
        () => {
          void fetchProfile({ silent: true })
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "loops", filter: `author_id=eq.${profile.id}` },
        () => {
          void fetchProfile({ silent: true })
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "follows", filter: `following_id=eq.${profile.id}` },
        () => {
          void fetchProfile({ silent: true })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const handleFollow = async () => {
    if (!profile || !user) {
      toast({ title: "Sign in required", description: "Please sign in to continue." })
      return
    }
    const nextAction = isFollowing ? "unfollow" : "follow"
    const previousFollowing = isFollowing
    const previousCount = profile.followers_count
    const previousPending = followRequestPending

    // If we already have a pending request, clicking again withdraws it.
    if (!isFollowing && followRequestPending) {
      try {
        try {
          await rustApiRequest<void>(`users/${encodeURIComponent(profile.id)}/follow-request`, {
            method: "DELETE",
            headers: getAuthHeader(),
          })
        } catch (error) {
          if (!isRustApiUnavailable(error)) throw error
          // Legacy compatibility while the Rust API is not yet deployed.
          const cancelRes = await fetch("/api/users/follow-requests", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeader() },
            body: JSON.stringify({ action: "withdraw", target_user_id: profile.id }),
          })
          if (!cancelRes.ok) throw new Error("Could not withdraw follow request")
        }
        setFollowRequestPending(false)
        toast({ title: "Follow request withdrawn" })
      } catch {
        /* keep pending */
      }
      return
    }

    // Optimistic UI
    setIsFollowing(!isFollowing)
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            followers_count: isFollowing
              ? Math.max(0, prev.followers_count - 1)
              : prev.followers_count + 1,
          }
        : null,
    )
    try {
      let data: {
        success?: boolean
        is_following?: boolean
        requires_approval?: boolean
        has_pending_follow_request?: boolean
        followers_count?: number
        following_count?: number
        error?: string
      }
      try {
        data = await rustApiRequest(`users/${encodeURIComponent(profile.id)}/follow`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ action: nextAction }),
        })
      } catch (error) {
        if (!isRustApiUnavailable(error)) throw error
        // Keep existing users working while the Rust service is rolled out.
        const response = await fetch("/api/users/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({
            target_user_id: profile.id,
            action: nextAction,
          }),
        })
        data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || "Follow failed")
      }
      if (data.requires_approval) {
        // Private profile — the follow is now pending approval.
        setIsFollowing(false)
        setFollowRequestPending(true)
        setProfile((prev) => (prev ? { ...prev, followers_count: previousCount } : prev))
        toast({ title: "Follow request sent", description: "This profile is private — you'll be able to follow once it's approved." })
        return
      }
      setIsFollowing(Boolean(data.is_following ?? !previousFollowing))
      // Clear follow-request pending state whenever the API confirms
      // a definitive follow/unfollow result (i.e. not requiring approval).
      // This prevents stale "Requested ✓" text on public profiles when
      // the user was previously pending on a *different* profile.
      if (data.requires_approval === undefined || data.is_following === true) {
        setFollowRequestPending(false)
      }
      const updatedFollowersCount = data.followers_count
      if (typeof updatedFollowersCount === "number") {
        setProfile((prev) => {
          if (!prev) return prev
          return { ...prev, followers_count: updatedFollowersCount }
        })
      }
    } catch (error: any) {
      setIsFollowing(previousFollowing)
      setFollowRequestPending(previousPending)
      setProfile((prev) => (prev ? { ...prev, followers_count: previousCount } : prev))
      toast({
        title: "Could not update follow",
        description: error.message || "Try again",
        variant: "destructive",
      })
    }
  }

  const handleMessage = async () => {
    if (!user || !profile) {
      toast({ title: "Sign in required", description: "Please sign in to continue." })
      return
    }
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ participant_ids: [profile.id] }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not start chat")
      router.push(`/messages?c=${data.conversation.id}`)
    } catch {
      router.push("/messages")
    }
  }

  const handleCoverUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset first so re-picking the same file still fires onChange.
    event.target.value = ""
    if (!file || !user) return
    // Videos and animated GIFs keep their frames — everything else is cropped.
    if (file.type.startsWith("image/") && file.type !== "image/gif" && file.type !== "image/svg+xml") {
      setCoverCrop(file)
      return
    }
    void uploadCover(file)
  }

  const uploadCover = async (file: File) => {
    if (!user) return
    setUploadingCover(true)
    try {
      const uploaded = await uploadMediaFile(file, {
        type: "image",
        folder: "banners",
        authHeaders: getAuthHeader(),
      })
      const url = uploaded.url

      const saveRes = await fetch("/api/users/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ banner_url: url }),
      })
      if (!saveRes.ok) throw new Error("Failed to save cover")
      setProfile((prev) => (prev ? { ...prev, banner_url: url } : prev))
      applyServerProfile({ banner_url: url })
      toast({ title: "Cover updated" })
    } catch (error: any) {
      toast({ title: "Cover upload failed", description: error.message, variant: "destructive" })
    } finally {
      setUploadingCover(false)
    }
  }

  // Compute cosmetics BEFORE any early returns so the hook count stays stable
  // (React error #310 = "rendered more hooks than during the previous render")
  const cosmetics: ActiveCosmetics =
    profile?.active_cosmetics && Object.keys(profile.active_cosmetics).length
      ? profile.active_cosmetics
      : cosmeticsFromInventory(profile?.active_effects)

  // Load the equipped display-name font so it renders immediately (and when
  // cosmetics change via realtime, the effect re-runs).
  useEffect(() => {
    ensureCosmeticFonts(cosmetics.font)
  }, [cosmetics.font])

  // The profile's top bar only materialises once the page is scrolled. At rest
  // it would otherwise be a strip drawn straight across the cover photo.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  if (loading) return <ProfileSkeleton />

  // Deleted / suspended accounts render a placeholder — no profile data,
  // no content, and an appeal path for suspensions.
  const accountStatus = profile?.status || (profile?.is_deleted ? "deleted" : profile?.is_suspended ? "suspended" : null)
  if (accountStatus === "deleted" || accountStatus === "suspended") {
    return (
      <AccountStatusScreen
        status={accountStatus}
        username={profile?.username || username}
        isSelf={Boolean(user && (user.id === profile?.id || user.username === profile?.username))}
        banReason={profile?.ban_reason}
      />
    )
  }

  if (!profile) {
    return (
      <PageEmptyState
        title="Profile not found"
        description="This user doesn't exist or their profile is private."
        actionLabel="Go home"
        actionHref="/"
      />
    )
  }

  const isOwnProfile = Boolean(user && (user.id === profile.id || user.username === profile.username))
  const displayName = profile.display_name || profile.username
  const xp = Number(profile.xp_points || 0)
  const level = Number(profile.level || 1)
  const nextXp = xpForNextLevel(level)
  const prevXp = Math.pow(level, 2) * 100
  const xpProgress = Math.min(100, Math.round(((xp - prevXp) / Math.max(1, nextXp - prevXp)) * 100))

  return (
    <div className="mx-auto w-full max-w-6xl bg-background min-h-screen profile-page" data-profile-custom-css>
      {profile.profile_custom_css ? (
        <style data-profile-custom-css-style>{profile.profile_custom_css}</style>
      ) : null}
      {/* Profile top bar. It is stretched under the site Header (h-14, so
          top-14 keeps it flush — a mismatch here left a gap of page content
          showing between the two bars) and -mb-14 cancels its own h-14 out of
          the flow, so the cover starts right below the header instead of being
          pushed down.

          Nothing is painted here until the page scrolls: at rest the cover is
          unobstructed apart from the back button, and only the part that is
          actually pinned gets a background, so no strip is ever drawn across
          the cover. */}
      <div
        className={cn(
          "sticky top-14 z-30 -mb-14 flex h-14 items-center gap-3 border-b px-3 transition-colors duration-200 sm:gap-4 profile-topbar",
          scrolled ? "border-border bg-background" : "border-transparent bg-transparent"
        )}
      >
        <Link
          href="/"
          aria-label="Back"
          className={cn(
            "rounded-full p-2 transition-colors",
            scrolled
              ? "hover:bg-muted"
              : "bg-black/45 text-white backdrop-blur-sm hover:bg-black/60"
          )}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div
          aria-hidden={!scrolled}
          className={cn(
            "min-w-0 flex-1 transition-opacity duration-200",
            scrolled ? "opacity-100" : "pointer-events-none opacity-0"
          )}
        >
          {/* No gap: the badge sits tight against the name (a space between them
              read as a typo in the name). */}
          <div className="flex items-center gap-0">
            <h1 className="truncate text-base font-bold leading-tight sm:text-lg">{displayName}</h1>
            <UserBadges
              is_verified={profile.is_verified}
              is_team_member={profile.is_team_member}
              is_sponsor={profile.is_sponsor}
              is_organization={profile.is_organization}
              organization_badge_url={profile.organization_badge_url}
              organization_name={profile.organization_name}
              badge={profileBadge}
              username={profile.username}
              size="sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">{formatCount(profile.loops_count)} loops</p>
        </div>
      </div>

      <div className="lg:px-4 lg:pt-4">
      {/* Banner — animated cover with upload button */}
      <div className="relative profile-cover">
      <div
        role={profile.banner_url || (profile as any).video_cover_url ? "button" : undefined}
        tabIndex={profile.banner_url || (profile as any).video_cover_url ? 0 : -1}
        aria-label="View cover photo"
        className={cn(
          "block w-full",
          (profile.banner_url || (profile as any).video_cover_url) && "cursor-zoom-in"
        )}
        onClick={() => {
          const video = (profile as any).video_cover_url as string | null
          const image = profile.banner_url
          const url = video || image
          if (!url) return
          setPhotoViewer({
            url,
            type: video ? "video" : "image",
            alt: `${displayName}'s cover photo`,
          })
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return
          e.preventDefault()
          const video = (profile as any).video_cover_url as string | null
          const url = video || profile.banner_url
          if (!url) return
          setPhotoViewer({ url, type: video ? "video" : "image", alt: `${displayName}'s cover photo` })
        }}
      >
      <VideoCover
        src={profile.banner_url}
        videoSrc={(profile as any).video_cover_url || null}
        alt="Cover photo"
        height="h-44 sm:h-64 lg:h-80 lg:rounded-2xl"
        className=""
      />
      </div>
        {/* The author's live note floats over the banner, pinned just above the
            avatar. Absolute so it never fights the avatar's negative margin
            over the cover, and clear of the cover controls in the corners. */}
        {(profileNote || isOwnProfile) && (
          <div className="pointer-events-none absolute bottom-12 left-3 z-30 flex flex-wrap items-start gap-2 sm:bottom-16 sm:left-4">
            {profileNote && (
              <NoteBubble note={profileNote} variant="profile" className="pointer-events-auto" />
            )}
            {isOwnProfile && (
              <div className="pointer-events-auto">
                <NoteComposer
                  userId={(profile as any).id}
                  note={profileNote}
                  onSaved={() => refreshProfileNote()}
                />
              </div>
            )}
          </div>
        )}
        {isOwnProfile && (
          <>
            <input
              ref={coverInputRef}
              id="profile-cover-upload"
              type="file"
              accept="image/*,.gif,image/gif,video/mp4,video/webm"
              className="hidden"
              onChange={handleCoverUpload}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="absolute bottom-2 right-2 z-20 rounded-full bg-black/55 px-3 text-white hover:bg-black/70 sm:bottom-3 sm:right-3"
              disabled={uploadingCover}
              onClick={(e) => {
                e.stopPropagation()
                coverInputRef.current?.click()
              }}
            >
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {uploadingCover ? "Uploading…" : "Edit cover"}
            </Button>
            <p className="pointer-events-none absolute bottom-2 left-2 z-20 hidden rounded-full bg-black/45 px-2 py-0.5 text-[10px] text-white/90 sm:bottom-3 sm:left-3 sm:block">
              JPG, PNG, GIF, or Video
            </p>
          </>
        )}
      </div>

      {/* Desktop: two-column layout — sticky info sidebar + content column. Mobile stays stacked. */}
      <div className="lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-8">
      {/* Avatar + actions — stack on mobile; empty overlap must not block cover button */}
      <div className="relative z-10 px-3 pb-3 sm:px-4 lg:px-0 lg:pb-0">
        <div className="lg:sticky lg:top-28 lg:pb-8">
        <div className="-mt-10 flex flex-col gap-3 pointer-events-none sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
          <div
            className={cn(
              "relative self-start pointer-events-auto rounded-full",
              (profile.avatar_url || (profile as any).video_avatar_url) && "cursor-zoom-in"
            )}
            role={(profile.avatar_url || (profile as any).video_avatar_url) ? "button" : undefined}
            tabIndex={(profile.avatar_url || (profile as any).video_avatar_url) ? 0 : -1}
            aria-label="View profile photo"
            onClick={() => {
              const video = (profile as any).video_avatar_url as string | null
              const url = video || profile.avatar_url
              if (!url) return
              setPhotoViewer({ url, type: video ? "video" : "image", alt: `${displayName}'s profile photo` })
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return
              e.preventDefault()
              const video = (profile as any).video_avatar_url as string | null
              const url = video || profile.avatar_url
              if (!url) return
              setPhotoViewer({ url, type: video ? "video" : "image", alt: `${displayName}'s profile photo` })
            }}
          >
            <VideoAvatar
              src={profile.avatar_url}
              videoSrc={(profile as any).video_avatar_url || null}
              isPremium={profile.is_premium}
              alt={displayName}
              cosmetics={cosmetics}
              size="xl"
              className="border-4 border-background"
            />
            {profileFrame && profileFrame.image_url && (
              /* Mask the equipped frame to the circular avatar — frames render as a ring around the PFP, never as a box. */
              <img
                src={profileFrame.image_url.startsWith("http") ? `/api/image-proxy?url=${encodeURIComponent(profileFrame.image_url)}` : profileFrame.image_url}
                alt=""
                className="absolute inset-0 pointer-events-none rounded-full object-contain"
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "50%",
                  clipPath: "circle(50% at 50% 50%)",
                }}
                draggable={false}
              />
            )}
          </div>

          <div className="pointer-events-auto mb-0 flex w-full flex-wrap justify-stretch gap-2 sm:mb-1 sm:w-auto sm:justify-end">
            {isOwnProfile ? (
              <>
                <Link href="/inventory" className="min-w-0 flex-1 sm:flex-none">
                  <Button variant="outline" className="w-full rounded-full px-3 font-semibold sm:px-4">
                    <Package className="mr-2 h-4 w-4" /> Inventory
                  </Button>
                </Link>
                <Link href="/settings" className="min-w-0 flex-1 sm:flex-none">
                  <Button variant="outline" className="w-full rounded-full px-3 font-semibold sm:px-4">
                    <Edit className="mr-2 h-4 w-4" /> Edit profile
                  </Button>
                </Link>
                <div className="w-full sm:w-auto">
                  <ProfileShareCard
                    username={profile.username}
                    displayName={displayName}
                    bio={stripCircleBioTokens(profile.bio)}
                    avatarUrl={profile.avatar_url}
                    triggerClassName="w-full rounded-full border px-3 sm:w-auto"
                  />
                </div>
                {!profile.is_premium && (
                  <Link href="/premium" className="w-full sm:w-auto">
                    <Button className="w-full rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-4 font-semibold text-white hover:from-amber-400 hover:to-orange-500">
                      Get Pro
                    </Button>
                  </Link>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" size="icon" className="rounded-full" onClick={() => void handleMessage()}>
                  <MessageCircle className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="rounded-full" onClick={() => setShowGiftModal(true)}>
                  <Gift className="h-4 w-4" />
                </Button>
                <Button
                  onClick={() => {
                    if (!user) {
                      toast({ title: "Sign in required", description: "Please sign in to continue." })
                      return
                    }
                    void handleFollow()
                  }}
                  className={cn(
                    "flex-1 rounded-full px-5 font-semibold sm:flex-none",
                    isFollowing || followRequestPending
                      ? "border border-border bg-transparent text-foreground hover:bg-muted"
                      : "bg-foreground text-background hover:opacity-90",
                  )}
                >
                  {isFollowing
                    ? "Following"
                    : followRequestPending
                      ? "Requested ✓"
                      : isPrivateProfile
                        ? "Request to follow"
                        : "Follow"}
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-3 profile-identity">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              {/* The mark needs real air beside the name — a hairline gap still
                  reads as part of the word at these sizes. */}
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-extrabold tracking-tight profile-display-name" style={fontStyle(cosmetics.font)}>
                  {displayName}
                </h2>
                <UserBadges
                  is_verified={profile.is_verified}
                  is_team_member={profile.is_team_member}
                  is_sponsor={profile.is_sponsor}
                  is_organization={profile.is_organization}
                  organization_badge_url={profile.organization_badge_url}
                  organization_name={profile.organization_name}
                  badge={profileBadge}
                  username={profile.username}
                  showText={true}
                  size="md"
                />
              </div>
              {profile.is_premium && (
                <Badge className="rounded-full border-0 bg-amber-400/15 px-1.5 py-0 text-[10px] font-bold leading-4 tracking-wide text-amber-300">
                  PRO
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">@{profile.username}</p>
            {profile.pronouns && (
              <div className="mt-1.5">
                <span className="inline-flex items-center rounded-full border border-border/80 bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {profile.pronouns}
                </span>
              </div>
            )}
          </div>

          {profile.bio ? (
            <RichContent text={profile.bio} className="text-[15px] leading-relaxed profile-bio" showPreviewCard={false} />
          ) : (
            <p className="text-[15px] leading-relaxed text-muted-foreground profile-bio">
              Building thoughtful communities with depth, style, and signal.
            </p>
          )}
          <BioCommunityTags tags={profile.tagged_circles} bioText={profile.bio} />

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {profile.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-4 w-4" /> {profile.location}
              </span>
            )}
            {profile.website && (
              <a
                href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sky-500 hover:underline"
              >
                <LinkIcon className="h-4 w-4" /> {profile.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-4 w-4" /> Joined{" "}
              {new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
            {isOwnProfile && (
              <span className="inline-flex items-center gap-1 text-amber-500">
                <Coins className="h-4 w-4" /> {Number(profile.loop_coins ?? 0).toLocaleString()} coins
              </span>
            )}
            {isOwnProfile && Number(profile.available_earnings || 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-500">
                ${Number(profile.available_earnings || 0).toFixed(2)} earnings
              </span>
            )}
          </div>

          {/* Compact X-style stats */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Link href={`/profile/${profile.username}/following`} className="hover:underline">
              <span className="font-bold text-foreground">{formatCount(profile.following_count)}</span>{" "}
              <span className="text-muted-foreground">Following</span>
            </Link>
            <Link href={`/profile/${profile.username}/followers`} className="hover:underline">
              <span className="font-bold text-foreground">{formatCount(profile.followers_count)}</span>{" "}
              <span className="text-muted-foreground">Followers</span>
            </Link>
            <span>
              <span className="font-bold text-foreground">{formatCount(profile.loops_count)}</span>{" "}
              <span className="text-muted-foreground">Loops</span>
            </span>
            <span>
              <span className="font-bold text-foreground">{formatCount(profile.branches_count)}</span>{" "}
              <span className="text-muted-foreground">Branches</span>
            </span>
            <span>
              <span className="font-bold text-foreground">{formatCount(profile.comments_count ?? 0)}</span>{" "}
              <span className="text-muted-foreground">Comments</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs">
              <Trophy className="h-3.5 w-3.5 text-amber-500" />
              Level {level}
            </span>
            <span className="text-muted-foreground">
              <span className="font-bold text-foreground">{formatCount(profile.likes_received)}</span> Likes
            </span>
          </div>

          {/* Admin-granted awards shelf */}
          {profile.id && <ProfileAwards userId={profile.id} />}

          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {xp.toLocaleString()} XP · next level at {nextXp.toLocaleString()}
              </span>
              <span>{xpProgress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[var(--theme-primary,#0ea5e9)] transition-all"
                style={{ width: `${xpProgress}%` }}
              />
            </div>

            {/* Organization Account Tier & Follower Progress Status */}
            {profile.is_organization ? (
              <div className="mt-3 rounded-xl bg-gradient-to-r from-emerald-950/80 via-slate-900 to-teal-950/80 border border-emerald-500/30 p-3.5 space-y-2 shadow-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UserBadges
                      is_organization={true}
                      organization_badge_url={profile.organization_badge_url}
                      organization_name={profile.organization_name}
                      showText={true}
                      size="md"
                    />
                    <span className="font-bold text-white text-sm">Official Organization Partner</span>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-300 font-semibold bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                    ⚡ {profile.organization_config?.coin_rate_multiplier || 1.5}x Coin Rate
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Full earning privileges unlocked, custom circle branding, and event hosting capabilities.
                </p>
              </div>
            ) : (
              <div className="mt-3 rounded-xl bg-slate-900/60 border border-border/80 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-emerald-500" />
                    Organization Partnership Progress
                  </span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {profile.followers_count} / 100 Followers
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      profile.followers_count >= 100
                        ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                        : "bg-emerald-500/80"
                    }`}
                    style={{ width: `${Math.min(100, Math.round((profile.followers_count / 100) * 100))}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {profile.followers_count >= 100
                    ? "🎉 Follower goal reached! Account is eligible for Organization partnership review."
                    : `${100 - profile.followers_count} more followers needed for Organization partnership eligibility.`}
                </p>
              </div>
            )}
            {(cosmetics.badge || cosmetics.frame || cosmetics.aura || cosmetics.effect || cosmetics.font || cosmetics.cardEffect) && (
              <div className="rounded-xl border border-border/60 bg-gradient-to-br from-violet-500/5 via-transparent to-cyan-500/5 p-3 space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Palette className="h-3 w-3 text-violet-400" /> Equipped Cosmetics
                </p>
                <div className="flex flex-col gap-1.5">
                  {cosmetics.frame && (
                    <div className="flex items-center gap-2 rounded-lg bg-background/80 px-2.5 py-1.5">
                      <div className="h-5 w-5 rounded-full border-2" style={{ borderColor: cosmetics.frame.color || '#8b5cf6' }} />
                      <span className="text-xs font-medium">{cosmetics.frame.name || 'Frame'}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">Frame</Badge>
                    </div>
                  )}
                  {(cosmetics.aura || cosmetics.effect) && (
                    <div className="flex items-center gap-2 rounded-lg bg-background/80 px-2.5 py-1.5">
                      <div className="relative h-5 w-5">
                        <div className="absolute inset-0 rounded-full" style={{ background: `radial-gradient(circle, ${(cosmetics.aura || cosmetics.effect)?.color || '#06b6d4'}60, transparent)`, animation: 'pulse 2s ease-in-out infinite' }} />
                        <Zap className="absolute inset-0.5 h-3.5 w-3.5" style={{ color: (cosmetics.aura || cosmetics.effect)?.color || '#06b6d4' }} />
                      </div>
                      <span className="text-xs font-medium">{(cosmetics.aura || cosmetics.effect)?.name || 'Effect'}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">Effect</Badge>
                    </div>
                  )}
                  {cosmetics.badge && (
                    <div className="flex items-center gap-2 rounded-lg bg-background/80 px-2.5 py-1.5">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20">
                        <Flame className="h-3 w-3 text-amber-400" />
                      </div>
                      <span className="text-xs font-medium">{cosmetics.badge.name || 'Badge'}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">Badge</Badge>
                    </div>
                  )}
                  {cosmetics.font && (
                    <div className="flex items-center gap-2 rounded-lg bg-background/80 px-2.5 py-1.5">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/20">
                        <span className="text-[10px] font-bold text-sky-400">Aa</span>
                      </div>
                      <span className="text-xs font-medium">{cosmetics.font.name || 'Font'}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">Font</Badge>
                    </div>
                  )}
                  {cosmetics.cardEffect && (
                    <div className="flex items-center gap-2 rounded-lg bg-background/80 px-2.5 py-1.5">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-pink-500/20">
                        <Wand2 className="h-3 w-3 text-pink-400" />
                      </div>
                      <span className="text-xs font-medium">{cosmetics.cardEffect.name || 'Card Effect'}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">Card</Badge>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {!isOwnProfile && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <BlockUserButton
                targetUserId={profile.id}
                targetUsername={profile.username}
                className="h-8 rounded-full px-3 text-xs"
                onChanged={() => {
                  // Blocking hides the profile behind a restricted wall; unblocking restores it.
                  void fetchProfile({ silent: true })
                }}
              />
              <ReportContentButton
                contentType="profile"
                contentId={profile.id}
                variant="button"
                label="Report"
                className="h-8 rounded-full px-3 text-xs text-muted-foreground"
              />
            </div>
          )}
        </div>
        </div>
      </div>

      {!isOwnProfile && !canViewFull ? (
        <div className="w-full lg:pt-4">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/80 bg-muted/40 px-6 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">
                {(profile as any).is_blocked ? "You can't view this profile" : "This account is private"}
              </h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {(profile as any).is_blocked
                  ? profile.block_direction === "by_me"
                    ? `You blocked @${profile.username}, so their content is hidden. Unblock to see it again.`
                    : "This account isn't available to you. They may have blocked you."
                  : `${displayName || profile.username} hasn't approved you as a follower yet. Loops, branches, media, and awards are hidden until your follow request is accepted.`}
              </p>
            </div>
            {(profile as any).is_blocked && profile.block_direction === "by_me" ? (
              <BlockUserButton
                targetUserId={profile.id}
                targetUsername={profile.username}
                initialBlocked={true}
                className="rounded-full px-5"
                onChanged={() => void fetchProfile({ silent: true })}
              />
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => {
                    if (!user) {
                      toast({ title: "Sign in required", description: "Please sign in to continue." })
                      return
                    }
                    void handleFollow()
                  }}
                  className={cn(
                    "rounded-full px-5 font-semibold",
                    followRequestPending
                      ? "border border-border bg-transparent text-foreground hover:bg-muted"
                      : "bg-foreground text-background hover:opacity-90",
                  )}
                >
                  {followRequestPending ? "Requested ✓ — tap to withdraw" : "Request to follow"}
                </Button>
                {user && followRequestPending && (
                  <p className="text-xs text-muted-foreground">
                    You'll see their content once they accept.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full lg:pt-4">
        <TabsList className="flex h-auto w-full justify-stretch overflow-x-auto rounded-none border-b border-border/70 bg-transparent p-0">
          {[
            { id: "about", label: "About" },
            { id: "loops", label: "Loops" },
            { id: "branches", label: "Branches" },
            { id: "media", label: "Media" },
            { id: "work", label: "Creative work" },
            { id: "awards", label: "Awards" },
          ].map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="min-w-[4.5rem] flex-1 rounded-none border-b-2 border-transparent px-2 py-3 text-xs font-semibold text-muted-foreground data-[state=active]:border-sky-500 data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:text-sm"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="about" className="mt-0 space-y-4">
          {/* Profile Completion Indicator (own profile only) */}
          {isOwnProfile && (
            <ProfileCompletionIndicator profile={profile} />
          )}

          {/* About Tab Content */}
          <ProfileAboutTab
            profile={{
              ...profile,
              stats: {
                loops_count: profile.loops_count ?? 0,
                branches_count: profile.branches_count ?? 0,
                followers_count: profile.followers_count ?? 0,
                following_count: profile.following_count ?? 0,
                likes_received: profile.likes_received ?? 0,
                views_received: (profile as any).views_received ?? 0,
              },
            }}
            isOwnProfile={isOwnProfile}
            onEdit={() => router.push("/settings?tab=profile")}
          />

          {/* Activity Heatmap */}
          <ActivityHeatmap userId={profile.id} />

          {/* Similar Creators */}
          {!isOwnProfile && (
            <SimilarCreators
              currentUserId={profile.id}
              circles={profile.tagged_circles}
            />
          )}
        </TabsContent>

        <TabsContent value="loops" className="mt-0 space-y-0">
          {(() => {
            const pinnedLoops = (profile.recent_loops || []).filter((l: any) => l.is_pinned)
            const unpinnedLoops = (profile.recent_loops || []).filter((l: any) => !l.is_pinned)
            const canPin = isOwnProfile
            const renderPinButton = (loop: any) => {
              if (!canPin) return null
              if (!loop.is_pinned && pinnedLoops.length >= 3) return null
              return (
                <button
                  type="button"
                  disabled={pinningId === loop.id}
                  onClick={() => handleTogglePin(loop.id, !loop.is_pinned)}
                  className={cn(
                    "absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold shadow-sm backdrop-blur transition-colors",
                    loop.is_pinned
                      ? "border-sky-500/50 bg-sky-500/15 text-sky-500 hover:bg-sky-500/25"
                      : "border-border/60 bg-background/80 text-muted-foreground hover:text-foreground",
                  )}
                  title={loop.is_pinned ? "Unpin from profile" : "Pin to profile (best work)"}
                >
                  {loop.is_pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                  {loop.is_pinned ? "Pinned" : "Pin"}
                </button>
              )
            }

            if (!profile.recent_loops?.length) {
              return <EmptyBlock icon={Flame} label="No loops yet" />
            }

            return (
              <>
                {pinnedLoops.length > 0 && (
                  <div className="border-b border-border/60 bg-muted/20 px-4 py-3">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <Pin className="h-3.5 w-3.5 text-sky-500" /> Pinned
                    </p>
                    <div className="space-y-0 divide-y divide-border/40 rounded-xl border border-border/50 overflow-hidden bg-background">
                      {pinnedLoops.map((loop: any) => (
                        <div key={loop.id} className="relative">
                          {renderPinButton(loop)}
                          <LoopCard loop={loop} className="rounded-none border-0 shadow-none" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {unpinnedLoops.map((loop: any) => (
                  <div key={loop.id} className="relative border-b border-border/60 px-0 py-0">
                    {renderPinButton(loop)}
                    <LoopCard loop={loop} className="rounded-none border-0 shadow-none" />
                  </div>
                ))}
              </>
            )
          })()}
        </TabsContent>

        <TabsContent value="branches" className="mt-0 space-y-0">
          {profile.recent_branches?.length ? (
            profile.recent_branches.map((loop) => (
              <div key={loop.id} className="border-b border-border/60">
                <LoopCard loop={loop} className="rounded-none border-0 shadow-none" />
              </div>
            ))
          ) : (
            <EmptyBlock icon={Share2} label="No branches yet — quote a loop to grow your tree" />
          )}
        </TabsContent>

        <TabsContent value="media" className="mt-0">
          <ProfileMediaGrid
            loops={profile.media_loops?.length
              ? profile.media_loops
              : (profile.recent_loops || []).filter((l: any) => l.media_url || l.media_urls?.length)}
          />
        </TabsContent>

        <TabsContent value="work" className="mt-0 p-4">
          <ProfileCreativeWork userId={profile.id} />
        </TabsContent>

        <TabsContent value="awards" className="mt-0 space-y-6 p-4">
          {profile.id ? (
            <>
              <ProfileAchievementShowcase
                userId={profile.id}
                getAuthHeader={getAuthHeader}
              />
              <section className="space-y-3">
                <div>
                  <h2 className="text-sm font-semibold">Community awards</h2>
                  <p className="text-xs text-muted-foreground">Special recognition granted by the Loop team.</p>
                </div>
                <ProfileAwardsGrid userId={profile.id} />
              </section>
            </>
          ) : (
            <EmptyBlock icon={Trophy} label="No achievements yet" />
          )}
        </TabsContent>
      </Tabs>
      )}
      </div>
      </div>

      {!isOwnProfile && (
        <GiftModal
          open={showGiftModal}
          onOpenChange={setShowGiftModal}
          recipient={{
            id: profile.id,
            username: profile.username,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url,
          }}
          context={{ type: "profile", id: profile.id, title: profile.display_name }}
        />
      )}

      {/* Frame a freshly picked cover before uploading it. */}
      <ImageCropDialog
        open={Boolean(coverCrop)}
        file={coverCrop}
        aspect={3}
        outputWidth={1500}
        busy={uploadingCover}
        title="Crop your cover photo"
        description="Drag and zoom to choose what shows behind your profile picture."
        onCancel={() => setCoverCrop(null)}
        onConfirm={async (file) => {
          setCoverCrop(null)
          await uploadCover(file)
        }}
      />

      {/* Tap the profile photo or cover → full-screen viewer (pinch/double-tap
          zoom, swipe, Escape to close) reusing the app's media viewer. */}
      {photoViewer && (
        <EnhancedMediaViewer
          open
          onOpenChange={(open) => {
            if (!open) setPhotoViewer(null)
          }}
          media={[{ url: photoViewer.url, type: photoViewer.type, alt: photoViewer.alt }]}
          alt={photoViewer.alt}
        />
      )}
    </div>
  )
}

function EmptyBlock({ icon: Icon, label }: { icon: typeof Flame; label: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

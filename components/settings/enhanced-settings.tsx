"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ProxyImg } from "@/components/ui/proxy-img"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { isProUser, PRO_PRICING } from "@/lib/pro-features"
import { PROFILE_CUSTOM_CSS_MAX_LENGTH, validateProfileCustomCss } from "@/lib/profile-custom-css"
import { uploadMediaFile } from "@/lib/client-media-upload"
import { ensureServiceWorker, subscribeToPush, subscriptionToJSON, unsubscribeFromPush } from "@/lib/push-client"
import {
  MAX_BIO_COMMUNITY_TAGS,
  serializeCircleBioToken,
  type TaggedCircle,
} from "@/lib/circle-limits"
import {
  User,
  Bell,
  Shield,
  Palette,
  Moon,
  Sun,
  Camera,
  Save,
  Crown,
  Star,
  Users,
  Monitor,
  X,
  Building2,
  Gift,
  Trash2,
  AtSign,
  Info,
  Accessibility,
  UserCog,
  BadgeCheck,
  Code2,
  Lock,
} from "lucide-react"
import { OrganizationSettings } from "@/components/settings/organization-settings"
import { ReferralsSettings } from "@/components/settings/referrals-settings"
import { SecuritySettings } from "@/components/settings/security-settings"
import { SecuritySessions } from "@/components/settings/security-sessions"
import { CommunitySettings } from "@/components/settings/community-settings"
import { AboutSettings } from "@/components/settings/about-settings"
import { AccessibilitySettings } from "@/components/settings/accessibility-settings"
import { AccountSettings } from "@/components/settings/account-settings"
import { VerificationSettings } from "@/components/settings/verification-settings"
import { VideoMediaSettings } from "@/components/cosmetics/video-media-settings"
import { ImageCropDialog } from "@/components/ui/image-crop-dialog"
import { AccountSwitcher } from "@/components/accounts/account-switcher"
import { useDataSaver } from "@/hooks/use-data-saver"
import { cn } from "@/lib/utils"

const PRONOUN_CHOICES = ["she/her", "he/him", "they/them", "she/they", "he/they", "any/all"]

const themeOptions = [
  { id: "light", name: "Light", icon: Sun, description: "Bright surfaces and dark text" },
  { id: "dark", name: "Dark", icon: Moon, description: "Dim surfaces and light text" },
  { id: "system", name: "System", icon: Monitor, description: "Match your device setting" },
]

export function EnhancedSettings() {
  const router = useRouter()
  const { user, getAuthHeader, applyServerProfile, refreshUser } = useAuth()
  const { theme, setTheme, resolvedTheme } = useTheme()
  const { toast } = useToast()
  const dataSaver = useDataSaver()
  const searchParams = useSearchParams()
  const requestedTab = searchParams?.get("tab") || "profile"
  const [tab, setTab] = useState(requestedTab)
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  // Files waiting in the cropper — an avatar (1:1 circle) or a banner (3:1).
  const [avatarCrop, setAvatarCrop] = useState<File | null>(null)
  const [coverCrop, setCoverCrop] = useState<File | null>(null)
  const [pushBusy, setPushBusy] = useState(false)
  const [testPushBusy, setTestPushBusy] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("default")

  const [formData, setFormData] = useState({
    display_name: "",
    username: "",
    bio: "",
    email: "",
    website: "",
    location: "",
    pronouns: "",
    profile_custom_css: "",
    privacy: {
      profile_visibility: "public",
      show_email: false,
      allow_messages: true,
      message_privacy: "everyone" as "everyone" | "followers" | "nobody",
      allow_friend_requests: true,
    },
    notifications: {
      email_notifications: true,
      push_notifications: true,
      loop_likes: true,
      loop_comments: true,
      new_followers: true,
      mentions: true,
      circle_invites: true,
      promotional: false,
      quiet_hours: {
        enabled: false,
        start: "22:00",
        end: "08:00",
        time_zone: "UTC",
      },
    },
  })
  const profileCssValidation = validateProfileCustomCss(formData.profile_custom_css)
  const [taggedCircles, setTaggedCircles] = useState<TaggedCircle[]>([])
  const [joinedCircles, setJoinedCircles] = useState<TaggedCircle[]>([])
  const [loadingCircles, setLoadingCircles] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (typeof window === "undefined") return
    const isIosSafariTab =
      /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !(window.navigator as any).standalone &&
      !window.matchMedia("(display-mode: standalone)").matches
    if (!("Notification" in window) || !("PushManager" in window) || isIosSafariTab) {
      setPushPermission("unsupported")
    } else {
      setPushPermission(Notification.permission)
    }
  }, [])

  // Toggling this switch used to only flip a preference flag in
  // notification_settings — it never actually called the browser Push API,
  // so users who enabled it here (the most discoverable place to do so)
  // never got a real subscription and push silently never fired. This now
  // drives the real subscribe/unsubscribe flow, same as the Notifications
  // page's push manager.
  const handleTogglePush = async (checked: boolean) => {
    if (pushPermission === "unsupported") {
      toast({
        title: "Push isn't supported here",
        description: /iphone|ipad|ipod/i.test(navigator.userAgent)
          ? "On iPhone/iPad, add Loop to your Home Screen first (Share → Add to Home Screen), then enable push from there."
          : "This browser doesn't support Web Push notifications.",
        variant: "destructive",
      })
      return
    }

    setPushBusy(true)
    try {
      if (checked) {
        await ensureServiceWorker()
        const subscription = await subscribeToPush()
        if (!subscription) throw new Error("Browser did not return a push subscription")
        const payload = subscriptionToJSON(subscription)
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "Failed to save subscription")
        setPushPermission("granted")
        toast({ title: "Push notifications enabled", description: "You'll get alerts even when Loop is in the background." })
      } else {
        const endpoint = await unsubscribeFromPush()
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify(endpoint ? { endpoint } : {}),
        })
        toast({ title: "Push notifications disabled" })
      }
      setFormData((prev) => ({
        ...prev,
        notifications: { ...prev.notifications, push_notifications: checked },
      }))
    } catch (err: any) {
      setPushPermission(typeof Notification !== "undefined" ? Notification.permission : "default")
      toast({
        title: "Push setup failed",
        description: err.message || "Could not update push notifications.",
        variant: "destructive",
      })
    } finally {
      setPushBusy(false)
    }
  }

  useEffect(() => {
    if (!user) return
    const privacy = (user as any).privacy_settings || {}
    const notifications = (user as any).notification_settings || {}
    const storedQuietHours = notifications.quiet_hours && typeof notifications.quiet_hours === "object"
      ? notifications.quiet_hours
      : {}
    let deviceTimeZone = "UTC"
    try {
      deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    } catch {
      deviceTimeZone = "UTC"
    }
    setFormData({
      display_name: user.display_name || "",
      username: user.username || "",
      bio: user.bio || "",
      email: user.email || "",
      website: user.website || "",
      location: user.location || "",
      pronouns: (user as any).pronouns || "",
      profile_custom_css: user.profile_custom_css || "",
      privacy: {
        profile_visibility: privacy.profile_visibility || "public",
        show_email: Boolean(privacy.show_email),
        allow_messages: privacy.allow_messages !== false && privacy.message_privacy !== "none" && privacy.message_privacy !== "nobody",
        message_privacy:
          privacy.message_privacy === "followers" || privacy.message_privacy === "nobody"
            ? privacy.message_privacy
            : privacy.message_privacy === "none"
              ? "nobody"
              : "everyone",
        allow_friend_requests: privacy.allow_friend_requests !== false,
      },
      notifications: {
        email_notifications: notifications.email !== false && notifications.email_notifications !== false,
        push_notifications: notifications.push !== false && notifications.push_notifications !== false,
        loop_likes: notifications.loop_likes !== false,
        loop_comments: notifications.loop_comments !== false,
        new_followers: notifications.new_followers !== false,
        mentions: notifications.mentions !== false,
        circle_invites: notifications.circle_invites !== false,
        promotional: Boolean(notifications.promotional),
        quiet_hours: {
          enabled: storedQuietHours.enabled === true,
          start: typeof storedQuietHours.start === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(storedQuietHours.start)
            ? storedQuietHours.start
            : "22:00",
          end: typeof storedQuietHours.end === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(storedQuietHours.end)
            ? storedQuietHours.end
            : "08:00",
          time_zone: typeof storedQuietHours.time_zone === "string" && storedQuietHours.time_zone.trim()
            ? storedQuietHours.time_zone
            : deviceTimeZone,
        },
      },
    })
    const existingTags = Array.isArray((user as any).tagged_circles) ? (user as any).tagged_circles : []
    setTaggedCircles(
      existingTags
        .filter((t: any) => t?.id && t?.name)
        .map((t: any) => ({ id: t.id, name: t.name, avatar_url: t.avatar_url || null })),
    )
  }, [user])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      setLoadingCircles(true)
      try {
        const res = await fetch("/api/circles?joined=true", { headers: { ...getAuthHeader() } })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || cancelled) return
        const mine = (data.circles || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          avatar_url: c.avatar_url || null,
        }))
        setJoinedCircles(mine)
      } catch {
        if (!cancelled) setJoinedCircles([])
      } finally {
        if (!cancelled) setLoadingCircles(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  // Real-time save for switches (Alerts + Privacy tabs): toggling a switch
  // applies immediately instead of waiting for the Save button.
  const quickSave = async (patch: Record<string, unknown>) => {
    if (!user) return
    try {
      const response = await fetch("/api/users/update-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify(patch),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to save")
      if (data.profile) applyServerProfile(data.profile)
      return true
    } catch (error: any) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" })
      return false
    }
  }

  const updateQuietHours = (patch: Partial<typeof formData.notifications.quiet_hours>) => {
    const next = {
      ...formData.notifications,
      quiet_hours: { ...formData.notifications.quiet_hours, ...patch },
    }
    setFormData((prev) => ({ ...prev, notifications: next }))
    void quickSave({ notification_settings: next })
  }

  const saveSettings = async () => {
    if (!user) return
    if (isProUser(user) && !profileCssValidation.valid) {
      toast({
        title: "Custom CSS needs a fix",
        description: profileCssValidation.error,
        variant: "destructive",
      })
      setTab("profile")
      return
    }
    setLoading(true)
    try {
      const response = await fetch("/api/users/update-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          username: formData.username,
          display_name: formData.display_name,
          bio: formData.bio,
          website: formData.website,
          location: formData.location,
          pronouns: formData.pronouns,
          profile_custom_css: isProUser(user) ? profileCssValidation.value : undefined,
          tagged_circles: taggedCircles,
          privacy_settings: {
            profile_visibility: formData.privacy.profile_visibility,
            show_email: formData.privacy.show_email,
            message_privacy: formData.privacy.message_privacy,
            allow_messages: formData.privacy.message_privacy !== "nobody",
            allow_friend_requests: formData.privacy.allow_friend_requests,
          },
          notification_settings: {
            email: formData.notifications.email_notifications,
            push: formData.notifications.push_notifications,
            in_app: true,
            email_notifications: formData.notifications.email_notifications,
            push_notifications: formData.notifications.push_notifications,
            loop_likes: formData.notifications.loop_likes,
            loop_comments: formData.notifications.loop_comments,
            new_followers: formData.notifications.new_followers,
            mentions: formData.notifications.mentions,
            circle_invites: formData.notifications.circle_invites,
            promotional: formData.notifications.promotional,
            quiet_hours: formData.notifications.quiet_hours,
          },
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to save")
      if (Array.isArray(data.profile?.tagged_circles)) {
        setTaggedCircles(data.profile.tagged_circles)
      }

      if (data.profile) applyServerProfile(data.profile)
      await refreshUser()
      toast({ title: "Settings saved", description: "Your preferences are up to date." })
      // If username changed, redirect to the new profile URL so links stay valid
      if (formData.username && formData.username !== user.username && data.profile?.username) {
        router.push(`/profile/${data.profile.username}`)
      }
    } catch (error: any) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  /** Static raster images get the cropper; GIFs and videos keep their frames. */
  const canCropImage = (file: File) =>
    file.type.startsWith("image/") && file.type !== "image/gif" && file.type !== "image/svg+xml"

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset first so re-picking the same file still fires onChange.
    event.target.value = ""
    if (!file || !user) return
    // Animated GIF avatars are a Pro-only perk — friendly guard before upload.
    if (file.type === "image/gif" && !user.is_premium) {
      toast({
        title: "GIF avatars are Pro-only",
        description: "Upgrade to Pro to use an animated profile picture. Static images work for everyone.",
        variant: "destructive",
      })
      return
    }
    if (canCropImage(file)) {
      setAvatarCrop(file)
      return
    }
    void uploadAvatar(file)
  }

  const uploadAvatar = async (file: File) => {
    if (!user) return
    setUploading(true)
    try {
      // Phone camera photos routinely exceed Vercel's ~4.5MB request body
      // limit for the Next.js API proxy; uploadMediaFile automatically
      // routes anything over that straight to Cloudinary instead.
      const uploaded = await uploadMediaFile(file, {
        type: "image",
        folder: "avatars",
        authHeaders: getAuthHeader(),
      })

      const response = await fetch("/api/users/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ avatar_url: uploaded.url }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to update avatar")
      if (data.profile) applyServerProfile(data.profile)
      toast({ title: "Avatar updated", description: file.type === "image/gif" ? "Animated GIF saved." : undefined })
    } catch (error: any) {
      toast({ title: "Avatar upload failed", description: error.message, variant: "destructive" })
    } finally {
      setUploading(false)
    }
  }

  const handleCoverUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset first so re-picking the same file still fires onChange.
    event.target.value = ""
    if (!file || !user) return
    // Animated GIF covers are a Pro-only perk — friendly guard before upload.
    if (file.type === "image/gif" && !user.is_premium) {
      toast({
        title: "GIF covers are Pro-only",
        description: "Upgrade to Pro to use an animated cover photo. Static images work for everyone.",
        variant: "destructive",
      })
      return
    }
    if (canCropImage(file)) {
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

      const response = await fetch("/api/users/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ banner_url: uploaded.url }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to update cover")
      if (data.profile) applyServerProfile(data.profile)
      toast({ title: "Cover updated", description: file.type === "image/gif" ? "Animated GIF cover saved." : undefined })
    } catch (error: any) {
      toast({ title: "Cover upload failed", description: error.message, variant: "destructive" })
    } finally {
      setUploadingCover(false)
    }
  }

  const applyAppearance = async (nextTheme: string) => {
    setTheme(nextTheme)
    try {
      const response = await fetch("/api/users/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({
          appearance_mode: nextTheme,
        }),
      })
      const data = await response.json()
      if (response.ok && data.profile) applyServerProfile(data.profile)
    } catch {
      // Theme still applies locally via next-themes
    }
  }

  useEffect(() => {
    if (!mounted || !user) return
    const saved =
      (user.theme_data && typeof user.theme_data === "object"
        ? (user.theme_data as { mode?: string }).mode
        : undefined) ||
      (user.theme_preferences &&
      typeof user.theme_preferences === "object" &&
      !("colors" in (user.theme_preferences as object))
        ? (user.theme_preferences as { mode?: string }).mode
        : undefined)
    if (saved && ["light", "dark", "system"].includes(saved) && theme !== saved) {
      setTheme(saved)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, user?.id])

  if (!user) {
    return <p className="text-muted-foreground">Sign in to manage settings.</p>
  }

  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/40 p-1 sm:grid-cols-6">
          <TabsTrigger value="profile" className="rounded-xl data-[state=active]:bg-background">
            <User className="mr-2 h-4 w-4" /> Profile
          </TabsTrigger>
          <TabsTrigger value="appearance" className="rounded-xl data-[state=active]:bg-background">
            <Palette className="mr-2 h-4 w-4" /> Appearance
          </TabsTrigger>
          <TabsTrigger value="notifications" className="rounded-xl data-[state=active]:bg-background">
            <Bell className="mr-2 h-4 w-4" /> Alerts
          </TabsTrigger>
          <TabsTrigger value="privacy" className="rounded-xl data-[state=active]:bg-background">
            <Shield className="mr-2 h-4 w-4" /> Privacy
          </TabsTrigger>
          <TabsTrigger value="community" className="rounded-xl data-[state=active]:bg-background">
            <Users className="mr-2 h-4 w-4" /> Community
          </TabsTrigger>
          <TabsTrigger value="organization" className="rounded-xl data-[state=active]:bg-background">
            <Building2 className="mr-2 h-4 w-4" /> Organization
          </TabsTrigger>
          <TabsTrigger value="referrals" className="rounded-xl data-[state=active]:bg-background">
            <Gift className="mr-2 h-4 w-4" /> Referrals
          </TabsTrigger>
          <TabsTrigger value="verification" className="rounded-xl data-[state=active]:bg-background">
            <BadgeCheck className="mr-2 h-4 w-4" /> Verification
          </TabsTrigger>
          <TabsTrigger value="account" className="rounded-xl data-[state=active]:bg-background">
            <UserCog className="mr-2 h-4 w-4" /> Account
          </TabsTrigger>
          <TabsTrigger value="security" className="rounded-xl data-[state=active]:bg-background">
            <Shield className="mr-2 h-4 w-4" /> Security
          </TabsTrigger>
          <TabsTrigger value="video-media" className="rounded-xl data-[state=active]:bg-background">
            <Camera className="mr-2 h-4 w-4" /> Video Media
          </TabsTrigger>
          <TabsTrigger value="accounts" className="rounded-xl data-[state=active]:bg-background">
            <Users className="mr-2 h-4 w-4" /> Accounts
          </TabsTrigger>
          <TabsTrigger value="accessibility" className="rounded-xl data-[state=active]:bg-background">
            <Accessibility className="mr-2 h-4 w-4" /> Accessibility
          </TabsTrigger>
          <TabsTrigger value="about" className="rounded-xl data-[state=active]:bg-background">
            <Info className="mr-2 h-4 w-4" /> About
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Invite friends</CardTitle>
              <CardDescription>Share Loop with people who should be in your circles.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="rounded-full">
                <Link href="/invite"><Users className="mr-2 h-4 w-4" /> Open invite flow</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>These details appear on your public profile.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src={user.avatar_url} />
                    <AvatarFallback>{formData.display_name.charAt(0) || "U"}</AvatarFallback>
                  </Avatar>
                  <Button
                    type="button"
                    size="icon"
                    aria-label="Change profile picture"
                    className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full"
                    disabled={uploading}
                    onClick={() => document.getElementById("avatar-upload")?.click()}
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                  <input id="avatar-upload" type="file" accept="image/*,.gif,image/gif" className="hidden" onChange={handleAvatarUpload} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{formData.display_name || "Your name"}</h3>
                    {user.is_verified && <Badge variant="secondary"><Star className="mr-1 h-3 w-3" />Verified</Badge>}
                    {user.is_premium && <Badge><Crown className="mr-1 h-3 w-3" />Premium</Badge>}
                    {!user.is_premium && (
                      <Link href="/premium">
                        <Badge variant="outline" className="cursor-pointer border-amber-500/40 text-amber-600 hover:bg-amber-500/10">
                          <Crown className="mr-1 h-3 w-3" /> Get Pro · {PRO_PRICING.monthly.priceLabel}
                        </Badge>
                      </Link>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">@{formData.username}</p>
                  <p className="text-xs text-muted-foreground">JPG, PNG, or animated GIF — you can crop it before saving</p>
                  {uploading && <p className="text-xs text-muted-foreground">Uploading avatar…</p>}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Cover photo</Label>
                <div className="relative h-28 overflow-hidden rounded-xl border border-border bg-muted">
                  {user.banner_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <ProxyImg src={user.banner_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      No cover yet
                    </div>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label="Change cover photo"
                    className="absolute bottom-2 right-2 rounded-full"
                    disabled={uploadingCover}
                    onClick={() => document.getElementById("cover-upload")?.click()}
                  >
                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                    {uploadingCover ? "Uploading…" : "Edit cover"}
                  </Button>
                  <input id="cover-upload" type="file" accept="image/*,.gif,image/gif" className="hidden" onChange={handleCoverUpload} />
                </div>
                <p className="text-xs text-muted-foreground">Crop it before saving. Animated GIF covers are Pro-only.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="display_name">Display name</Label>
                  <Input
                    id="display_name"
                    value={formData.display_name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, display_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={formData.username}
                    onChange={(e) => {
                      const val = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")
                      setFormData((prev) => ({ ...prev, username: val }))
                    }}
                    placeholder="lowercase, letters, numbers, underscores"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Your profile URL: /profile/{formData.username || "..."} · You can change your username once every 2 weeks.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    value={formData.website}
                    onChange={(e) => setFormData((prev) => ({ ...prev, website: e.target.value }))}
                    placeholder="https://"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData((prev) => ({ ...prev, location: e.target.value }))}
                    placeholder="City, Country"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={formData.bio}
                  maxLength={500}
                  onChange={(e) => setFormData((prev) => ({ ...prev, bio: e.target.value }))}
                  className="min-h-[110px]"
                />
                <p className="text-xs text-muted-foreground">{formData.bio.length}/500</p>
              </div>

              {/* Pronouns — e.g. she/her, he/him, they/them */}
              <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex items-center gap-2">
                  <AtSign className="h-4 w-4 text-primary" />
                  <div>
                    <Label className="font-semibold">Pronouns</Label>
                    <p className="text-xs text-muted-foreground">
                      Shown next to your name on your profile so people know how to refer to you.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {PRONOUN_CHOICES.map((p) => {
                    const active = (formData.pronouns || "").toLowerCase() === p
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, pronouns: active ? "" : p }))}
                        className={
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition " +
                          (active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:border-primary/40")
                        }
                      >
                        {p}
                      </button>
                    )
                  })}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="pronouns">Or write your own</Label>
                  <Input
                    id="pronouns"
                    value={formData.pronouns}
                    maxLength={60}
                    onChange={(e) => setFormData((prev) => ({ ...prev, pronouns: e.target.value }))}
                    placeholder="e.g. she/her, he/him, they/them"
                  />
                  <p className="text-[10px] text-muted-foreground">Leave empty to remove pronouns from your profile.</p>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Label className="inline-flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-primary" />
                      Tag communities in your bio
                    </Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Others can tap a tag to open that community. Up to {MAX_BIO_COMMUNITY_TAGS}.
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {taggedCircles.length}/{MAX_BIO_COMMUNITY_TAGS}
                  </Badge>
                </div>

                {taggedCircles.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {taggedCircles.map((tag) => (
                      <Badge key={tag.id} variant="secondary" className="gap-1.5 py-1.5 pl-2 pr-1">
                        <span className="max-w-[140px] truncate">{tag.name}</span>
                        <button
                          type="button"
                          className="rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive"
                          onClick={() => {
                            setTaggedCircles((prev) => prev.filter((t) => t.id !== tag.id))
                            setFormData((prev) => ({
                              ...prev,
                              bio: prev.bio.replace(new RegExp(`\\[\\[c:${tag.id}(?:\\|[^\\\]]+)?\\]\\]`, "gi"), "").replace(/\s+/g, " ").trim()
                            }))
                          }}
                          aria-label={`Remove ${tag.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {loadingCircles ? (
                    <p className="text-xs text-muted-foreground">Loading your communities…</p>
                  ) : joinedCircles.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Join or create a community first, then tag it here.
                    </p>
                  ) : (
                    joinedCircles
                      .filter((c) => !taggedCircles.some((t) => t.id === c.id))
                      .slice(0, 12)
                      .map((circle) => (
                        <Button
                          key={circle.id}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-full"
                          disabled={taggedCircles.length >= MAX_BIO_COMMUNITY_TAGS}
                          onClick={() => {
                            setTaggedCircles((prev) => {
                              if (prev.some((t) => t.id === circle.id) || prev.length >= MAX_BIO_COMMUNITY_TAGS) {
                                return prev
                              }
                              return [...prev, circle]
                            })
                            // Also drop a tappable token into the bio when there's room
                            const token = serializeCircleBioToken(circle)
                            setFormData((prev) => {
                              if (prev.bio.includes(token) || prev.bio.length + token.length + 1 > 500) {
                                return prev
                              }
                              const next = prev.bio.trim() ? `${prev.bio.trim()} ${token}` : token
                              return { ...prev, bio: next.slice(0, 500) }
                            })
                          }}
                        >
                          + {circle.name}
                        </Button>
                      ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <Code2 className="h-4 w-4 text-primary" />
                    Custom profile CSS
                  </CardTitle>
                  <CardDescription>
                    Fine-tune the look of your profile with your own CSS. Changes only affect your profile page.
                  </CardDescription>
                </div>
                {isProUser(user) ? (
                  <Badge variant="secondary">LOOP Pro</Badge>
                ) : (
                  <Badge variant="outline" className="gap-1.5">
                    <Lock className="h-3 w-3" /> Pro only
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {isProUser(user) ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="profile_custom_css">Stylesheet</Label>
                    <Textarea
                      id="profile_custom_css"
                      value={formData.profile_custom_css}
                      maxLength={PROFILE_CUSTOM_CSS_MAX_LENGTH}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoComplete="off"
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, profile_custom_css: event.target.value }))
                      }
                      className="min-h-[240px] resize-y font-mono text-xs leading-relaxed"
                      placeholder={".profile-name {\n  color: #a78bfa;\n  text-shadow: 0 0 14px rgba(167, 139, 250, .35);\n}\n\n.profile-card {\n  border-radius: 20px;\n  border-color: #a78bfa;\n}"}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">
                        Rules are automatically scoped to your profile.
                      </span>
                      <span className={formData.profile_custom_css.length > PROFILE_CUSTOM_CSS_MAX_LENGTH ? "text-destructive" : "text-muted-foreground"}>
                        {formData.profile_custom_css.length.toLocaleString()}/{PROFILE_CUSTOM_CSS_MAX_LENGTH.toLocaleString()}
                      </span>
                    </div>
                    {!profileCssValidation.valid && (
                      <p role="alert" className="text-xs text-destructive">
                        {profileCssValidation.error}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    Allowed: colours, backgrounds, typography, borders, shadows, spacing and gradients.
                    At-rules, scripts, remote assets and page-wide selectors are blocked.
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Make your profile your own</p>
                    <p className="text-sm text-muted-foreground">
                      Custom CSS is included with LOOP Pro from {PRO_PRICING.monthly.priceLabel}{PRO_PRICING.monthly.period}.
                      Your stylesheet is kept while your membership is inactive and resumes when Pro is active again.
                    </p>
                  </div>
                  <Button asChild className="shrink-0 rounded-full">
                    <Link href="/premium">
                      <Crown className="mr-2 h-4 w-4" /> Get LOOP Pro
                    </Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Color theme</CardTitle>
              <CardDescription>
                Light and dark are your main look (white / black). Shop themes add accent colors on top — both keep working together. Current:{" "}
                {mounted ? resolvedTheme || theme : "…"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                {themeOptions.map((option) => {
                  const Icon = option.icon
                  const active = mounted && theme === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => void applyAppearance(option.id)}
                      className={cn(
                        "rounded-2xl border p-4 text-left transition",
                        active
                          ? "border-primary bg-primary/10 shadow-sm"
                          : "border-border bg-card hover:bg-muted/50",
                      )}
                    >
                      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                        <Icon className="h-5 w-5" />
                      </div>
                      <p className="font-medium">{option.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
                    </button>
                  )
                })}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-border bg-background p-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Light preview</p>
                  <div className="rounded-xl bg-white p-3 text-slate-900 shadow-sm">
                    <div className="mb-2 h-2 w-1/2 rounded bg-slate-200" />
                    <div className="h-2 w-3/4 rounded bg-slate-100" />
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-background p-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Dark preview</p>
                  <div className="rounded-xl bg-slate-950 p-3 text-slate-100 shadow-sm">
                    <div className="mb-2 h-2 w-1/2 rounded bg-slate-700" />
                    <div className="h-2 w-3/4 rounded bg-slate-800" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data saver</CardTitle>
              <CardDescription>
                For slow or metered connections: no autoplay, lighter images and calmer effects.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-3">
                <div>
                  <Label htmlFor="data_saver">Data saver mode</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {dataSaver.enabled ? "On — tap media to load it in full quality" : "Off — full quality everywhere"}
                  </p>
                </div>
                <Switch
                  id="data_saver"
                  checked={dataSaver.enabled}
                  onCheckedChange={dataSaver.setEnabled}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>Choose what Loop can notify you about.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-3">
                <div>
                  <Label htmlFor="push_notifications">Push notifications</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {pushPermission === "unsupported"
                      ? /iphone|ipad|ipod/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "")
                        ? "Add Loop to your Home Screen to enable this on iPhone"
                        : "Not supported in this browser"
                      : pushPermission === "denied"
                        ? "Blocked in your browser's site settings"
                        : "Real device alerts, even in the background"}
                  </p>
                </div>
                <Switch
                  id="push_notifications"
                  checked={formData.notifications.push_notifications && pushPermission === "granted"}
                  disabled={pushBusy || pushPermission === "denied" || pushPermission === "unsupported"}
                  onCheckedChange={handleTogglePush}
                />
              </div>
              {pushPermission === "granted" && (
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-3">
                  <div>
                    <Label>Test notification</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">Send a test alert to this device to confirm push works</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full shrink-0"
                    disabled={testPushBusy}
                    onClick={async () => {
                      setTestPushBusy(true)
                      try {
                        const res = await fetch("/api/push/send", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", ...getAuthHeader() },
                          body: JSON.stringify({
                            title: "Loop push works 🎉",
                            message: "This is how notifications from Loop will look.",
                            url: "/notifications",
                            push_only: true,
                            category: "system",
                          }),
                        })
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok) throw new Error(data.error || "Failed to send test")
                        if ((data.deliveredCount ?? 0) > 0) {
                          toast({ title: "Test sent", description: "Check your device for the notification." })
                        } else {
                          toast({
                            title: "No device subscribed",
                            description: "Turn push off and on again to re-register this device.",
                            variant: "destructive",
                          })
                        }
                      } catch (err: any) {
                        toast({ title: "Test failed", description: err.message, variant: "destructive" })
                      } finally {
                        setTestPushBusy(false)
                      }
                    }}
                  >
                    {testPushBusy ? "Sending…" : "Send test"}
                  </Button>
                </div>
              )}
              {(
                [
                  ["email_notifications", "Email notifications"],
                  ["loop_likes", "Likes on your loops"],
                  ["loop_comments", "Comments"],
                  ["new_followers", "New followers"],
                  ["mentions", "Mentions"],
                  ["circle_invites", "Circle invites"],
                  ["promotional", "Product tips & promos"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-3">
                  <Label htmlFor={key}>{label}</Label>
                  <Switch
                    id={key}
                    checked={formData.notifications[key]}
                    onCheckedChange={(checked) => {
                      const next = { ...formData.notifications, [key]: checked }
                      setFormData((prev) => ({ ...prev, notifications: next }))
                      void quickSave({ notification_settings: next })
                    }}
                  />
                </div>
              ))}
              <div className="space-y-3 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="quiet-hours-enabled">Quiet hours</Label>
                    <p className="text-xs text-muted-foreground">
                      Pause browser and native push alerts while keeping your in-app inbox available.
                    </p>
                  </div>
                  <Switch
                    id="quiet-hours-enabled"
                    checked={formData.notifications.quiet_hours.enabled}
                    onCheckedChange={(enabled) => updateQuietHours({ enabled })}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="quiet-hours-start">Start</Label>
                    <Input
                      id="quiet-hours-start"
                      type="time"
                      value={formData.notifications.quiet_hours.start}
                      disabled={!formData.notifications.quiet_hours.enabled}
                      onChange={(event) => updateQuietHours({ start: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="quiet-hours-end">End</Label>
                    <Input
                      id="quiet-hours-end"
                      type="time"
                      value={formData.notifications.quiet_hours.end}
                      disabled={!formData.notifications.quiet_hours.enabled}
                      onChange={(event) => updateQuietHours({ end: event.target.value })}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Times use {formData.notifications.quiet_hours.time_zone}. Matching start and end times pause push alerts all day.
                  Changes save automatically.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="community" className="space-y-4">
          <CommunitySettings />
        </TabsContent>

        <TabsContent value="verification" className="space-y-4">
          <VerificationSettings />
        </TabsContent>

        <TabsContent value="account" className="space-y-4">
          <AccountSettings />
        </TabsContent>

        <TabsContent value="organization" className="space-y-4">
          <OrganizationSettings />
        </TabsContent>

        <TabsContent value="referrals" className="space-y-4">
          <ReferralsSettings />
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <SecuritySettings />
          <SecuritySessions />
        </TabsContent>

        <TabsContent value="privacy" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Video Playback</CardTitle>
              <CardDescription>Control how videos play across the app.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Autoplay videos</Label>
                  <p className="text-xs text-muted-foreground">Videos will automatically play as you scroll through the feed</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={typeof window !== "undefined" && localStorage.getItem("loop-autoplay-videos") === "true"}
                  onClick={() => {
                    const current = localStorage.getItem("loop-autoplay-videos") === "true"
                    localStorage.setItem("loop-autoplay-videos", String(!current))
                    // Force re-render by toggling a state
                    setFormData((prev) => ({ ...prev }))
                  }}
                  className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input"
                >
                  <span className="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" style={{ transform: typeof window !== "undefined" && localStorage.getItem("loop-autoplay-videos") === "true" ? "translateX(20px)" : "translateX(0)" }} />
                </button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Privacy</CardTitle>
              <CardDescription>Control who can see and contact you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Profile visibility</Label>
                <div className="grid grid-cols-2 gap-2">
                  {["public", "private"].map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant={formData.privacy.profile_visibility === value ? "default" : "outline"}
                      onClick={() => {
                        const next = { ...formData.privacy, profile_visibility: value }
                        setFormData((prev) => ({ ...prev, privacy: next }))
                        void quickSave({
                          privacy_settings: {
                            profile_visibility: value,
                            show_email: next.show_email,
                            message_privacy: next.message_privacy || (next.allow_messages ? "everyone" : "nobody"),
                            allow_messages: next.message_privacy ? next.message_privacy !== "nobody" : next.allow_messages,
                            allow_friend_requests: next.allow_friend_requests,
                          },
                        })
                      }}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Who can send you direct messages</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["everyone", "Everyone"],
                      ["followers", "Followers"],
                      ["nobody", "Nobody"],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      variant={formData.privacy.message_privacy === value ? "default" : "outline"}
                      onClick={() => {
                        const next = { ...formData.privacy, message_privacy: value, allow_messages: value !== "nobody" }
                        setFormData((prev) => ({ ...prev, privacy: next }))
                        void quickSave({
                          privacy_settings: {
                            profile_visibility: next.profile_visibility,
                            show_email: next.show_email,
                            message_privacy: value,
                            allow_messages: value !== "nobody",
                            allow_friend_requests: next.allow_friend_requests,
                          },
                        })
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  "Followers" allows messages from people who follow you or whom you follow.
                </p>
              </div>
              {(
                [
                  ["show_email", "Show email on profile"],
                  ["allow_friend_requests", "Allow follow requests / connects"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-3">
                  <Label htmlFor={key}>{label}</Label>
                  <Switch
                    id={key}
                    checked={formData.privacy[key]}
                    onCheckedChange={(checked) => {
                      const next = { ...formData.privacy, [key]: checked }
                      setFormData((prev) => ({ ...prev, privacy: next }))
                      void quickSave({
                        privacy_settings: {
                          profile_visibility: next.profile_visibility,
                          show_email: next.show_email,
                          message_privacy: next.message_privacy || (next.allow_messages ? "everyone" : "nobody"),
                          allow_messages: next.message_privacy ? next.message_privacy !== "nobody" : next.allow_messages,
                          allow_friend_requests: next.allow_friend_requests,
                        },
                      })
                    }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="video-media" className="space-y-4">
          <VideoMediaSettings />
        </TabsContent>

        <TabsContent value="accessibility" className="space-y-4">
          <AccessibilitySettings />
        </TabsContent>

        <TabsContent value="accounts" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <AccountSwitcher variant="settings" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="about" className="space-y-4">
          <AboutSettings />
        </TabsContent>
      </Tabs>

      {/* Save bar — full-width sticky footer inside the form column. It used to
          be a floating rounded pill that overlapped the card behind it. */}
      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:bottom-4 lg:mx-0 lg:rounded-2xl lg:border lg:shadow-lg">
        <p className="hidden text-xs text-muted-foreground sm:block">
          Applies to your profile, privacy and alerts.
        </p>
        <Button onClick={saveSettings} disabled={loading} className="ml-auto rounded-full px-6">
          <Save className="mr-2 h-4 w-4" />
          {loading ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <ImageCropDialog
        open={Boolean(avatarCrop)}
        file={avatarCrop}
        aspect={1}
        shape="circle"
        outputWidth={512}
        busy={uploading}
        title="Crop your profile picture"
        description="Drag and zoom so your face fills the circle — this is what people will see."
        onCancel={() => setAvatarCrop(null)}
        onConfirm={async (file) => {
          setAvatarCrop(null)
          await uploadAvatar(file)
        }}
      />

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
    </div>
  )
}

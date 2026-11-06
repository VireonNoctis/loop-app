"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase-browser"
import { authClient } from "@/lib/auth-client"
import { readCachedUser as readCachedUserFromCache, writeCachedUser as writeCachedUserToCache } from "@/lib/auth-cache"
import type { StaffRole } from "@/lib/staff-roles"

const supabase = getSupabaseBrowserClient()

/** Outcome of a session check. "unknown" = the server never answered. */
type SessionCheckResult = "authenticated" | "unauthenticated" | "unknown"

const readCachedUser = () => readCachedUserFromCache<User>()
const writeCachedUser = (user: User | null) => writeCachedUserToCache(user)

interface User {
  id: string
  email: string
  username: string
  display_name: string
  avatar_url?: string
  video_avatar_url?: string | null
  banner_url?: string
  video_cover_url?: string | null
  bio?: string
  profile_custom_css?: string | null
  tagged_circles?: Array<{ id: string; name: string; avatar_url?: string | null }>
  loop_coins: number
  is_premium: boolean
  premium_expires_at?: string
  is_verified: boolean
  is_team_member?: boolean
  is_moderator?: boolean
  staff_role?: StaffRole | null
  is_sponsor?: boolean
  is_admin: boolean
  is_organization?: boolean
  equipped_frame_id?: string | number | null
  cosmetics?: any
  active_cosmetics?: any
  organization_name?: string
  organization_badge_url?: string
  organization_config?: Record<string, any>
  theme_data?: any
  theme_preferences?: any
  interests?: string[]
  phone?: string
  website?: string
  location?: string
  pronouns?: string | null
  profile_theme?: any
  privacy_settings?: Record<string, unknown>
  notification_settings?: Record<string, unknown>
  verification_level?: string
  onboarding_completed?: boolean
  has_seen_feature_tour?: boolean
  token?: string
  access_token?: string
  user_metadata?: {
    username: string
    display_name: string
    avatar_url?: string
    is_premium: boolean
    is_verified: boolean
  }
}

interface AuthContextType {
  user: User | null
  loading: boolean
  /**
   * True once the session check returned a definitive answer. Auth-gated pages
   * use this to avoid bouncing a signed-in user to /login over a failed check.
   */
  authResolved: boolean
  login: (email: string, password: string) => Promise<void>
  loginWithGoogle: (callbackURL?: string) => Promise<void>
  googleSignIn: (callbackURL?: string) => Promise<void>
  signup: (
    email: string,
    password: string,
    username: string,
    display_name: string,
    invited_via_coloop?: boolean,
    invited_by_username?: string
  ) => Promise<void>
  logout: () => Promise<void>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  getAuthHeader: () => Record<string, string>
  updateProfile: (updates: Partial<User>) => Promise<void>
  updateUser: (updates: Partial<User>) => Promise<void>
  applyServerProfile: (profile: Partial<User> & Record<string, unknown>) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [authResolved, setAuthResolved] = useState(false)
  const userRef = useRef<User | null>(null)

  useEffect(() => {
    userRef.current = user
  }, [user])

  const buildFallbackProfile = (sessionUser: { id: string; email?: string; name?: string; image?: string | null }) => {
    const previous = userRef.current?.id === sessionUser.id ? userRef.current : null

    return {
      email: sessionUser.email,
      username: previous?.username || "",
      display_name: sessionUser.name || previous?.display_name || "",
      id: sessionUser.id,
      avatar_url: sessionUser.image || previous?.avatar_url,
      banner_url: undefined,
      bio: undefined,
      tagged_circles: previous?.tagged_circles ?? [],
      loop_coins: 0,
      is_premium: false,
      premium_expires_at: undefined,
      is_verified: false,
      is_admin: false,
      is_moderator: false,
      staff_role: null,
      is_organization: false,
      theme_data: undefined,
      interests: [],
      onboarding_completed: previous?.onboarding_completed ?? false,
    }
  }

  const mapSessionUser = (
    sessionData: { user: { id: string; email?: string; name?: string; image?: string | null }; session?: { id?: string; token?: string } },
    profileData: Record<string, any>,
  ): User => {
    const previous = userRef.current?.id === sessionData.user.id ? userRef.current : null
    const onboardingCompleted =
      typeof profileData.onboarding_completed === "boolean"
        ? profileData.onboarding_completed
        : previous?.onboarding_completed ?? false

    const preservedOnboarding =
      previous?.onboarding_completed === true && onboardingCompleted !== true
        ? true
        : onboardingCompleted

    const token = sessionData.session?.token || sessionData.session?.id || sessionData.user.id
    const staffRole: StaffRole | null =
      profileData.staff_role === "developer" || profileData.staff_role === "admin" || profileData.staff_role === "moderator"
        ? profileData.staff_role
        : profileData.is_admin === true
          ? "developer"
          : profileData.is_moderator === true
            ? "moderator"
            : null

    return {
      id: sessionData.user.id,
      email: sessionData.user.email || profileData.email || previous?.email || "",
      username: profileData.username || previous?.username || "",
      display_name: profileData.display_name || sessionData.user.name || previous?.display_name || "",
      avatar_url: profileData.avatar_url ?? sessionData.user.image ?? previous?.avatar_url,
      video_avatar_url: profileData.video_avatar_url ?? previous?.video_avatar_url ?? null,
      banner_url: profileData.banner_url ?? previous?.banner_url,
      video_cover_url: profileData.video_cover_url ?? previous?.video_cover_url ?? null,
      bio: profileData.bio ?? previous?.bio,
      tagged_circles: Array.isArray(profileData.tagged_circles)
        ? profileData.tagged_circles
        : previous?.tagged_circles ?? [],
      loop_coins: profileData.loop_coins ?? previous?.loop_coins ?? 0,
      is_premium: profileData.is_premium ?? previous?.is_premium ?? false,
      premium_expires_at: profileData.premium_expires_at ?? previous?.premium_expires_at,
      is_verified: profileData.is_verified ?? previous?.is_verified ?? false,
      is_admin: staffRole === "developer" || staffRole === "admin",
      is_moderator: staffRole === "moderator",
      staff_role: staffRole,
      is_team_member: profileData.is_team_member ?? previous?.is_team_member ?? false,
      is_organization: Boolean(profileData.is_organization ?? previous?.is_organization ?? false),
      organization_name: profileData.organization_name ?? previous?.organization_name,
      organization_badge_url: profileData.organization_badge_url ?? previous?.organization_badge_url,
      organization_config: profileData.organization_config ?? previous?.organization_config,
      theme_data: profileData.theme_data ?? previous?.theme_data,
      theme_preferences: profileData.theme_preferences ?? previous?.theme_preferences,
      interests: profileData.interests ?? previous?.interests ?? [],
      phone: profileData.phone ?? previous?.phone,
      website: profileData.website ?? previous?.website,
      location: profileData.location ?? previous?.location,
      pronouns: profileData.pronouns ?? previous?.pronouns ?? null,
      privacy_settings: profileData.privacy_settings ?? previous?.privacy_settings,
      notification_settings: profileData.notification_settings ?? previous?.notification_settings,
      cosmetics: profileData.cosmetics ?? previous?.cosmetics ?? null,
      active_cosmetics: profileData.active_cosmetics ?? previous?.active_cosmetics ?? null,
      equipped_frame_id: profileData.equipped_frame_id ?? previous?.equipped_frame_id ?? null,
      onboarding_completed: preservedOnboarding,
      has_seen_feature_tour:
        typeof profileData.has_seen_feature_tour === "boolean"
          ? profileData.has_seen_feature_tour
          : previous?.has_seen_feature_tour ?? false,
      token,
      access_token: token,
      user_metadata: {
        username: profileData.username || previous?.username || "",
        display_name: profileData.display_name || previous?.display_name || "",
        avatar_url: profileData.avatar_url ?? previous?.avatar_url,
        is_premium: Boolean(profileData.is_premium ?? previous?.is_premium),
        is_verified: Boolean(profileData.is_verified ?? previous?.is_verified),
      },
    }
  }

  useEffect(() => {
    if (!user?.theme_preferences) return
    if (typeof window === "undefined") return
    const prefs = user.theme_preferences
    if (prefs && typeof prefs === "object" && (prefs as any).colors) {
      window.dispatchEvent(new CustomEvent("loop-profile-theme", { detail: prefs }))
    }
  }, [user?.id, user?.theme_preferences])

  const fetchProfileViaApi = async (accessToken: string) => {
    try {
      const controller = new AbortController()
      // A cold server compiles the auth route on first hit — comfortably more
      // than the old 4s ceiling, which used to abort and read as "no profile".
      const timeout = setTimeout(() => controller.abort(), 12000)
      const response = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!response.ok) return null
      const data = await response.json()
      return data.profile || null
    } catch (error) {
      console.error("API profile refresh failed:", error)
      return null
    }
  }

  const hydrateSessionUser = async (): Promise<SessionCheckResult> => {
    const sessionRes = await authClient.getSession().catch(() => null)

    // A failed request is NOT proof of being signed out. Only a successful
    // response that carries no user is. Treating the two the same is what made
    // a refresh show "logged out" whenever the auth call hiccuped.
    if (!sessionRes || sessionRes.error) {
      return "unknown"
    }

    const sessionData = sessionRes.data
    if (!sessionData?.user) {
      setUser(null)
      writeCachedUser(null)
      return "unauthenticated"
    }

    const sessionUser = sessionData.user
    const token = sessionData.session?.token || sessionData.session?.id || sessionUser.id

    if (!userRef.current || userRef.current.id !== sessionUser.id) {
      setUser(mapSessionUser(sessionData, buildFallbackProfile(sessionUser)))
    } else {
      setUser((prev) =>
        prev
          ? { ...prev, token, access_token: token }
          : prev,
      )
    }

    let profileData = await fetchProfileViaApi(token)

    if (!profileData) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 6000)
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", sessionUser.id)
          .abortSignal(controller.signal)
          .maybeSingle()
        clearTimeout(timeout)

        if (profileError) {
          console.error("Error fetching profile:", profileError)
        }
        profileData = (profile as Record<string, any> | null) || null
      } catch (error) {
        console.error("Client profile read timed out:", error)
      }
    }

    if (!profileData) {
      profileData = buildFallbackProfile(sessionUser)
    }

    setUser(mapSessionUser(sessionData, profileData))
    return "authenticated"
  }

  useEffect(() => {
    let cancelled = false
    let done = false

    const finish = () => {
      if (cancelled || done) return
      done = true
      clearTimeout(safety)
      setLoading(false)
    }

    // Held aside rather than applied: the cache carries no credential, so
    // rendering from it up-front would fire authenticated requests with no
    // Authorization header. It is a fallback for when the check can't
    // complete, not a substitute for it.
    const cachedUser = readCachedUser()

    // Ceiling on the whole check. A cold server can take ~14s on the very first
    // get-session (auth-route compile + DB roundtrip), but we must never leave
    // the app in a permanent loading state.
    const safety = setTimeout(() => {
      if (cancelled) return
      // Stop loading no matter what. If the check still hasn't answered, hold
      // onto whatever identity we have rather than demoting a signed-in user
      // to a guest; only a visitor we have nothing for at all is treated as
      // signed out.
      const fallback = userRef.current ?? cachedUser
      if (fallback) {
        userRef.current = fallback
        setUser((prev) => prev ?? fallback)
      } else {
        setAuthResolved(true)
      }
      finish()
    }, 20000)

    const checkSession = async () => {
      // Retry transient failures (offline, timeout, 429, 5xx). A definitive
      // answer — signed in or signed out — stops the loop immediately.
      const retryDelays = [0, 1000, 2500]
      let result: SessionCheckResult = "unknown"

      for (const delay of retryDelays) {
        if (cancelled) return
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
        if (cancelled) return
        try {
          result = await hydrateSessionUser()
        } catch (error) {
          console.error("Error checking session:", error)
          result = "unknown"
        }
        if (result !== "unknown") break
      }

      if (cancelled) return

      if (result === "unknown") {
        // Never reached the auth API. A refresh must not downgrade a signed-in
        // user to a guest because of a network blip, so restore the cached
        // identity (if any) instead of clearing them.
        const fallback = userRef.current ?? cachedUser
        if (fallback) {
          userRef.current = fallback
          setUser((prev) => prev ?? fallback)
        } else {
          setUser(null)
        }
        // Deliberately left unresolved when we fall back to the cache:
        // auth-gated pages must not redirect to /login on a guess.
        if (!fallback) setAuthResolved(true)
      } else {
        setAuthResolved(true)
      }

      finish()
    }

    checkSession()

    return () => {
      cancelled = true
      clearTimeout(safety)
    }
  }, [])

  // Mirror the session to localStorage for the next hard refresh. Skipped while
  // the first check is still running so an empty initial state can't wipe it.
  useEffect(() => {
    if (loading) return
    writeCachedUser(user)
  }, [user, loading])

  const login = async (email: string, password: string) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || "Login failed")
    }

    if (data.user) {
      const token = data.session?.access_token || data.user.id
      setUser(
        mapSessionUser(
          { user: data.user, session: { id: token, token } },
          data.user
        )
      )
      setLoading(false)
    } else {
      await hydrateSessionUser()
      setLoading(false)
    }
  }

  const signup = async (
    email: string,
    password: string,
    username: string,
    display_name: string,
    invited_via_coloop?: boolean,
    invited_by_username?: string
  ) => {
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, username, display_name, invited_via_coloop, invited_by_username }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || "Signup failed")
    }

    if (data.user) {
      const token = data.session?.access_token || data.user.id
      setUser(
        mapSessionUser(
          { user: data.user, session: { id: token, token } },
          data.user
        )
      )
      setLoading(false)
    } else {
      await hydrateSessionUser()
      setLoading(false)
    }
  }

  const logout = async () => {
    await authClient.signOut().catch(() => undefined)
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined)
    // Drop the cached identity too, otherwise the next refresh would briefly
    // paint the signed-out user as signed in again.
    writeCachedUser(null)
    setUser(null)
    setAuthResolved(true)
  }

  const loginWithGoogle = async (callbackURL?: string) => {
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: callbackURL || `${window.location.origin}/legal/consent?returnTo=${encodeURIComponent("/onboarding")}`,
    })
    // Surface provider/config failures to the caller instead of silently
    // leaving the user on the login page.
    if (result?.error) {
      throw new Error(result.error.message || "Could not start Google sign-in")
    }
  }

  const refreshUser = async () => {
    const result = await hydrateSessionUser()
    if (result !== "unknown") setAuthResolved(true)
  }

  const getAuthHeader = useCallback((): Record<string, string> => {
    const token = userRef.current?.access_token || userRef.current?.token
    if (!token) {
      return {}
    }

    return {
      Authorization: `Bearer ${token}`,
    }
  }, [])

  const applyServerProfile = useCallback((profile: Partial<User> & Record<string, unknown>) => {
    setUser((prev) => {
      if (!prev) return prev
      const nextUsername = (profile.username as string) || prev.username
      const nextDisplay = (profile.display_name as string) || prev.display_name
      const nextAvatar = (profile.avatar_url as string | undefined) ?? prev.avatar_url
      const nextVideoAvatar = (profile.video_avatar_url as string | null | undefined) ?? prev.video_avatar_url ?? null
      const nextBanner = (profile.banner_url as string | undefined) ?? prev.banner_url
      const nextVideoCover = (profile.video_cover_url as string | null | undefined) ?? prev.video_cover_url ?? null
      const nextBio = (profile.bio as string | undefined) ?? prev.bio
      const nextProfileCustomCss =
        profile.profile_custom_css !== undefined
          ? (profile.profile_custom_css as string | null)
          : prev.profile_custom_css
      const nextTagged =
        profile.tagged_circles !== undefined
          ? (Array.isArray(profile.tagged_circles) ? profile.tagged_circles : [])
          : prev.tagged_circles
      const nextCoins =
        typeof profile.loop_coins === "number" ? profile.loop_coins : prev.loop_coins
      const nextPremium = Boolean(profile.is_premium ?? prev.is_premium)
      const nextVerified = Boolean(profile.is_verified ?? prev.is_verified)
      const nextAdmin = Boolean(profile.is_admin ?? prev.is_admin)
      const nextOrg = Boolean(profile.is_organization ?? prev.is_organization)
      const nextThemePrefs = (profile.theme_preferences as any) ?? prev.theme_preferences
      const nextLocation = (profile.location as string | undefined) ?? prev.location
      const nextWebsite = (profile.website as string | undefined) ?? prev.website
      const nextPronouns = (profile.pronouns as string | null | undefined) ?? prev.pronouns ?? null
      const nextOnboarding =
        typeof profile.onboarding_completed === "boolean"
          ? profile.onboarding_completed
          : prev.onboarding_completed
      const nextPrivacy =
        profile.privacy_settings !== undefined
          ? (profile.privacy_settings as Record<string, unknown> | undefined)
          : prev.privacy_settings
      const nextNotification =
        profile.notification_settings !== undefined
          ? (profile.notification_settings as Record<string, unknown> | undefined)
          : prev.notification_settings
      const nextPremiumExpiry =
        profile.premium_expires_at !== undefined
          ? (profile.premium_expires_at as string | undefined)
          : prev.premium_expires_at

      const unchanged =
        nextUsername === prev.username &&
        nextDisplay === prev.display_name &&
        nextAvatar === prev.avatar_url &&
        nextBanner === prev.banner_url &&
        nextBio === prev.bio &&
        nextProfileCustomCss === prev.profile_custom_css &&
        nextTagged === prev.tagged_circles &&
        nextCoins === prev.loop_coins &&
        nextPremium === prev.is_premium &&
        nextVerified === prev.is_verified &&
        nextAdmin === prev.is_admin &&
        nextLocation === prev.location &&
        nextWebsite === prev.website &&
        nextPronouns === prev.pronouns &&
        nextOnboarding === prev.onboarding_completed &&
        nextThemePrefs === prev.theme_preferences &&
        nextPrivacy === prev.privacy_settings &&
        nextNotification === prev.notification_settings &&
        nextPremiumExpiry === prev.premium_expires_at

      if (unchanged) return prev

      return {
        ...prev,
        username: nextUsername,
        display_name: nextDisplay,
        avatar_url: nextAvatar,
        video_avatar_url: nextVideoAvatar,
        banner_url: nextBanner,
        video_cover_url: nextVideoCover,
        bio: nextBio,
        profile_custom_css: nextProfileCustomCss,
        tagged_circles: nextTagged,
        loop_coins: nextCoins,
        is_premium: nextPremium,
        premium_expires_at: nextPremiumExpiry,
        is_verified: nextVerified,
        is_admin: nextAdmin,
        is_organization: nextOrg,
        organization_name: (profile.organization_name as string | undefined) ?? prev.organization_name,
        organization_badge_url: (profile.organization_badge_url as string | undefined) ?? prev.organization_badge_url,
        theme_preferences: nextThemePrefs,
        location: nextLocation,
        website: nextWebsite,
        pronouns: nextPronouns,
        privacy_settings: nextPrivacy,
        notification_settings: nextNotification,
        onboarding_completed: nextOnboarding,
        user_metadata: {
          username: nextUsername,
          display_name: nextDisplay,
          avatar_url: nextAvatar,
          is_premium: nextPremium,
          is_verified: nextVerified,
        },
      }
    })
  }, [])

  const updateProfile = async (updates: Partial<User>) => {
    if (!user) return

    try {
      const { error } = await supabase.from("profiles").update(updates).eq("id", user.id)

      if (error) throw error

      setUser({ ...user, ...updates })
    } catch (error) {
      console.error("Error updating profile:", error)
      throw error
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authResolved,
        login,
        loginWithGoogle,
        googleSignIn: loginWithGoogle,
        signup,
        logout,
        signOut: logout,
        refreshUser,
        getAuthHeader,
        updateProfile,
        updateUser: updateProfile,
        applyServerProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

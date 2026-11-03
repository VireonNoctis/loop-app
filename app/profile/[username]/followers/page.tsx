"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Search, Users } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { VideoAvatar } from "@/components/cosmetics/video-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Header } from "@/components/header"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { VerifiedSeal } from "@/components/ui/verified-seal"
import { isRustApiUnavailable, rustApiRequest } from "@/lib/rust-api"

type Person = {
  id: string
  username: string
  display_name?: string
  avatar_url?: string
  is_verified?: boolean
  is_following?: boolean
  has_pending_follow_request?: boolean
  is_self?: boolean
  bio?: string
}

export default function FollowersPage() {
  const params = useParams()
  const router = useRouter()
  const username = params.username as string
  const { user, getAuthHeader } = useAuth()
  const { toast } = useToast()
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [profileId, setProfileId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const profileRes = await fetch(`/api/users/profile?username=${encodeURIComponent(username)}`, {
          headers: { ...getAuthHeader() },
          cache: "no-store",
        })
        const profileData = await profileRes.json()
        if (!profileRes.ok) throw new Error(profileData.error || "Profile not found")
        if (cancelled) return
        setProfileId(profileData.profile.id)

        let listData: { followers?: Person[]; has_more?: boolean }
        try {
          listData = await rustApiRequest<{ followers: Person[]; has_more: boolean }>(
            `users/${encodeURIComponent(profileData.profile.id)}/followers?limit=50`,
            { headers: user ? getAuthHeader() : undefined, cache: "no-store" },
          )
        } catch (cause) {
          if (!isRustApiUnavailable(cause)) throw cause
          const response = await fetch(`/api/users/${profileData.profile.id}/followers?limit=50`, {
            headers: user ? { ...getAuthHeader() } : undefined,
            cache: "no-store",
          })
          const legacyData = await response.json()
          if (!response.ok) throw new Error(legacyData.error || "Failed to load followers")
          listData = legacyData
        }
        if (!cancelled) {
          setPeople((listData.followers || []).map((person) => ({
            ...person,
            is_following: Boolean(person.is_following),
            has_pending_follow_request: Boolean(person.has_pending_follow_request),
          })))
        }
      } catch (error: any) {
        if (!cancelled) {
          setPeople([])
          toast({ title: "Could not load followers", description: error.message, variant: "destructive" })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, user?.id])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter(
      (p) =>
        p.username?.toLowerCase().includes(q) ||
        p.display_name?.toLowerCase().includes(q),
    )
  }, [people, query])

  const toggleFollow = async (person: Person) => {
    if (!user || person.is_self) return
    const action = person.is_following || person.has_pending_follow_request ? "unfollow" : "follow"
    setPeople((prev) =>
      prev.map((p) => (
        p.id === person.id
          ? { ...p, is_following: action === "follow", has_pending_follow_request: false }
          : p
      )),
    )
    try {
      let result: {
        is_following?: boolean
        requires_approval?: boolean
        has_pending_follow_request?: boolean
      }
      try {
        result = await rustApiRequest(`users/${encodeURIComponent(person.id)}/follow`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ action }),
        })
      } catch (cause) {
        if (!isRustApiUnavailable(cause)) throw cause
        const response = await fetch("/api/users/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ target_user_id: person.id, action }),
        })
        result = await response.json()
        if (!response.ok) throw new Error("Follow failed")
      }

      const pending = Boolean(result.has_pending_follow_request || result.requires_approval)
      const following = Boolean(result.is_following ?? (action === "follow" && !pending))
      setPeople((prev) =>
        prev.map((p) => p.id === person.id
          ? { ...p, is_following: following, has_pending_follow_request: pending }
          : p
        ),
      )
    } catch {
      setPeople((prev) =>
        prev.map((p) => (
          p.id === person.id
            ? {
                ...p,
                is_following: Boolean(person.is_following),
                has_pending_follow_request: Boolean(person.has_pending_follow_request),
              }
            : p
        )),
      )
      toast({ title: "Could not update follow", variant: "destructive" })
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-xl border-x border-border/60 min-h-screen">
        <div className="sticky top-14 z-20 flex items-center gap-3 border-b border-border bg-background px-3 py-3">
          <Link href={`/profile/${username}`} className="rounded-full p-2 hover:bg-muted">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-bold">Followers</h1>
            <p className="text-xs text-muted-foreground">@{username}</p>
          </div>
        </div>

        <div className="border-b border-border/60 p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search followers"
              className="pl-9 rounded-full"
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-muted-foreground">
            <Users className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p>No followers yet</p>
          </div>
        ) : (
          <div>
            {filtered.map((person) => (
              <div key={person.id} className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
                <Link href={`/profile/${person.username}`}>
                  <Avatar className="h-11 w-11">
                    <AvatarImage src={person.avatar_url} />
                    <AvatarFallback>{(person.display_name || person.username || "?").charAt(0)}</AvatarFallback>
                  </Avatar>
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/profile/${person.username}`} className="flex items-center gap-1 font-semibold hover:underline">
                    <span className="truncate">{person.display_name || person.username}</span>
                    {person.is_verified && <VerifiedSeal size={18} title="Verified Creator" />}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">@{person.username}</p>
                </div>
                {!person.is_self && (
                  <Button
                    size="sm"
                    variant={person.is_following ? "outline" : "default"}
                    className="rounded-full"
                    onClick={() => {
                      if (!user) {
                        router.push("/login")
                        return
                      }
                      void toggleFollow(person)
                    }}
                  >
                    {person.is_following ? "Following" : person.has_pending_follow_request ? "Requested" : "Follow"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {profileId && <span className="sr-only">{profileId}</span>}
      </main>
    </div>
  )
}

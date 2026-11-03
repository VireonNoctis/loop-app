"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { VideoAvatar } from "@/components/cosmetics/video-avatar"
import { cn } from "@/lib/utils"
import { VerifiedSeal } from "@/components/ui/verified-seal"
import { Spinner } from "@/components/ui/skeletons"
import {
  Search,
  X,
  TrendingUp,
  Clock,
  ArrowRight,
  Hash,
  Users,
  FileText,
  GitBranch,
  Bookmark,
  
  Flame,
} from "lucide-react"

interface SearchSuggestion {
  id: string
  type: "user" | "hashtag" | "post" | "chain" | "collection" | "circle"
  title: string
  subtitle?: string
  avatar_url?: string
  is_verified?: boolean
}

interface RecentSearch {
  query: string
  timestamp: number
}

const RECENT_KEY = "loop-recent-searches"
const MAX_RECENT = 5

interface ExploreSearchAutocompleteProps {
  onSearch: (query: string) => void
  className?: string
}

export function ExploreSearchAutocomplete({ onSearch, className }: ExploreSearchAutocompleteProps) {
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [trending, setTrending] = useState<SearchSuggestion[]>([])
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load recent searches
  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_KEY)
      if (stored) setRecentSearches(JSON.parse(stored))
    } catch { /* intentionally silent */ }
  }, [])

  // Fetch trending on mount
  useEffect(() => {
    fetchTrending()
  }, [])

  const fetchTrending = async () => {
    try {
      const res = await fetch("/api/search?q=&type=trending&limit=5")
      if (res.ok) {
        const data = await res.json()
        const items = (data.results || data.hashtags || data.trending || []).slice(0, 5).map((t: any) => ({
          id: t.tag || t.id || String(t),
          type: "hashtag" as const,
          title: t.tag || t.name || String(t),
          subtitle: t.count ? `${t.count} posts` : undefined,
        }))
        setTrending(items)
      }
    } catch {
      // Silent fail
    }
  }

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) {
      setSuggestions([])
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=5`)
      if (res.ok) {
        const data = await res.json()
        const items: SearchSuggestion[] = []

        // Users
        for (const u of (data.users || []).slice(0, 3)) {
          items.push({
            id: u.id,
            type: "user",
            title: u.display_name || u.username,
            subtitle: `@${u.username}`,
            avatar_url: u.avatar_url,
            is_verified: u.is_verified,
          })
        }

        // Hashtags
        for (const h of (data.hashtags || []).slice(0, 3)) {
          items.push({
            id: h.tag || h.name,
            type: "hashtag",
            title: h.tag || h.name,
            subtitle: h.count ? `${h.count} posts` : undefined,
          })
        }

        // Posts
        for (const p of (data.loops || data.posts || []).slice(0, 2)) {
          items.push({
            id: p.id,
            type: "post",
            title: p.content_text?.slice(0, 60) || p.content_title || "Post",
            subtitle: p.author?.username ? `@${p.author.username}` : undefined,
          })
        }


        // Collaborative objects share the same visibility-aware search API.
        for (const chain of (data.chains || []).slice(0, 2)) {
          items.push({
            id: `chain:${chain.id}`,
            type: "chain",
            title: chain.title,
            subtitle: "Chain · " + (chain.kind || "collaborative idea"),
          })
        }
        for (const collection of (data.collections || []).slice(0, 2)) {
          items.push({
            id: `collection:${collection.id}`,
            type: "collection",
            title: collection.title,
            subtitle: collection.is_collaborative ? "Collaborative collection" : "Collection",
          })
        }
        for (const circle of (data.circles || []).slice(0, 2)) {
          items.push({
            id: `circle:${circle.id}`,
            type: "circle",
            title: circle.name,
            subtitle: "Circle · " + (circle.member_count || 0) + " members",
          })
        }

        setSuggestions(items)
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => fetchSuggestions(query), 300)
    return () => clearTimeout(timer)
  }, [query, fetchSuggestions])

  const saveRecent = (q: string) => {
    const updated = [
      { query: q, timestamp: Date.now() },
      ...recentSearches.filter((r) => r.query !== q),
    ].slice(0, MAX_RECENT)
    setRecentSearches(updated)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated))
    } catch { /* intentionally silent */ }
  }

  const handleSubmit = (q: string) => {
    if (!q.trim()) return
    saveRecent(q.trim())
    onSearch(q.trim())
    setFocused(false)
    inputRef.current?.blur()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = query.trim() ? suggestions : [...recentSearches.map((r) => ({ id: r.query, type: "user" as const, title: r.query })), ...trending]

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, -1))
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault()
      const item = items[selectedIndex]
      if (item) {
        setQuery(item.title)
        handleSubmit(item.title)
      }
    } else if (e.key === "Escape") {
      setFocused(false)
      inputRef.current?.blur()
    }
  }

  const showDropdown = focused && (query.trim() ? suggestions.length > 0 || loading : true)

  return (
    <div className={cn("relative", className)}>
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="Search people, ideas, Chains, Collections..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelectedIndex(-1)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          onKeyDown={handleKeyDown}
          className="pl-9 pr-9"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("")
              setSuggestions([])
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden max-h-[400px] overflow-y-auto"
        >
          {query.trim() ? (
            // Search Results
            <>
              {loading && (
                <div className="flex items-center justify-center py-4">
                  <Spinner className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              {!loading && suggestions.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <Search className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No results for &quot;{query}&quot;</p>
                </div>
              )}
              {!loading && suggestions.length > 0 && (
                <div className="py-1">
                  {suggestions.map((item, idx) => (
                    <button
                      key={item.id}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setQuery(item.title)
                        handleSubmit(item.title)
                      }}
                      className={cn(
                        "flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors",
                        idx === selectedIndex ? "bg-muted/50" : "hover:bg-muted/30"
                      )}
                    >
                      {item.type === "user" && item.avatar_url ? (
                        <VideoAvatar src={item.avatar_url} className="h-8 w-8" fallback={item.title.charAt(0)} />
                      ) : item.type === "hashtag" ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                          <Hash className="h-4 w-4 text-primary" />
                        </div>
                      ) : item.type === "chain" ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                          <GitBranch className="h-4 w-4 text-primary" />
                        </div>
                      ) : item.type === "collection" ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                          <Bookmark className="h-4 w-4 text-primary" />
                        </div>
                      ) : item.type === "circle" ? (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                          <Users className="h-4 w-4 text-primary" />
                        </div>
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate flex items-center gap-1">
                          {item.title}
                          {item.is_verified && (
                            <VerifiedSeal size={14} title="Verified Creator" />
                          )}
                        </p>
                        {item.subtitle && (
                          <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {item.type}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            // Recent + Trending
            <div className="py-1">
              {/* Recent Searches */}
              {recentSearches.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-3 pt-2 pb-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Recent
                    </span>
                    <button
                      onClick={() => {
                        setRecentSearches([])
                        try { localStorage.removeItem(RECENT_KEY) } catch { /* intentionally silent */ }
                      }}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>
                  {recentSearches.map((item, idx) => (
                    <button
                      key={item.query}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setQuery(item.query)
                        handleSubmit(item.query)
                      }}
                      className={cn(
                        "flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-muted/30 transition-colors",
                        idx === selectedIndex && "bg-muted/50"
                      )}
                    >
                      <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate flex-1">{item.query}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}

              {/* Trending */}
              {trending.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
                    <Flame className="h-3 w-3 text-orange-500" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Trending
                    </span>
                  </div>
                  {trending.map((item, idx) => (
                    <button
                      key={item.id}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setQuery(item.title)
                        handleSubmit(item.title)
                      }}
                      className={cn(
                        "flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-muted/30 transition-colors",
                        idx + recentSearches.length === selectedIndex && "bg-muted/50"
                      )}
                    >
                      <TrendingUp className="h-4 w-4 text-orange-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm truncate block">#{item.title}</span>
                        {item.subtitle && (
                          <span className="text-[10px] text-muted-foreground">{item.subtitle}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

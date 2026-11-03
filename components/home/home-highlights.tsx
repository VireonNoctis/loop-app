"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ChevronDown,
  Compass,
  Flame,
  Bookmark,
  Users,
  Plus,
  Search,
  GitBranch,
  Video,
  Zap,
  Star,
  X,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"
import {
  DEFAULT_HIGHLIGHTS_STATE,
  areHighlightsCardsVisible,
  isHighlightsRowVisible,
  readHighlightsState,
  writeHighlightsState,
  type HighlightsState,
} from "@/lib/home-highlights"
import { WelcomeBanner } from "@/components/welcome-banner"
import { ReturnRecap } from "@/components/return-recap"
import { CircleActivityStrip } from "@/components/circle-activity-strip"
import { DailyPulse } from "@/components/engagement/daily-pulse"

/**
 * Home feed chrome budget.
 *
 * The feed used to open with a Welcome-back card, a weekly-bonus card, a recap
 * card, a circles strip and a row of quick-action chips stacked above the feed
 * tabs — five promotional blocks before the first post. They are all still
 * here, but collapsed behind one slim toolbar row: the quick actions stay
 * visible (they replace the old chip row), and the four cards only render when
 * the user asks for them. Dismissing the bar is remembered, so a returning user
 * gets top bar → feed tabs → first post with nothing in between.
 */

const QUICK_LINKS = [
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/drops", label: "Drops", icon: Flame },
  { href: "/communities", label: "Circles", icon: Users },
  { href: "/explore?tab=chains", label: "Chains", icon: GitBranch },
  { href: "/trees", label: "Reels", icon: Video },
  { href: "/co-loop", label: "Co-Loop", icon: Zap },
  { href: "/search", label: "Search", icon: Search },
  { href: "/bookmarks", label: "Saved", icon: Bookmark },
] as const

export function HomeHighlights() {
  const { user } = useAuth()
  // Rendered after mount so localStorage can't cause a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  const [state, setState] = useState<HighlightsState>(DEFAULT_HIGHLIGHTS_STATE)

  useEffect(() => {
    setState(readHighlightsState())
    setMounted(true)
  }, [])

  const update = (patch: Partial<HighlightsState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch }
      writeHighlightsState(next)
      return next
    })
  }

  if (!user || !mounted) return null

  return (
    <div className="space-y-2.5">
      {/* The one row of pre-feed chrome. */}
      <div className="flex items-center gap-1.5">
        <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          <Link
            href="/create"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            <Plus className="h-3.5 w-3.5" />
            New loop
          </Link>
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon
            return (
              <Link
                key={link.href}
                href={link.href}
                title={link.label}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{link.label}</span>
              </Link>
            )
          })}
        </div>

        {isHighlightsRowVisible(state) && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => update({ expanded: !state.expanded })}
              aria-expanded={state.expanded}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <Star className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Highlights</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  state.expanded && "rotate-180",
                )}
              />
            </button>
            <button
              type="button"
              onClick={() => update({ expanded: false, dismissed: true })}
              aria-label="Hide home highlights"
              title="Hide this row"
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Everything that used to live in the stack above the feed. */}
      {areHighlightsCardsVisible(state) && (
        <div className="space-y-2.5">
          <DailyPulse />
          <WelcomeBanner />
          <ReturnRecap />
          <CircleActivityStrip />
        </div>
      )}
    </div>
  )
}

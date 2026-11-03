"use client"

import { useState, useEffect, useId } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AppLogo } from "@/components/brand/app-logo"
import { useAuth } from "@/hooks/use-auth"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { AvatarWithFrame } from "@/components/ui/avatar-with-frame"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChevronDown, Flame, LogOut } from "lucide-react"
import { AnimatedIconView } from "@/components/icons/animated/animated-icon-view"
import type { AnimatedIconComponent } from "@/components/icons/animated/animated-icon-view"
import HomeIcon from "@/components/icons/animated/home-icon"
import MagnifierIcon from "@/components/icons/animated/magnifier-icon"
import PenIcon from "@/components/icons/animated/pen-icon"
import UsersIcon from "@/components/icons/animated/users-icon"
import MessageCircleIcon from "@/components/icons/animated/message-circle-icon"
import RadioIcon from "@/components/icons/animated/radio-icon"
import WalletIcon from "@/components/icons/animated/wallet-icon"
import CodeIcon from "@/components/icons/animated/code-icon"
import ChartLineIcon from "@/components/icons/animated/chart-line-icon"
import ClockIcon from "@/components/icons/animated/clock-icon"
import BookmarkIcon from "@/components/icons/animated/bookmark-icon"
import UserPlusIcon from "@/components/icons/animated/user-plus-icon"
import LockIcon from "@/components/icons/animated/lock-icon"
import UsersGroupIcon from "@/components/icons/animated/users-group-icon"
import ShieldCheckIcon from "@/components/icons/animated/shield-check"
import FlameIcon from "@/components/icons/animated/flame-icon"
import { UserBadges } from "@/components/user-badge"
import {
  primarySidebarNav,
  readSidebarMoreExpanded,
  secondarySidebarNav,
  writeSidebarMoreExpanded,
  type SidebarAudience,
} from "@/lib/sidebar-nav"

interface CircleItem {
  id: string
  name: string
  description?: string
  member_count?: number
  avatar_url?: string
}

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

/** Icons live here rather than in the nav model so `lib/sidebar-nav` stays free
 *  of React and the "no destination lost" rules can be unit tested. */
const NAV_ICONS: Record<string, AnimatedIconComponent> = {
  "/": HomeIcon,
  "/explore": MagnifierIcon,
  "/create": PenIcon,
  "/communities": UsersIcon,
  "/messages": MessageCircleIcon,
  "/streams": RadioIcon,
  "/wallet": WalletIcon,
  "/co-loop/studio": CodeIcon,
  "/earnings": ChartLineIcon,
  "/developers": CodeIcon,
  "/events": ClockIcon,
  "/drops": FlameIcon,
  "/bookmarks": BookmarkIcon,
  "/collections": BookmarkIcon,
  "/invite": UserPlusIcon,
  "/lounge": LockIcon,
  "/organization": UsersGroupIcon,
  "/loopadmin": ShieldCheckIcon,
  "/team": UsersIcon,
}

/** Guides the new-user tour to real elements. */
const NAV_TOUR_ANCHORS: Record<string, string> = {
  "/communities": "nav-circles",
  "/wallet": "wallet",
}

function navItemClasses(href: string, active: boolean) {
  if (active) {
    return href === "/loopadmin"
      ? "bg-amber-500 text-white shadow-sm"
      : href === "/team"
        ? "bg-blue-500 text-white shadow-sm"
        : "bg-primary text-primary-foreground shadow-sm"
  }
  if (href === "/loopadmin") return "text-amber-500 hover:bg-amber-500/10"
  if (href === "/team") return "text-blue-500 hover:bg-blue-500/10"
  return "text-muted-foreground hover:bg-muted hover:text-foreground"
}

export function SidebarContent({ onLinkClick }: { onLinkClick?: () => void }) {
  const { user, signOut } = useAuth()
  const pathname = usePathname()
  const [trendingCircles, setTrendingCircles] = useState<CircleItem[]>([])

  // This component renders twice on small screens (desktop rail + the mobile
  // sheet), so the disclosure needs an id that is unique per instance.
  const morePanelId = useId()

  // Persisted so someone who opens More keeps it open across visits.
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => {
    setMoreOpen(readSidebarMoreExpanded())
  }, [])

  const toggleMore = () => {
    setMoreOpen((prev) => {
      writeSidebarMoreExpanded(!prev)
      return !prev
    })
  }

  useEffect(() => {
    if (!user) return

    fetch("/api/circles?limit=5")
      .then((res) => res.json())
      .then((data) => {
        if (data.circles || data.data) {
          setTrendingCircles(data.circles || data.data || [])
        }
      })
      .catch(() => {})


  }, [user])

  if (!user) return null

  const isAdmin = Boolean(user.staff_role || user.is_admin || user.is_moderator)

  const audience: SidebarAudience = {
    isPremium: Boolean(user.is_premium),
    isOrganization: Boolean(user.is_organization),
    isAdmin,
    isTeamMember: Boolean(user.is_team_member),
  }

  // Five always-visible destinations; everything else lives behind "More" so
  // the rail reads as a hierarchy instead of a flat list of a dozen links.
  const primaryNav = primarySidebarNav(audience)
  const secondaryNav = secondarySidebarNav(audience)

  return (
    <div className="flex h-full flex-col justify-between overflow-hidden">
      <div className="flex flex-col flex-1 min-h-0">
        {/* Brand Logo Header */}
        <div className="flex items-center gap-2 px-3 py-2 shrink-0">
          <Link href="/" onClick={onLinkClick} className="flex items-center gap-2.5 group">
            <AppLogo showWordmark className="rounded-xl shadow-md transition-transform group-hover:scale-105" />
          </Link>
        </div>

        <ScrollArea className="flex-1 my-2 pr-2 scrollbar-thin">
          {/* Main Discovery Navigation Links */}
          <div className="space-y-1">
            <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Discover & Tools
            </p>
            {primaryNav.map((item) => {
              const Icon = NAV_ICONS[item.href]
              // Prefix match: sub-routes like /communities/123 and /loopadmin/quests
              // should keep their parent highlighted.
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(`${item.href}/`))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onLinkClick}
                  data-tour={NAV_TOUR_ANCHORS[item.href]}
                  className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all ${navItemClasses(item.href, isActive)}`}
                >
                  <div className="flex items-center gap-3">
                    {Icon ? <AnimatedIconView component={Icon} size={16} className="h-4 w-4" /> : null}
                    <span>{item.label}</span>
                  </div>
                  {item.badge ? (
                    <Badge className="bg-rose-500 text-[9px] px-1.5 py-0 text-white font-bold animate-pulse">
                      {item.badge}
                    </Badge>
                  ) : null}
                </Link>
              )
            })}

            {/* Everything else stays reachable from the same rail, just not
                competing with the primary destinations for attention. */}
            {secondaryNav.length > 0 && (
              <button
                type="button"
                onClick={toggleMore}
                aria-expanded={moreOpen}
                aria-controls={morePanelId}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all ${
                  secondaryNav.some(
                    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
                  )
                    ? "text-foreground hover:bg-muted"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <div className="flex items-center gap-3">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform duration-200 ${moreOpen ? "rotate-180" : ""}`}
                  />
                  <span>More</span>
                </div>
                {!moreOpen && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[9px] font-bold text-muted-foreground">
                    {secondaryNav.length}
                  </span>
                )}
              </button>
            )}

            {secondaryNav.length > 0 && moreOpen && (
              <div id={morePanelId} className="space-y-1 pl-3">
                {secondaryNav.map((item) => {
                  const Icon = NAV_ICONS[item.href]
                  const isActive =
                    pathname === item.href || pathname.startsWith(`${item.href}/`)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onLinkClick}
                      className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-semibold transition-all ${navItemClasses(item.href, isActive)}`}
                    >
                      <div className="flex items-center gap-3">
                        {Icon ? <AnimatedIconView component={Icon} size={16} className="h-4 w-4" /> : null}
                        <span>{item.label}</span>
                      </div>
                      {item.badge ? (
                        item.tone ? (
                          <Badge
                            variant="outline"
                            className={`text-[9px] ${item.tone === "admin" ? "border-amber-500/50" : "border-blue-500/50"}`}
                          >
                            {item.badge}
                          </Badge>
                        ) : (
                          <Badge className="bg-rose-500 text-[9px] px-1.5 py-0 text-white font-bold">
                            {item.badge}
                          </Badge>
                        )
                      ) : null}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Trending Circles Section */}
          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between px-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Flame className="h-3.5 w-3.5 text-amber-500" />
                Trending Circles
              </p>
            </div>

            <div className="space-y-1">
              {trendingCircles.length === 0 ? (
                <p className="px-3 text-xs text-muted-foreground italic">No circles found</p>
              ) : (
                trendingCircles.slice(0, 4).map((c) => (
                  <Link
                    key={c.id}
                    href={`/communities/${c.id}`}
                    onClick={onLinkClick}
                    className="flex items-center justify-between rounded-xl px-3 py-2 text-xs transition-all hover:bg-muted"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={c.avatar_url} />
                        <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                          {c.name?.charAt(0) || "C"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-foreground truncate">{c.name}</span>
                    </div>
                    {c.member_count !== undefined && (
                      <span className="text-[10px] text-muted-foreground">{c.member_count}m</span>
                    )}
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Quick User Balance Card */}
          <div className="mt-6 rounded-2xl border border-border/60 bg-muted/40 p-3.5 text-xs space-y-2 mb-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-muted-foreground">Loop Coins</span>
              <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 text-xs font-bold">
                🪙 {Number(user.loop_coins || 0).toLocaleString()}
              </Badge>
            </div>
            <Button asChild variant="outline" size="sm" className="w-full text-xs rounded-xl h-7" onClick={onLinkClick}>
              <Link href="/wallet">Top Up & Send Gifts</Link>
            </Button>
          </div>
        </ScrollArea>
      </div>

      {/* Footer User Profile & Logout */}
      <div className="border-t border-border/60 pt-3 shrink-0 flex items-center justify-between">
        <Link href={`/profile/${user.username || user.id}`} onClick={onLinkClick} className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-80 transition-opacity">
          <AvatarWithFrame
            avatarUrl={user.avatar_url || user.user_metadata?.avatar_url}
            videoAvatarUrl={(user as any).video_avatar_url || null}
            frameId={user.equipped_frame_id}
            size={36}
            alt={user.display_name || user.username}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="text-xs font-bold truncate">{user.display_name || user.username}</p>
              <UserBadges
                is_verified={user.is_verified}
                is_team_member={user.is_team_member}
                is_sponsor={user.is_sponsor}
                is_organization={user.is_organization}
                organization_badge_url={user.organization_badge_url}
                organization_name={user.organization_name}
                email={user.email}
                username={user.username}
                size="sm"
              />
            </div>
            <p className="text-[10px] text-muted-foreground truncate">@{user.username}</p>
          </div>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onLinkClick?.()
            void signOut()
          }}
          className="h-8 w-8 rounded-xl text-muted-foreground hover:text-destructive"
          title="Sign Out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export function LeftSidebar() {
  const { user } = useAuth()
  const pathname = usePathname()
  if ([ "/legal/consent", "/terms", "/privacy" ].some((route) => pathname === route || pathname.startsWith(`${route}/`))) return null
  if (!user) return null

  return (
    <aside className="sticky top-0 hidden h-screen w-64 flex-col border-r border-border/60 bg-card/50 p-4 lg:flex">
      <SidebarContent />
    </aside>
  )
}

export function MobileSidebarSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[300px] p-4 bg-card border-r border-border/60">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation Menu</SheetTitle>
        </SheetHeader>
        <SidebarContent onLinkClick={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}

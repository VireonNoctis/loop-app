"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  Activity,
  Award,
  BadgeCheck,
  Ban,
  Banknote,
  BarChart3,
  Building2,
  Calendar,
  CircleDot,
  Clock,
  Coins,
  Crown,
  Flag,
  Frame,
  Gauge,
  GitBranch,
  Images,
  LifeBuoy,
  Megaphone,
  Menu,
  MessageSquare,
  Palette,
  Paintbrush,
  RefreshCw,
  ScrollText,
  Search,
  Shield,
  Smile,
  Star,
  Target,
  TrendingUp,
  Users,
  UsersRound,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabase"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { AdminCatalogPanel } from "@/components/admin/admin-catalog-panel"
import { AdminBroadcastPanel } from "@/components/admin/admin-broadcast-panel"
import { AdminSupportPanel } from "@/components/admin/admin-support-panel"
import { AdminGifsPanel } from "@/components/admin/admin-gifs-panel"
import { AdminEmojisPanel } from "@/components/admin/admin-emojis-panel"
import { AdminFeaturedPanel } from "@/components/admin/admin-featured-panel"
import { ContentModerationControl } from "@/components/admin/content-moderation-control"
import { EconomyControl } from "@/components/admin/economy-control"
import { RateLimitControl } from "@/components/admin/rate-limit-control"
import { WithdrawalsControl } from "@/components/admin/withdrawals-control"
import { RefundsControl } from "@/components/admin/refunds-control"
import { SettingsTabContent } from "@/components/admin/settings-tab-content"
import { EventManagement } from "@/components/admin/event-management"
import { MaintenanceModeControl } from "@/components/admin/maintenance-mode-control"
import { ShopControl } from "@/components/admin/shop-control"
import { ProLoungeSettings } from "@/components/admin/pro-lounge-settings"
import { LogoControl } from "@/components/admin/logo-control"
import { CacheManagementPanel } from "@/components/admin/cache-management-panel"
import { OrgManagementPanel } from "@/components/admin/org-management-panel"
import { AdsAdminPanel } from "@/components/admin/ads-admin-panel"
import { AwardsAdminPanel } from "@/components/admin/awards-admin-panel"
import { ProCirclePanel } from "@/components/admin/pro-circle-panel"
import { VerificationBadgesAdminPanel } from "@/components/admin/verification-badges-admin-panel"
import { AdminQuestsPanel } from "@/components/admin/admin-quests-panel"
import { SystemHealthPanel } from "@/components/admin/system-health-panel"
import { BanAppealsPanel } from "@/components/admin/ban-appeals-panel"
import { AdminAccountManagement } from "@/components/admin/admin-account-management"
import { AdminAccessControl } from "@/components/admin/admin-access-control"
import { resolveStaffRole } from "@/lib/staff-roles"
import { CoLoopSessionsPanel } from "@/components/admin/co-loop-sessions-panel"
import { AdminAnalyticsTab } from "@/components/admin/admin-analytics-tab"
import { Spinner } from "@/components/ui/skeletons"
import { ThemePresetManager } from "@/components/admin/theme-preset-manager"
import { AdminFramesTab } from "@/components/admin/admin-frames-tab"
import { AdminRevenueTab } from "@/components/admin/admin-revenue-tab"
import { AuditLogPanel } from "@/components/admin/audit-log-panel"
import { VerificationRequestsPanel } from "@/components/admin/verification-requests-panel"
import { AdminMonetizationPanel } from "@/components/admin/admin-monetization-panel"
import { AdminCommandPalette } from "@/components/admin/admin-command-palette"
import { AdminPostsPanel } from "@/components/admin/admin-posts-panel"
import { AdminUsersTable, type AdminUser } from "@/components/admin/admin-users-table"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/* Sidebar navigation — grouped, professional dashboard style          */
/* ------------------------------------------------------------------ */

const NAV_GROUPS: {
  label: string
  items: { value: string; label: string; icon: React.ElementType }[]
}[] = [
  {
    label: "Overview",
    items: [
      { value: "analytics", label: "Analytics", icon: BarChart3 },
      { value: "health", label: "Health", icon: Activity },
      { value: "audit", label: "Audit Log", icon: ScrollText },
      { value: "verification", label: "Verification", icon: BadgeCheck },
    ],
  },
  {
    label: "People",
    items: [
      { value: "users", label: "Users", icon: Users },
      { value: "moderation", label: "Moderation", icon: Flag },
      { value: "appeals", label: "Ban Appeals", icon: Ban },
      { value: "team", label: "Access & Roles", icon: UsersRound },
      { value: "organizations", label: "Orgs", icon: Building2 },
      { value: "support", label: "Support", icon: LifeBuoy },
    ],
  },
  {
    label: "Economy",
    items: [
      { value: "revenue", label: "Revenue", icon: Wallet },
      { value: "economy", label: "Economy", icon: Coins },
      { value: "monetization", label: "Monetization", icon: Crown },
      { value: "payouts", label: "Payouts", icon: Banknote },
      { value: "rate-limits", label: "Rate limits", icon: Gauge },
    ],
  },
  {
    label: "Content",
    items: [
      { value: "posts", label: "Posts", icon: MessageSquare },
      { value: "featured", label: "Featured", icon: Star },
      { value: "events", label: "Events", icon: Calendar },
      { value: "quests", label: "Quests", icon: Target },
      { value: "coloops", label: "Co-Loops", icon: GitBranch },
      { value: "broadcast", label: "Broadcast", icon: Megaphone },
      { value: "ads", label: "Ads", icon: Images },
    ],
  },
  {
    label: "Customization",
    items: [
      { value: "catalog", label: "Themes", icon: Palette },
      { value: "circle-themes", label: "Circle Themes", icon: Paintbrush },
      { value: "pfp-frames", label: "PFP Frames", icon: Frame },
      { value: "gifs", label: "GIFs", icon: Images },
      { value: "emojis", label: "Emojis", icon: Smile },
      { value: "awards", label: "Awards", icon: Award },
      { value: "checkmarks", label: "Checkmarks", icon: BadgeCheck },
      { value: "procircle", label: "Pro Circle", icon: CircleDot },
    ],
  },
  {
    label: "System",
    items: [{ value: "maintenance", label: "Maintenance", icon: Wrench }],
  },
]

const ALL_SECTIONS = NAV_GROUPS.flatMap((g) => g.items)

/* Short, consistent description per section — rendered under the top-bar title. */
const SECTION_DESCRIPTIONS: Record<string, string> = {
  analytics: "Platform-wide engagement and growth metrics.",
  health: "Live system status: API, database, and background jobs.",
  audit: "Every admin action, with actor, reason, and timestamp.",
  verification: "Review user verification requests — approve or reject with a reason.",
  users: "Manage accounts, roles, balances, and verification.",
  moderation: "Review reported content and take action.",
  appeals: "User-submitted ban appeals awaiting review.",
  team: "Staff roles, user permissions, and privileged access history.",
  organizations: "Organization accounts and verification.",
  support: "User support tickets and conversations.",
  revenue: "Revenue, transactions, and payment history.",
  economy: "Coin economy constants and platform settings.",
  monetization: "Coin packs, Pro subscriptions, and pricing.",
  payouts: "Withdrawal requests and refund processing.",
  "rate-limits": "API and action rate-limit configuration.",
  posts: "Find any post and remove it from the platform.",
  featured: "Curate featured loops, creators, and circles.",
  events: "Platform events and scheduling.",
  quests: "Build, publish, and analyze quest campaigns.",
  coloops: "Co-Loop session management and analytics.",
  broadcast: "Send announcements to all users.",
  ads: "Ad placements and campaign management.",
  catalog: "Shop themes and cosmetic catalog.",
  "circle-themes": "Community-specific theme presets.",
  "pfp-frames": "Profile frame catalog and availability.",
  gifs: "Curated GIF library management.",
  emojis: "Custom emoji and sticker packs.",
  awards: "Award definitions and granting.",
  checkmarks: "Custom verification badge creator and assignments.",
  procircle: "Pro Circle member benefits and management.",
  maintenance: "Shop status, maintenance mode, branding, and cache.",
}

/* ------------------------------------------------------------------ */

function SidebarNav({
  section,
  onNavigate,
  onNavigateMobile,
  groups = NAV_GROUPS,
}: {
  section: string
  onNavigate: (v: string) => void
  onNavigateMobile?: (v: string) => void
  groups?: typeof NAV_GROUPS
}) {
  return (
    <nav className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon
              const active = section === item.value
              return (
                <button
                  key={item.value}
                  onClick={() => {
                    onNavigate(item.value)
                    onNavigateMobile?.(item.value)
                  }}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                    active
                      ? "bg-primary/10 text-primary shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground",
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

/* ------------------------------------------------------------------ */

export function AdminDashboard() {
  const searchParams = useSearchParams()
  const requestedTab = searchParams?.get("tab") || "users"
  const { user, getAuthHeader } = useAuth()
  const staffRole = resolveStaffRole(user)
  const isStaff = Boolean(staffRole)
  const isFullAdmin = staffRole === "developer" || staffRole === "admin"
  const visibleGroups = useMemo(
    () => staffRole === "moderator"
      ? NAV_GROUPS.map((group) => ({
          ...group,
          items: group.items.filter((item) => item.value === "moderation" || item.value === "support" || item.value === "appeals" || item.value === "team"),
        })).filter((group) => group.items.length > 0)
      : NAV_GROUPS,
    [staffRole],
  )
  const allowedSections = useMemo(
    () => visibleGroups.flatMap((group) => group.items.map((item) => item.value)),
    [visibleGroups],
  )
  const { toast } = useToast()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [stats, setStats] = useState({ total_users: 0, verified: 0, premium: 0, banned: 0, new_this_week: 0 })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("all")
  const [live, setLive] = useState(false)
  const [section, setSection] = useState(requestedTab)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const loadUsers = useCallback(async () => {
    if (!isFullAdmin) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ filter, limit: "60" })
      if (q.trim()) params.set("q", q.trim())
      const response = await fetch(`/api/admin/users/manage?${params}`, {
        headers: getAuthHeader(),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to load users")
      setUsers(data.users || [])
      setStats(data.stats || { total_users: 0, verified: 0, premium: 0, banned: 0 })
    } catch (error: any) {
      toast({ title: "Admin load failed", description: error.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [isFullAdmin, filter, q, getAuthHeader, toast])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  useEffect(() => {
    if (!isFullAdmin) return
    const channel = supabase.channel("admin:users", {
      config: { broadcast: { self: false } },
    })
    channel
      .on("broadcast", { event: "user_updated" }, ({ payload }) => {
        if (!payload?.user) return
        setUsers((prev) => {
          const exists = prev.some((u) => u.id === payload.user.id)
          if (!exists) return [payload.user, ...prev]
          return prev.map((u) => (u.id === payload.user.id ? { ...u, ...payload.user } : u))
        })
        setLive(true)
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLive(true)
      })
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [isFullAdmin])

  const runAction = async (userId: string, action: string, extra: Record<string, unknown> = {}) => {
    setBusyId(`${userId}:${action}`)
    try {
      const response = await fetch("/api/admin/users/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ user_id: userId, action, ...extra }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Action failed")
      if (data.user) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...data.user } : u)))
      }
      toast({ title: "Updated", description: `${action.replace(/_/g, " ")} applied.` })
      await loadUsers()
    } catch (error: any) {
      toast({ title: "Action failed", description: error.message, variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  const navigate = useCallback((v: string) => {
    if (!allowedSections.includes(v)) return
    setSection(v)
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      url.searchParams.set("tab", v)
      window.history.replaceState(null, "", url.toString())
    }
  }, [allowedSections])

  const visibleSection = allowedSections.includes(section) ? section : allowedSections[0] || "moderation"

  useEffect(() => {
    if (!allowedSections.includes(section)) setSection(allowedSections[0] || "moderation")
  }, [allowedSections, section])

  const currentLabel = useMemo(
    () => ALL_SECTIONS.find((s) => s.value === visibleSection)?.label || "Dashboard",
    [visibleSection],
  )
  const currentDescription = SECTION_DESCRIPTIONS[visibleSection]
  const currentIcon = useMemo(
    () => ALL_SECTIONS.find((s) => s.value === visibleSection)?.icon || BarChart3,
    [visibleSection],
  )

  if (!isStaff) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          App admin access required.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex gap-6">
      {/* Desktop sidebar */}
      <aside className="sticky top-6 hidden h-[calc(100vh-3rem)] w-60 shrink-0 overflow-y-auto rounded-2xl border bg-card/60 p-4 lg:block">
        <SidebarNav section={visibleSection} onNavigate={navigate} groups={visibleGroups} />
      </aside>

      {/* Main column */}
      <div className="min-w-0 flex-1 space-y-5">
        {/* Top bar: drawer toggle + section title + live + palette */}
        <div className="flex items-center gap-2">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-full lg:hidden" aria-label="Open admin menu">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 overflow-y-auto p-4">
              <SheetHeader className="p-0 pb-3 text-left">
                <SheetTitle className="text-base">Admin sections</SheetTitle>
              </SheetHeader>
              <SidebarNav
                section={visibleSection}
                onNavigate={navigate}
                onNavigateMobile={() => setDrawerOpen(false)}
                groups={visibleGroups}
              />
            </SheetContent>
          </Sheet>

          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 truncate text-xl font-bold tracking-tight sm:text-2xl">
              {(() => {
                const Icon = currentIcon
                return <Icon className="h-5 w-5 text-primary" />
              })()}
              {currentLabel}
            </h2>
            {currentDescription && (
              <p className="hidden truncate text-xs text-muted-foreground sm:block">{currentDescription}</p>
            )}
          </div>

          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-full border bg-muted/50 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted sm:flex"
          >
            <Search className="h-4 w-4" />
            <span>Quick actions…</span>
            <kbd className="ml-1 inline-flex h-5 items-center rounded border bg-background px-1.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full sm:hidden"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </Button>

          <Badge variant={live ? "default" : "outline"} className="hidden rounded-full md:inline-flex">
            {live ? "Live" : "Connecting…"}
          </Badge>
          <Button variant="outline" size="icon" className="hidden rounded-full sm:inline-flex" onClick={loadUsers} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <Tabs value={visibleSection} onValueChange={navigate}>
          {/* Users gets the fully redesigned table experience */}
          <TabsContent value="users" className="mt-0 space-y-5">
            <AdminUsersTable
              currentUserId={user?.id}
              users={users}
              stats={stats}
              loading={loading}
              busyId={busyId}
              filter={filter}
              onFilterChange={setFilter}
              q={q}
              onQueryChange={setQ}
              onSearch={loadUsers}
              onAction={runAction}
              onRefresh={loadUsers}
            />

            <Card className="border-dashed">
              <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                Changes sync live across open admin sessions. Recipients also get an in-app notification.
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="posts" className="mt-0">
            <AdminPostsPanel />
          </TabsContent>

          {/* Every other section — unchanged functionality, consistent spacing */}
          <TabsContent value="revenue" className="mt-0">
            <AdminRevenueTab />
          </TabsContent>

          <TabsContent value="audit" className="mt-0">
            <AuditLogPanel />
          </TabsContent>

          <TabsContent value="verification" className="mt-0">
            <VerificationRequestsPanel />
          </TabsContent>

          <TabsContent value="analytics" className="mt-0">
            <AdminAnalyticsTab />
          </TabsContent>

          <TabsContent value="maintenance" className="mt-0 space-y-6">
            <ShopControl />
            <MaintenanceModeControl />
            <LogoControl />
            <CacheManagementPanel />
            <ProLoungeSettings />
            <AdminAccountManagement />
          </TabsContent>

          <TabsContent value="organizations" className="mt-0">
            <OrgManagementPanel />
          </TabsContent>

          <TabsContent value="events" className="mt-0">
            <EventManagement />
          </TabsContent>

          <TabsContent value="economy" className="mt-0 space-y-6">
            <EconomyControl />
            <SettingsTabContent />
          </TabsContent>

          <TabsContent value="monetization" className="mt-0">
            <AdminMonetizationPanel />
          </TabsContent>

          <TabsContent value="rate-limits" className="mt-0">
            <RateLimitControl />
          </TabsContent>

          <TabsContent value="payouts" className="mt-0 space-y-6">
            <WithdrawalsControl />
            <RefundsControl />
          </TabsContent>

          <TabsContent value="catalog" className="mt-0">
            <AdminCatalogPanel />
          </TabsContent>

          <TabsContent value="featured" className="mt-0">
            <AdminFeaturedPanel />
          </TabsContent>

          <TabsContent value="moderation" className="mt-0">
            <ContentModerationControl />
          </TabsContent>

          <TabsContent value="support" className="mt-0">
            <AdminSupportPanel />
          </TabsContent>

          <TabsContent value="gifs" className="mt-0">
            <AdminGifsPanel />
          </TabsContent>
          <TabsContent value="emojis" className="mt-0">
            <AdminEmojisPanel />
          </TabsContent>

          <TabsContent value="broadcast" className="mt-0">
            <AdminBroadcastPanel />
          </TabsContent>

          <TabsContent value="ads" className="mt-0">
            <AdsAdminPanel />
          </TabsContent>
          <TabsContent value="awards" className="mt-0">
            <AwardsAdminPanel />
          </TabsContent>
          <TabsContent value="procircle" className="mt-0">
            <ProCirclePanel />
          </TabsContent>
          <TabsContent value="checkmarks" className="mt-0">
            <VerificationBadgesAdminPanel />
          </TabsContent>
          <TabsContent value="quests" className="mt-0">
            <AdminQuestsPanel />
          </TabsContent>
          <TabsContent value="health" className="mt-0">
            <SystemHealthPanel />
          </TabsContent>
          <TabsContent value="appeals" className="mt-0">
            <BanAppealsPanel />
          </TabsContent>
          <TabsContent value="coloops" className="mt-0">
            <CoLoopSessionsPanel />
          </TabsContent>
          <TabsContent value="team" className="mt-0">
            <AdminAccessControl />
          </TabsContent>
          <TabsContent value="circle-themes" className="mt-0">
            <ThemePresetManager />
          </TabsContent>
          <TabsContent value="pfp-frames" className="mt-0">
            <AdminFramesTab />
          </TabsContent>
        </Tabs>
      </div>

      <AdminCommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onNavigate={navigate}
      />
    </div>
  )
}

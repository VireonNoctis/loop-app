"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AppLogo } from "@/components/brand/app-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AvatarWithFrame } from "@/components/ui/avatar-with-frame"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Search,
  Settings,
  User,
  LogOut,
  Coins,
  X,
  Sun,
  Moon,
  Circle,
  Flower2,
  TreePine,
  Palette,
} from "lucide-react"
import { useTheme } from "next-themes"
import { AnimatedIconView } from "@/components/icons/animated/animated-icon-view"
import MagnifierIcon from "@/components/icons/animated/magnifier-icon"
import { useAuth } from "@/hooks/use-auth"
import { NotificationDropdown } from "@/components/notifications/notification-dropdown"
import { ThemeToggle } from "@/components/theme-toggle"
import { UserBadges } from "@/components/user-badge"
import { AccountSwitcher } from "@/components/accounts/account-switcher"

function LogoMark() {
  return (
    <AppLogo className="rounded-2xl shadow-lg shadow-primary/20 transition-transform duration-300 group-hover:scale-105" />
  )
}

/**
 * Bar density: the header carries only the brand, search, the coins balance and
 * notifications. Everything used less often (theme, chat) lives in the profile
 * menu below instead of occupying permanent space in the bar.
 */
const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "midnight", label: "Midnight", icon: Circle },
  { value: "sakura", label: "Sakura", icon: Flower2 },
  { value: "forest", label: "Forest", icon: TreePine },
] as const

export function Header() {
  const [searchQuery, setSearchQuery] = useState("")
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const { user, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const router = useRouter()

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    if (q) router.push(`/search/${encodeURIComponent(q)}`)
    else router.push("/search")
  }

  const handleLogout = async () => {
    try {
      await signOut()
      // Client-side navigation: a full reload here threw away every cached
      // client state for no reason and made signing out feel like a crash.
      router.push("/landing")
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  if (!user) {
    return (
      <header className="sticky top-0 z-50 w-full border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-14 items-center justify-between px-3 sm:px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <LogoMark />
            <div className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-tight text-foreground">loopapp.me</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Social OS</span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login">
              <Button variant="ghost" size="sm">Log In</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm" className="rounded-full bg-gradient-to-r from-violet-600 to-cyan-500 px-4 font-semibold text-white shadow-md">
                Sign Up
              </Button>
            </Link>
          </div>
        </div>
      </header>
    )
  }

  const isAdmin = Boolean(user.staff_role || user.is_admin || user.is_moderator)

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="container mx-auto flex h-14 items-center justify-between gap-2 px-3 sm:px-4">
        {/* Brand & Expandable Search Input */}
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            <LogoMark />
            <div className="hidden flex-col leading-tight sm:flex">
              <span className="text-base font-bold tracking-tight text-foreground">loopapp.me</span>
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Social OS</span>
            </div>
          </Link>

          {/* Desktop & Mobile Responsive Search */}
          {mobileSearchOpen ? (
            <form onSubmit={handleSearch} className="flex items-center gap-1 w-full max-w-xs animate-in fade-in duration-150">
              <div className="relative flex-1">
                <AnimatedIconView component={MagnifierIcon} size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  autoFocus
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 rounded-full border-border bg-muted/40 pl-8 pr-3 text-xs"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => setMobileSearchOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSearch} className="hidden md:flex relative w-48 lg:w-72 transition-all">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 rounded-full border-border bg-muted/40 pl-8 pr-3 text-xs placeholder:text-muted-foreground focus-visible:ring-sky-500"
              />
            </form>
          )}
        </div>

        {/* Consolidated Actions Bar */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Mobile search trigger */}
          {!mobileSearchOpen && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full md:hidden"
              onClick={() => setMobileSearchOpen(true)}
              title="Search"
            >
              <AnimatedIconView component={MagnifierIcon} size={17} />
            </Button>
          )}

          {/* Loop Coins — the balance users check constantly, kept in the bar. */}
          <Link
            href="/wallet"
            data-tour="wallet"
            className="hidden items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary sm:inline-flex"
            title="Loop Coins wallet"
          >
            <Coins className="h-3.5 w-3.5 text-amber-500" />
            {Number(user.loop_coins || 0).toLocaleString()}
          </Link>

          {/* Notifications */}
          {/* On phones the bell lives in the tab bar, with its unread count. */}
          <span data-tour="notifications" className="hidden lg:inline-flex">
            <NotificationDropdown />
          </span>

          {/* Consolidated User Profile Avatar Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-tour="nav-profile"
                className="relative h-8 w-8 rounded-full border border-border/80 bg-muted/50 p-0 hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-sky-500/50"
              >
                <AvatarWithFrame
                  avatarUrl={user.avatar_url}
                  videoAvatarUrl={(user as any).video_avatar_url || null}
                  frameId={user.equipped_frame_id}
                  size={32}
                  alt={user.display_name}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 p-1.5 rounded-2xl">
              <DropdownMenuLabel className="font-normal p-2">
                <div className="flex flex-col space-y-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold leading-none truncate">{user.display_name || user.username}</p>
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
                  <p className="text-[11px] text-muted-foreground leading-none">@{user.username}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              <DropdownMenuItem asChild className="rounded-xl cursor-pointer">
                <Link href={`/profile/${user.username || user.id}`} className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium">Your Profile</span>
                </Link>
              </DropdownMenuItem>

              {/* Messages are reached from the bottom nav / inbox, not the top
                  bar — the bar stays brand, search, coins and notifications. */}
              <DropdownMenuItem asChild className="rounded-xl cursor-pointer">
                <Link href="/wallet" className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-amber-500" />
                  <span className="text-xs font-medium">Wallet</span>
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                    {Number(user.loop_coins || 0).toLocaleString()}
                  </span>
                </Link>
              </DropdownMenuItem>

              {/* Theme submenu replaces the bar's theme button. */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="rounded-xl">
                  <Palette className="h-4 w-4 text-muted-foreground" />
                  <span className="ml-2 text-xs font-medium">Theme</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-40 rounded-xl p-1">
                  <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                    {THEME_OPTIONS.map((option) => {
                      const Icon = option.icon
                      return (
                        <DropdownMenuRadioItem
                          key={option.value}
                          value={option.value}
                          className="gap-2 rounded-xl text-xs font-medium"
                        >
                          <Icon className="h-4 w-4" />
                          {option.label}
                        </DropdownMenuRadioItem>
                      )
                    })}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuItem asChild className="rounded-xl cursor-pointer">
                <Link href="/settings" className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium">Settings</span>
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {/* Account Switcher */}
              <div className="px-1">
                <AccountSwitcher variant="dropdown" />
              </div>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={handleLogout}
                className="rounded-xl text-rose-500 hover:text-rose-600 focus:text-rose-600 cursor-pointer"
              >
                <LogOut className="h-4 w-4 mr-2" />
                <span className="text-xs font-semibold">Log Out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

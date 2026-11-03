"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Bell, Check, Settings, Heart, MessageCircle, UserPlus, GitBranch, AtSign, Gift, Mail, BellRing, ChevronRight, Lock, Coins, Megaphone, Radio, Phone, Trophy, Users, Crown, Info, Swords, ShieldCheck, Zap, Quote } from "lucide-react"
import { NotificationQuickReply } from "@/components/notifications/notification-quick-reply";
import { AnimatedIconView } from "@/components/icons/animated/animated-icon-view";
import FilledBellIcon from "@/components/icons/animated/filled-bell-icon";
import { getNotificationCopy, SYSTEM_SENDER } from "@/lib/notification-copy";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { FreshnessTimestamp } from "@/components/ui/freshness-timestamp";
import { CoLoopInviteCard } from "@/components/invitations/co-loop-invite-card";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/components/ui/skeletons"
import { VerifiedSeal } from "@/components/ui/verified-seal"
import { isRustApiUnavailable, rustApiRequest } from "@/lib/rust-api"

interface Actor {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  is_verified: boolean
}

interface Notification {
  id: string
  type: string
  title: string
  message: string
  data?: any
  is_read: boolean
  created_at: string
  updated_at?: string
  action_url?: string | null
  actor_name?: string | null
  actor?: Actor | null
  actors?: Actor[]
  count?: number
  actor_ids?: string[]
}

// ── Notification type → icon + color ──────────────────────────────
const TYPE_CONFIG: Record<string, { icon: typeof Heart; color: string; bg: string; label: string }> = {
  like: { icon: Heart, color: "text-rose-500", bg: "bg-rose-500/10", label: "Like" },
  comment: { icon: MessageCircle, color: "text-blue-500", bg: "bg-blue-500/10", label: "Comment" },
  reply: { icon: MessageCircle, color: "text-blue-400", bg: "bg-blue-400/10", label: "Reply" },
  follow: { icon: UserPlus, color: "text-violet-500", bg: "bg-violet-500/10", label: "Follow" },
  branch: { icon: GitBranch, color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Branch" },
  quote: { icon: Quote, color: "text-teal-500", bg: "bg-teal-500/10", label: "Quote" },
  mention: { icon: AtSign, color: "text-amber-500", bg: "bg-amber-500/10", label: "Mention" },
  gift: { icon: Gift, color: "text-pink-500", bg: "bg-pink-500/10", label: "Gift" },
  message: { icon: Mail, color: "text-cyan-500", bg: "bg-cyan-500/10", label: "Message" },
  chat_message: { icon: Mail, color: "text-cyan-500", bg: "bg-cyan-500/10", label: "Message" },
  follow_request: { icon: UserPlus, color: "text-violet-500", bg: "bg-violet-500/10", label: "Follow request" },
  boost: { icon: Zap, color: "text-fuchsia-500", bg: "bg-fuchsia-500/10", label: "Boost" },
  circle_join: { icon: Users, color: "text-sky-500", bg: "bg-sky-500/10", label: "Circle" },
  circle_join_request: { icon: Users, color: "text-sky-500", bg: "bg-sky-500/10", label: "Circle request" },
  circle_join_approved: { icon: Users, color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Circle" },
  circle_post_like: { icon: Heart, color: "text-rose-500", bg: "bg-rose-500/10", label: "Like" },
  circle_post_comment: { icon: MessageCircle, color: "text-blue-500", bg: "bg-blue-500/10", label: "Comment" },
  system: { icon: BellRing, color: "text-sky-500", bg: "bg-sky-500/10", label: "System" },
  announcement: { icon: Megaphone, color: "text-primary", bg: "bg-primary/10", label: "Announcement" },
  broadcast: { icon: Megaphone, color: "text-primary", bg: "bg-primary/10", label: "Announcement" },
  award: { icon: Trophy, color: "text-amber-500", bg: "bg-amber-500/10", label: "Award" },
  coin_reward: { icon: Coins, color: "text-amber-500", bg: "bg-amber-500/10", label: "Coins" },
  pro_grant: { icon: Crown, color: "text-primary", bg: "bg-primary/10", label: "Pro" },
  live_stream_started: { icon: Radio, color: "text-red-500", bg: "bg-red-500/10", label: "Live" },
  creator_live: { icon: Radio, color: "text-red-500", bg: "bg-red-500/10", label: "Live" },
  call_incoming: { icon: Phone, color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Call" },
  co_loop_invite: { icon: GitBranch, color: "text-cyan-400", bg: "bg-cyan-400/10", label: "Co-Loop" },
  co_loop_open_join: { icon: GitBranch, color: "text-cyan-400", bg: "bg-cyan-400/10", label: "Co-Loop" },
  clutch_duel_result: { icon: Swords, color: "text-orange-500", bg: "bg-orange-500/10", label: "Duel" },
  admin_action: { icon: ShieldCheck, color: "text-muted-foreground", bg: "bg-muted", label: "Loop" },
}

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] || { icon: Bell, color: "text-muted-foreground", bg: "bg-muted", label: "Notification" }
}

// ── Time grouping helper ──────────────────────────────────────────
function groupByTime(notifications: Notification[]): { label: string; items: Notification[] }[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)

  const groups: { label: string; items: Notification[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "This week", items: [] },
    { label: "Earlier", items: [] },
  ]

  for (const n of notifications) {
    const d = new Date(n.created_at)
    if (d >= today) groups[0].items.push(n)
    else if (d >= yesterday) groups[1].items.push(n)
    else if (d >= weekAgo) groups[2].items.push(n)
    else groups[3].items.push(n)
  }

  return groups.filter((g) => g.items.length > 0)
}

export function NotificationDropdown() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const { user, getAuthHeader } = useAuth()
  const { toast } = useToast()

  const fetchNotifications = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user) return
    if (!opts?.silent) setLoading(true)
    try {
      let data: {
        success?: boolean
        notifications?: Notification[]
        unread_count?: number
      }
      try {
        data = await rustApiRequest<{ success?: boolean; notifications?: Notification[]; unread_count?: number }>("notifications?limit=20", {
          headers: getAuthHeader(),
          cache: "no-store",
        })
      } catch (error) {
        if (!isRustApiUnavailable(error)) throw error
        // Compatibility while the Rust service is rolled out to production.
        const response = await fetch("/api/notifications?limit=20", {
          headers: { ...getAuthHeader() },
          cache: "no-store",
        })
        if (!response.ok) throw new Error("Could not fetch notifications")
        data = await response.json()
      }
      if (data.success) {
        const nextNotifications = data.notifications || []
        setNotifications(nextNotifications)
        setUnreadCount(
          typeof data.unread_count === "number"
            ? data.unread_count
            : nextNotifications.filter((notification) => !notification.is_read).length,
        )
      }
    } catch (error) {
      console.error("Error fetching notifications:", error)
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [user?.id, getAuthHeader])

  useEffect(() => {
    if (user && isOpen) void fetchNotifications()
  }, [user?.id, isOpen, fetchNotifications])

  // Live badge + list: postgres changes + light poll
  useEffect(() => {
    if (!user?.id) return

    void fetchNotifications({ silent: true })

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as Notification
          setNotifications((prev) => [row, ...prev.filter((n) => n.id !== row.id)].slice(0, 30))
          setUnreadCount((c) => c + 1)
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => {
          void fetchNotifications({ silent: true })
        },
      )
      .on("broadcast", { event: "notification" }, () => {
        void fetchNotifications({ silent: true })
      })
      .subscribe()

    const poll = setInterval(() => {
      void fetchNotifications({ silent: true })
    }, 45000)

    return () => {
      clearInterval(poll)
      void supabase.removeChannel(channel)
    }
  }, [user?.id, fetchNotifications])

  const markAsRead = async (notificationId: string) => {
    if (!user) return
    try {
      try {
        await rustApiRequest("notifications/read", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ notification_ids: [notificationId] }),
        })
      } catch (error) {
        if (!isRustApiUnavailable(error)) throw error
        const response = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ notification_ids: [notificationId] }),
        })
        if (!response.ok) throw new Error("Could not mark notification as read")
      }
      setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
      // Tell the tab-bar badge so it drops without waiting for its poll.
      window.dispatchEvent(new CustomEvent("loop:notifications-changed"))
    } catch (error) {
      console.error("Error marking notification as read:", error)
    }
  }

  const markAllAsRead = async () => {
    if (!user) return
    try {
      try {
        await rustApiRequest("notifications/read", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ mark_all_read: true }),
        })
      } catch (error) {
        if (!isRustApiUnavailable(error)) throw error
        const response = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ mark_all_read: true }),
        })
        if (!response.ok) throw new Error("Could not mark notifications as read")
      }
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnreadCount(0)
      window.dispatchEvent(new CustomEvent("loop:notifications-changed"))
      toast({ title: "Success", description: "All notifications marked as read" })
    } catch (error) {
      console.error("Error marking all notifications as read:", error)
    }
  }

  const notificationHref = (n: Notification) => {
    const data = n.data || {}
    if (data.href) return data.href
    if (data.action_url) return data.action_url
    if (data.url) return data.url
    if (n.action_url) return n.action_url
    if (data.conversation_id) return `/messages?c=${data.conversation_id}`
    if (data.loop_id) return `/loop/${data.loop_id}`
    if (data.circle_id) return `/communities/${data.circle_id}`
    if (data.reel_id) return `/trees?id=${data.reel_id}`
    if (data.username) return `/profile/${data.username}`
    if (data.actor_username) return `/profile/${data.actor_username}`
    if (n.type === "mention") return "/notifications?type=mention"
    return "/notifications"
  }

  const groups = useMemo(() => groupByTime(notifications), [notifications])

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex items-center justify-center h-9 w-9 rounded-full hover:bg-muted/60 transition-colors"
        >
          <AnimatedIconView component={FilledBellIcon} size={18} className="text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground ring-2 ring-background">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[360px] max-w-[calc(100vw-1.5rem)] p-0 overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
        align="end"
        sideOffset={8}
        forceMount
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="h-5 border-0 bg-muted px-1.5 text-[10px] font-bold text-foreground">
                {unreadCount}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Check className="h-3 w-3" />
                Mark all read
              </button>
            )}
            <Link href="/settings">
              <button
                type="button"
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </Link>
          </div>
        </div>

        {/* Notification list */}
        <ScrollArea className="h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner className="h-5 w-5 text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <div className="h-10 w-10 rounded-full bg-muted/60 flex items-center justify-center mb-3">
                <Bell className="h-5 w-5 opacity-40" />
              </div>
              <p className="text-sm font-medium">No notifications yet</p>
              <p className="text-[11px] mt-1 text-muted-foreground/70">When someone interacts with you, it will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {groups.map((group) => (
                <div key={group.label}>
                  {/* Time group header */}
                  <div className="px-4 py-1.5 bg-muted/20 sticky top-0 z-10">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{group.label}</p>
                  </div>

                  {group.items.map((notification) => {
                    const href = notificationHref(notification)
                    const config = getTypeConfig(notification.type)
                    const Icon = config.icon
                    const actor = notification.actor

                    // Co-Loop invite special card
                    const isCoLoopInvite =
                      notification.type === "co_loop" ||
                      notification.type === "co_loop_invite" ||
                      notification.title.toLowerCase().includes("co-loop")

                    if (isCoLoopInvite) {
                      const inviteSessionId = notification.data?.session_id || notification.data?.sessionId || "demo-session-1"
                      const inviterDisplayName =
                        notification.data?.inviter_name ||
                        notification.data?.inviter_username ||
                        (notification as any).actor_name ||
                        actor?.display_name ||
                        actor?.username ||
                        notification.message?.split(" invited")[0] ||
                        "A member"
                      return (
                        <div key={notification.id} className="px-3 py-2">
                          <CoLoopInviteCard
                            inviteId={notification.data?.invitation_id}
                            sessionId={inviteSessionId}
                            inviterName={inviterDisplayName}
                            createdAt={notification.created_at}
                            expiresAt={notification.data?.invitation_expires_at}
                          />
                        </div>
                      )
                    }

                    // Grouped notification
                    const groupedActors = (notification as any).actors || []
                    const groupCount = (notification as any).count || 1
                    const isGrouped = groupCount > 1 && groupedActors.length > 1
                    const isUnread = !notification.is_read

                    const actorName = isGrouped
                      ? groupedActors[0]?.display_name || groupedActors[0]?.username || ""
                      : actor?.display_name || actor?.username || (notification as any).actor_name || ""

                    // Every type renders its own copy — platform notifications
                    // (announcements, coin rewards, admin actions) never fall
                    // back to "interacted with your post".
                    const copy = getNotificationCopy({
                      type: notification.type,
                      title: notification.title,
                      message: notification.message,
                      actorName,
                      groupCount,
                      otherActorsLabel:
                        groupedActors[1]?.display_name || groupedActors[1]?.username || "someone",
                    })

                    return (
                      <button
                        key={notification.id}
                        type="button"
                        className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors hover:bg-muted/40 ${
                          isUnread ? "bg-muted/40" : ""
                        }`}
                        onClick={() => {
                          if (isUnread) void markAsRead(notification.id)
                          // Internal targets route client-side; only genuinely
                          // external ones need a document navigation.
                          if (href) {
                            if (href.startsWith("/")) router.push(href)
                            else window.location.assign(href)
                          }
                        }}
                      >
                        {/* Actor avatar(s) */}
                        <div className="relative shrink-0 mt-0.5">
                          {isGrouped ? (
                            <div className="relative h-9 w-9">
                              {groupedActors.slice(0, 3).map((a: any, i: number) => (
                                <Avatar
                                  key={a.id || i}
                                  className="absolute h-7 w-7 border-2 border-background"
                                  style={{ top: i * 3, left: i * 3, zIndex: 3 - i }}
                                >
                                  <AvatarImage src={a.avatar_url || undefined} alt={a.display_name || a.username} />
                                  <AvatarFallback className="text-[9px]">
                                    {(a.display_name || a.username || "?").charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                              ))}
                            </div>
                          ) : (
                            <Avatar className="h-9 w-9">
                              <AvatarImage
                                src={actor?.avatar_url || undefined}
                                alt={actor?.display_name || actor?.username || "user"}
                              />
                              <AvatarFallback className="text-[10px] font-semibold">
                                {actor?.display_name?.charAt(0) || actor?.username?.charAt(0) || "?"}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          {/* Type icon badge */}
                          <div className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full ${config.bg} flex items-center justify-center border border-background`}>
                            <Icon className={`h-2 w-2 ${config.color}`} />
                          </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          {copy.system ? (
                            <p className="text-[13px] font-semibold leading-snug text-foreground">
                              {copy.action}
                            </p>
                          ) : (
                            <p className="text-[13px] leading-snug text-foreground">
                              <span className="font-semibold">{copy.sender}</span>
                              {!isGrouped && actor?.is_verified && (
                                <VerifiedSeal size={14} className="ml-0.5" title="Verified Creator" />
                              )}
                              <span className="text-muted-foreground"> {copy.action}</span>
                            </p>
                          )}
                          {notification.message && notification.message !== notification.title && !isGrouped && !copy.system && (
                            <p className="text-[11px] text-muted-foreground/80 mt-0.5 line-clamp-1">{notification.message}</p>
                          )}
                          <div className="flex items-center gap-1.5 mt-1">
                            <FreshnessTimestamp date={notification.updated_at || notification.created_at} showIcon />
                            {copy.system && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground">
                                <Info className="h-2.5 w-2.5" />
                                {SYSTEM_SENDER}
                              </span>
                            )}
                            {isUnread && (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                          {/* Quick reply for DMs and comments */}
                          {!isGrouped && (notification.type === "message" || notification.type === "comment" || notification.type === "reply") && (
                            <NotificationQuickReply notification={notification} compact />
                          )}
                        </div>

                        {/* Arrow */}
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 mt-2" />
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border/40 px-2 py-1.5">
          <Link href="/notifications" className="block" onClick={() => setIsOpen(false)}>
            <button
              type="button"
              className="w-full rounded-lg py-1.5 text-center text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              See all notifications
            </button>
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

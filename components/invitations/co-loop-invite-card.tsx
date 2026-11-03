"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Zap, Check, X, Users } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { getSupabaseBrowserClient } from "@/lib/supabase-browser"
import { FreshnessTimestamp } from "@/components/ui/freshness-timestamp"
import { Spinner } from "@/components/ui/skeletons"

interface CoLoopInviteCardProps {
  inviteId?: string
  sessionId: string
  inviterName?: string
  inviterAvatar?: string
  createdAt?: string | Date
  expiresAt?: string | Date
  initialStatus?: "pending" | "accepted" | "declined" | "expired"
  onStatusChange?: (newStatus: "accepted" | "declined" | "expired") => void
  isSender?: boolean
}

const supabase = getSupabaseBrowserClient()

export function CoLoopInviteCard({
  inviteId,
  sessionId,
  inviterName = "Creator",
  inviterAvatar,
  createdAt = new Date(),
  expiresAt,
  initialStatus = "pending",
  onStatusChange,
  isSender = false,
}: CoLoopInviteCardProps) {
  const [status, setStatus] = useState<"pending" | "accepted" | "declined" | "expired">(initialStatus)
  const [loadingAction, setLoadingAction] = useState<"accept" | "decline" | null>(null)
  const { user, getAuthHeader } = useAuth()
  const { toast } = useToast()

  // Real-time channel for invitation status changes
  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`co-loop-invite:${sessionId}`)
      .on("broadcast", { event: "invite_status" }, (payload: { payload?: { sessionId?: string; status?: "pending" | "accepted" | "declined" | "expired" } }) => {
        if (payload.payload?.sessionId === sessionId && payload.payload?.status) {
          setStatus(payload.payload.status)
        }
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [sessionId])

  const handleResponse = async (action: "accepted" | "declined") => {
    setLoadingAction(action === "accepted" ? "accept" : "decline")
    try {
      // The server verifies the signed-in invitee and broadcasts the
      // persisted response. Never let the browser broadcast an unverified status.
      const res = await fetch("/api/co-loop/invitation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          sessionId,
          inviteId,
          status: action,
        }),
      })
      const result = await res.json().catch(() => ({}))
      if (res.status === 410 || result.expired === true) {
        setStatus("expired")
        onStatusChange?.("expired")
        toast({
          title: "Invitation expired",
          description: result.error || "Ask the host to send a new invitation.",
        })
        return
      }
      if (!res.ok) throw new Error(result.error || "Could not update this invitation")

      setStatus(action)
      if (onStatusChange) onStatusChange(action)

      if (action === "accepted") {
        try {
          const rewardRes = await fetch("/api/co-loop/activate-reward", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeader(),
            },
            body: JSON.stringify({
              session_id: sessionId,
              inviter_username: inviterName,
            }),
          })
          const rewardData = await rewardRes.json()
          if (rewardData.success) {
            toast({
              title: "🎉 Collaboration Bonus Unlocked!",
              description: "You and your co-author both earned +50 Loop Coins!",
            })
          }
        } catch (rErr) {
          console.warn("Reward activation call:", rErr)
        }

        toast({
          title: "Co-Loop Invitation Accepted! 🎉",
          description: "Joining real-time co-authoring studio...",
        })
      } else {
        toast({
          title: "Invitation Declined",
          description: "You declined the Co-Loop invitation.",
        })
      }
    } catch (error) {
      console.error("Failed to respond to Co-Loop invite:", error)
      toast({
        title: "Couldn't update the invite",
        description: "Your response wasn't saved — try again.",
        variant: "destructive",
      })
    } finally {
      setLoadingAction(null)
    }
  }

  return (
    <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-br from-cyan-950/70 via-slate-900 to-purple-950/70 p-4 shadow-xl shadow-cyan-500/10 text-white min-w-[270px] space-y-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-500 text-black font-extrabold shadow-md">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-extrabold uppercase tracking-wider text-cyan-300">Co-Loop Studio Invite</span>
              <Badge variant="outline" className="border-cyan-500/30 text-[10px] text-cyan-300 px-1.5 py-0">
                <Users className="h-2.5 w-2.5 mr-1" /> Live
              </Badge>
            </div>
            <p className="text-[11px] text-slate-300/80">Real-time collaborative authoring</p>
          </div>
        </div>

        <FreshnessTimestamp date={createdAt} showIcon className="text-[10px]" />
      </div>

      <p className="text-xs text-slate-200 leading-relaxed">
        {isSender
          ? `You invited ${inviterName} to co-author a loop live.`
          : `${inviterName} invited you to co-author a loop in real time!`}
      </p>
      {status === "pending" && expiresAt && (
        <p className="text-[11px] text-cyan-200/80">
          Expires {new Date(expiresAt).toLocaleString()}
        </p>
      )}

      {/* Interactive Actions / Status Badge */}
      {status === "pending" ? (
        <div className="space-y-2">
          {isSender ? (
            <div className="rounded-xl border border-dashed border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-center text-xs text-cyan-300 flex items-center justify-center gap-2">
              <Spinner className="h-3.5 w-3.5" /> Waiting for response...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={Boolean(loadingAction)}
                onClick={() => handleResponse("accepted")}
                className="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 font-bold text-white hover:from-cyan-400 hover:to-indigo-500 shadow-lg shadow-cyan-500/25 transition-all text-xs"
              >
                {loadingAction === "accept" ? (
                  <Spinner className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                )}
                Accept
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={Boolean(loadingAction)}
                onClick={() => handleResponse("declined")}
                className="rounded-xl border-rose-500/40 text-rose-300 hover:bg-rose-500/20 hover:text-rose-200 text-xs px-3"
              >
                {loadingAction === "decline" ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <X className="h-3.5 w-3.5 mr-1" />
                )}
                Decline
              </Button>
            </div>
          )}
        </div>
      ) : status === "accepted" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-emerald-500/15 border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 font-semibold">
            <span className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-400" /> Invitation Accepted
            </span>
          </div>
          <Button asChild size="sm" className="w-full rounded-xl bg-cyan-500 font-bold text-slate-950 hover:bg-cyan-400 text-xs">
            <Link href={`/co-loop/studio?session=${encodeURIComponent(sessionId)}&invited=true${inviterName ? `&invitedBy=${encodeURIComponent(inviterName)}` : ""}`}>
              Enter Co-Loop Studio →
            </Link>
          </Button>
        </div>
      ) : status === "expired" ? (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <span className="flex items-center gap-1.5 font-medium">
            <X className="h-3.5 w-3.5" /> Invitation Expired
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl bg-rose-500/15 border border-rose-500/30 px-3 py-2 text-xs text-rose-300">
          <span className="flex items-center gap-1.5 font-medium">
            <X className="h-3.5 w-3.5 text-rose-400" /> Invitation Declined
          </span>
        </div>
      )}
    </div>
  )
}

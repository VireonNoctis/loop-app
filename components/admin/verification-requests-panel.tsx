"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import {
  BadgeCheck,
  Check,
  ExternalLink,
  Eye,
  Link2,
  RefreshCw,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface VerifRequest {
  id: string
  user_id: string
  real_name: string | null
  username: string | null
  social_links: string | null
  reason: string | null
  verification_type: string | null
  documents_url: string | null
  status: "pending" | "approved" | "rejected" | "cancelled"
  admin_notes: string | null
  rejection_reason: string | null
  created_at: string
  reviewed_at: string | null
  user?: {
    id: string
    username: string | null
    display_name: string | null
    avatar_url: string | null
    is_verified: boolean | null
  } | null
}

interface VerificationAppeal {
  id: string
  request_id: string
  user_id: string
  reason: string
  evidence_url: string | null
  status: "pending" | "accepted" | "rejected"
  rejection_reason: string | null
  reviewer_notes: string | null
  created_at: string
  reviewed_at: string | null
  user?: { username: string | null; display_name: string | null; avatar_url: string | null } | null
  request?: { reason: string | null; verification_type: string | null; status: string } | null
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  approved: { label: "Approved", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  rejected: { label: "Rejected", cls: "bg-red-500/10 text-red-600 border-red-500/30" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground border-border" },
}

function timeAgo(dateStr: string) {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

export function VerificationRequestsPanel() {
  const { getAuthHeader } = useAuth()
  const { toast } = useToast()
  const [requests, setRequests] = useState<VerifRequest[]>([])
  const [appeals, setAppeals] = useState<VerificationAppeal[]>([])
  const [appealsError, setAppealsError] = useState<string | null>(null)
  const [appealView, setAppealView] = useState<"pending" | "history">("pending")
  const [appealRejectTarget, setAppealRejectTarget] = useState<VerificationAppeal | null>(null)
  const [appealRejectionReason, setAppealRejectionReason] = useState("")
  const [appealActingId, setAppealActingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending")
  const [actingId, setActingId] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<VerifRequest | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [viewTarget, setViewTarget] = useState<VerifRequest | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, appealsRes] = await Promise.all([
        fetch("/api/admin/verification", { headers: getAuthHeader() }),
        fetch("/api/admin/verification/appeals", { headers: getAuthHeader() }),
      ])
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to load requests")
      setRequests(data.requests || [])
      if (appealsRes.ok) {
        const appealData = await appealsRes.json()
        setAppeals(appealData.appeals || [])
        setAppealsError(null)
      } else {
        const appealData = await appealsRes.json().catch(() => ({}))
        setAppeals([])
        setAppealsError(appealData.error || "Could not load appeals")
      }
    } catch (err: any) {
      toast({ title: "Load failed", description: err.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [getAuthHeader, toast])

  useEffect(() => {
    load()
  }, [load])

  const review = async (request: VerifRequest, action: "approved" | "rejected", notes?: string) => {
    setActingId(request.id)
    try {
      const res = await fetch("/api/admin/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ requestId: request.id, action, adminNotes: notes || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Action failed")
      toast({
        title: action === "approved" ? "Request approved" : "Request rejected",
        description:
          action === "approved"
            ? `${request.user?.username || request.username || "User"} is now verified.`
            : "The user will see your reason in their notification.",
      })
      setRejectTarget(null)
      setRejectReason("")
      await load()
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" })
    } finally {
      setActingId(null)
    }
  }

  const reviewAppeal = async (
    target: VerificationAppeal,
    action: "accepted" | "rejected",
    rejectionReason?: string,
  ) => {
    setAppealActingId(target.id)
    try {
      const response = await fetch("/api/admin/verification/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({
          appealId: target.id,
          action,
          rejectionReason: rejectionReason || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not review appeal")
      toast({
        title: action === "accepted" ? "Appeal accepted" : "Appeal rejected",
        description: action === "accepted"
          ? "The original application has returned to the normal review queue. No badge was granted."
          : "The applicant will see the review feedback in Verification settings.",
      })
      setAppealRejectTarget(null)
      setAppealRejectionReason("")
      await load()
    } catch (error) {
      toast({
        title: "Appeal review failed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setAppealActingId(null)
    }
  }

  const counts = {
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
  }
  const filtered = statusFilter === "all" ? requests : requests.filter((r) => r.status === statusFilter)
  const pendingAppeals = appeals.filter((appeal) => appeal.status === "pending")
  const historicalAppeals = appeals.filter((appeal) => appeal.status !== "pending")
  const visibleAppeals = appealView === "pending" ? pendingAppeals : historicalAppeals

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-border/70 bg-card/50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Verification appeals</h2>
            <p className="text-xs text-muted-foreground">A separate review of rejected applications. Accepting an appeal reopens the application; it never grants a checkmark.</p>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-muted/60 p-1">
            <Button
              size="sm"
              variant={appealView === "pending" ? "secondary" : "ghost"}
              className="h-7 rounded-full px-3 text-xs"
              aria-pressed={appealView === "pending"}
              onClick={() => setAppealView("pending")}
            >
              Pending {pendingAppeals.length}
            </Button>
            <Button
              size="sm"
              variant={appealView === "history" ? "secondary" : "ghost"}
              className="h-7 rounded-full px-3 text-xs"
              aria-pressed={appealView === "history"}
              onClick={() => setAppealView("history")}
            >
              History {historicalAppeals.length}
            </Button>
          </div>
        </div>
        {appealsError ? (
          <p className="text-xs text-amber-600">{appealsError}</p>
        ) : visibleAppeals.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
            {appealView === "pending"
              ? "No verification appeals are awaiting review."
              : "No verification appeals have been reviewed yet."}
          </p>
        ) : (
          <div className="space-y-3">
            {visibleAppeals.map((appeal) => {
              const applicant = appeal.user?.display_name || appeal.user?.username || "Applicant"
              return (
                <Card key={appeal.id} className="border-border/60">
                  <CardContent className="space-y-3 p-3 sm:p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{applicant}</p>
                        {appeal.user?.username && <p className="text-xs text-muted-foreground">@{appeal.user.username}</p>}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {appeal.request?.verification_type?.replace(/_/g, " ") || "Verification"} · appealed {timeAgo(appeal.created_at)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          appeal.status === "pending"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
                            : appeal.status === "accepted"
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                              : "border-red-500/30 bg-red-500/10 text-red-600"
                        }
                      >
                        {appeal.status === "pending" ? "Appeal pending" : appeal.status === "accepted" ? "Accepted" : "Rejected"}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Appeal statement</p>
                      <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{appeal.reason}</p>
                    </div>
                    {appeal.evidence_url && (
                      <a href={appeal.evidence_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" /> Open additional evidence
                      </a>
                    )}
                    {appeal.status === "pending" ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={appealActingId === appeal.id}
                          onClick={() => {
                            setAppealRejectTarget(appeal)
                            setAppealRejectionReason("")
                          }}
                        >
                          Reject appeal
                        </Button>
                        <Button
                          size="sm"
                          disabled={appealActingId === appeal.id}
                          onClick={() => reviewAppeal(appeal, "accepted")}
                        >
                          {appealActingId === appeal.id ? "Reviewing…" : "Accept appeal"}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-1 rounded-lg border border-border/60 bg-muted/20 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {appeal.status === "accepted" ? "Returned to application review" : "Applicant-facing decision"}
                        </p>
                        {appeal.rejection_reason && (
                          <p className="whitespace-pre-wrap text-xs">{appeal.rejection_reason}</p>
                        )}
                        {appeal.reviewer_notes && (
                          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                            Internal note: {appeal.reviewer_notes}
                          </p>
                        )}
                        {appeal.reviewed_at && (
                          <p className="text-[10px] text-muted-foreground">
                            Reviewed {new Date(appeal.reviewed_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* Filter chips + refresh */}
      <div className="flex flex-wrap items-center gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium capitalize transition-colors",
              statusFilter === s
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {s}
            {s !== "all" && counts[s] > 0 && (
              <span className="ml-1.5 text-xs opacity-70">{counts[s]}</span>
            )}
          </button>
        ))}
        <Button variant="outline" size="icon" className="ml-auto h-8 w-8" onClick={load} aria-label="Refresh">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="border-border/50">
              <CardContent className="flex items-center gap-4 p-4">
                <Skeleton className="h-11 w-11 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-8 w-24 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <BadgeCheck className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">No {statusFilter === "all" ? "" : statusFilter} requests</p>
            <p className="text-xs text-muted-foreground">
              Verification requests users submit from Settings will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((req) => {
            const name = req.user?.display_name || req.real_name || req.user?.username || req.username || "Unknown"
            const handle = req.user?.username || req.username
            const status = STATUS_META[req.status] || STATUS_META.pending
            const isPending = req.status === "pending"
            return (
              <Card key={req.id} className="border-border/50 transition-colors hover:border-border">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    {/* Avatar */}
                    {req.user?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={req.user.avatar_url}
                        alt={name}
                        className="h-11 w-11 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                        {name.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold">{name}</span>
                        {handle && <span className="truncate text-xs text-muted-foreground">@{handle}</span>}
                        <Badge variant="outline" className={cn("rounded-full text-[10px]", status.cls)}>
                          {status.label}
                        </Badge>
                        {req.verification_type && (
                          <Badge variant="outline" className="rounded-full text-[10px] capitalize">
                            {req.verification_type.replace(/_/g, " ")}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {req.reason || "No reason provided"}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                        Submitted {timeAgo(req.created_at)}
                        {req.reviewed_at && ` · Reviewed ${timeAgo(req.reviewed_at)}`}
                        {req.rejection_reason && ` · Reason: ${req.rejection_reason}`}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setViewTarget(req)}
                        aria-label="View details"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {isPending ? (
                        <>
                          <Button
                            size="sm"
                            className="h-8 gap-1.5 rounded-full"
                            disabled={actingId === req.id}
                            onClick={() => review(req, "approved")}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5 rounded-full border-red-500/30 text-red-600 hover:bg-red-500/10"
                            disabled={actingId === req.id}
                            onClick={() => {
                              setRejectTarget(req)
                              setRejectReason("")
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                            Reject
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-full"
                          onClick={() => review(req, req.status === "approved" ? "rejected" : "approved", req.admin_notes || undefined)}
                          disabled={actingId === req.id}
                        >
                          Re-review
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Details dialog */}
      <Dialog open={Boolean(viewTarget)} onOpenChange={(open) => !open && setViewTarget(null)}>
        <DialogContent className="sm:max-w-md">
          {viewTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BadgeCheck className="h-5 w-5 text-primary" />
                  Verification request
                </DialogTitle>
                <DialogDescription>
                  {viewTarget.user?.display_name || viewTarget.real_name || "Unknown"} · submitted{" "}
                  {timeAgo(viewTarget.created_at)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Real name</p>
                    <p className="font-medium">{viewTarget.real_name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Type</p>
                    <p className="font-medium capitalize">{(viewTarget.verification_type || "—").replace(/_/g, " ")}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Username</p>
                    <p className="font-medium">{viewTarget.user?.username || viewTarget.username || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</p>
                    <p className="font-medium capitalize">{viewTarget.status}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Reason</p>
                  <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">
                    {viewTarget.reason || "No reason provided"}
                  </p>
                </div>
                {viewTarget.social_links && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Social links</p>
                    <div className="mt-1 space-y-1">
                      {viewTarget.social_links
                        .split(/[\n,]+/)
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .map((link, i) => (
                          <a
                            key={i}
                            href={link.startsWith("http") ? link : `https://${link}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 truncate text-xs text-primary hover:underline"
                          >
                            <Link2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">{link}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                          </a>
                        ))}
                    </div>
                  </div>
                )}
                {viewTarget.documents_url && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Documents</p>
                    <a
                      href={viewTarget.documents_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open submitted document
                    </a>
                  </div>
                )}
                {viewTarget.admin_notes && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Admin notes</p>
                    <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{viewTarget.admin_notes}</p>
                  </div>
                )}
              </div>
              {viewTarget.status === "pending" && (
                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setRejectTarget(viewTarget)
                      setViewTarget(null)
                    }}
                  >
                    Reject
                  </Button>
                  <Button
                    onClick={() => {
                      const r = viewTarget
                      setViewTarget(null)
                      review(r, "approved")
                    }}
                  >
                    Approve
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(appealRejectTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setAppealRejectTarget(null)
            setAppealRejectionReason("")
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject verification appeal</DialogTitle>
            <DialogDescription>
              A concise reason will be visible to {appealRejectTarget?.user?.display_name || appealRejectTarget?.user?.username || "the applicant"}.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={appealRejectionReason}
            onChange={(event) => setAppealRejectionReason(event.target.value.slice(0, 2000))}
            placeholder="Explain why the original decision will remain unchanged."
            rows={4}
          />
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => {
              setAppealRejectTarget(null)
              setAppealRejectionReason("")
            }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={appealRejectionReason.trim().length < 10 || appealActingId === appealRejectTarget?.id}
              onClick={() => appealRejectTarget && reviewAppeal(appealRejectTarget, "rejected", appealRejectionReason.trim())}
            >
              Reject appeal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog — requires a reason */}
      <Dialog
        open={Boolean(rejectTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null)
            setRejectReason("")
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject verification request</DialogTitle>
            <DialogDescription>
              The reason is shown to{" "}
              {rejectTarget?.user?.display_name || rejectTarget?.real_name || "the user"} in their notification.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. We couldn't verify your identity from the links provided. Please resubmit with a government ID or official website."
            rows={4}
          />
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setRejectTarget(null)
                setRejectReason("")
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || actingId === rejectTarget?.id}
              onClick={() => rejectTarget && review(rejectTarget, "rejected", rejectReason.trim())}
            >
              Reject request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

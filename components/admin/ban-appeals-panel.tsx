"use client"

import { useCallback, useEffect, useState } from "react"
import { Ban, CheckCircle2, RefreshCw, ShieldAlert, XCircle } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { VideoAvatar } from "@/components/cosmetics/video-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/skeletons"

interface Appeal {
  id: string
  user_id: string
  reason: string
  status: string
  admin_notes?: string | null
  created_at: string
  reviewed_at?: string | null
  user?: {
    id: string
    username?: string
    display_name?: string
    avatar_url?: string
    email?: string
    is_banned?: boolean
    ban_reason?: string | null
    is_deleted?: boolean
    created_at?: string
  }
}

export function BanAppealsPanel() {
  const { getAuthHeader } = useAuth()
  const { toast } = useToast()
  const [appeals, setAppeals] = useState<Appeal[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("pending")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/ban-appeals?status=${status}`, { headers: getAuthHeader() })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to load appeals")
      setAppeals(data.appeals || [])
    } catch (error: any) {
      toast({ title: "Failed to load appeals", description: error.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [status, getAuthHeader, toast])

  useEffect(() => {
    void load()
  }, [load])

  const review = async (appealId: string, decision: "approve" | "deny") => {
    const reviewerNote = (notes[appealId] || "").trim()
    if (decision === "deny" && !reviewerNote) {
      toast({
        title: "Reason required",
        description: "Add a clear reason before denying this appeal.",
        variant: "destructive",
      })
      return
    }
    setBusyId(appealId)
    try {
      const response = await fetch("/api/admin/ban-appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ appeal_id: appealId, decision, admin_notes: reviewerNote }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Review failed")
      toast({
        title: decision === "approve" ? "Appeal approved" : "Appeal denied",
        description:
          decision === "approve" ? "The suspension was lifted and the user was notified." : "The user was notified.",
      })
      setNotes((current) => {
        const next = { ...current }
        delete next[appealId]
        return next
      })
      await load()
    } catch (error: any) {
      toast({ title: "Review failed", description: error.message, variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4" />
          Review suspension appeals. Approving lifts the ban and notifies the user.
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Spinner className="mr-2 h-5 w-5" /> Loading appeals…
        </div>
      ) : appeals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {status === "pending" ? "No pending appeals. 🎉" : "No appeals with this status."}
          </CardContent>
        </Card>
      ) : (
        appeals.map((appeal) => (
          <Card key={appeal.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-3">
                <Avatar>
                  <AvatarImage src={appeal.user?.avatar_url} />
                  <AvatarFallback>{(appeal.user?.display_name || appeal.user?.username || "U").charAt(0)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {appeal.user?.display_name || appeal.user?.username || "Unknown user"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{appeal.user?.username || "unknown"} · {appeal.user?.email || "no email"} · appealed{" "}
                    {new Date(appeal.created_at).toLocaleString()}
                  </p>
                </div>
                <Badge
                  variant={
                    appeal.status === "approved" ? "default" : appeal.status === "denied" ? "destructive" : "secondary"
                  }
                  className="rounded-full"
                >
                  {appeal.status}
                </Badge>
                {appeal.user?.is_banned && <Badge variant="destructive">Suspended</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-muted p-3 text-sm">
                <span className="font-semibold">Appeal: </span>
                {appeal.reason}
              </div>
              {appeal.admin_notes && (
                <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">Admin notes: </span>
                  {appeal.admin_notes}
                </div>
              )}
              {appeal.status === "pending" && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={notes[appeal.id] || ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [appeal.id]: e.target.value.slice(0, 2000) }))}
                    maxLength={2000}
                    placeholder="Required reason to deny; optional note on approval"
                    className="flex-1"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="rounded-full bg-emerald-600 hover:bg-emerald-500"
                      disabled={busyId === appeal.id}
                      onClick={() => review(appeal.id, "approve")}
                    >
                      {busyId === appeal.id ? <Spinner className="mr-1.5 h-4 w-4" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                      Approve & unban
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="rounded-full"
                      disabled={busyId === appeal.id || !(notes[appeal.id] || "").trim()}
                      onClick={() => review(appeal.id, "deny")}
                    >
                      <XCircle className="mr-1.5 h-4 w-4" /> Deny
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}

      <Card className="border-dashed">
        <CardContent className="flex items-start gap-3 py-4 text-sm text-muted-foreground">
          <Ban className="mt-0.5 h-4 w-4" />
          Suspensions are managed from the Users tab (Ban/Unban). Appeals submitted by suspended users are reviewed here.
        </CardContent>
      </Card>
    </div>
  )
}

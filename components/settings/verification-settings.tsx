"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BadgeCheck, CheckCircle2, Clock, Loader2, Send, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface VerifRequest {
  id: string | number
  verification_type: string
  status: string
  rejection_reason: string | null
  created_at: string
  reviewed_at: string | null
}

interface VerificationAppeal {
  id: string
  request_id: string
  reason: string
  evidence_url: string | null
  status: "pending" | "accepted" | "rejected"
  rejection_reason: string | null
  created_at: string
  reviewed_at: string | null
}

const TYPES = [
  { value: "creator", label: "Creator", hint: "You make content people follow" },
  { value: "business", label: "Business / Brand", hint: "A company or brand presence" },
  { value: "public_figure", label: "Public figure", hint: "You're known outside Loop" },
  { value: "nonprofit", label: "Nonprofit", hint: "Registered organization" },
]

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  pending: { label: "Under review", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", icon: Clock },
  approved: { label: "Approved", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", icon: CheckCircle2 },
  rejected: { label: "Not approved", cls: "bg-red-500/10 text-red-600 border-red-500/30", icon: XCircle },
}

export function VerificationSettings() {
  const { user, getAuthHeader } = useAuth()
  const { toast } = useToast()
  const [profile, setProfile] = useState<{ is_verified: boolean } | null>(null)
  const [requests, setRequests] = useState<VerifRequest[]>([])
  const [appeal, setAppeal] = useState<VerificationAppeal | null>(null)
  const [appealReason, setAppealReason] = useState("")
  const [appealEvidenceUrl, setAppealEvidenceUrl] = useState("")
  const [appealSubmitting, setAppealSubmitting] = useState(false)
  const [appealError, setAppealError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ verificationType: "creator", realName: "", socialLinks: "", reason: "", documents: "" })

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false)
      setRequests([])
      setAppeal(null)
      return
    }
    setLoading(true)
    try {
      const [profileRes, reqRes] = await Promise.all([
        // /api/auth/me is the canonical current-profile endpoint (user +
        // profile fields incl. is_verified, avatar_url, display_name).
        fetch("/api/auth/me", { headers: getAuthHeader() }).catch(() => null),
        fetch("/api/verification/request", { headers: getAuthHeader() }),
      ])
      if (profileRes?.ok) {
        const data = await profileRes.json()
        const p = data.profile || data.user || data
        setProfile({ is_verified: Boolean(p?.is_verified) })
      }
      if (reqRes.ok) {
        const data = await reqRes.json()
        const nextRequests = (data.requests || []) as VerifRequest[]
        setRequests(nextRequests)
        const latestRequest = nextRequests[0]
        if (latestRequest?.status === "rejected" && typeof latestRequest.id === "string") {
          const appealRes = await fetch(
            `/api/verification/request/${encodeURIComponent(latestRequest.id)}/appeal`,
            { headers: getAuthHeader() },
          )
          if (appealRes.ok) {
            const appealData = await appealRes.json()
            setAppeal(appealData.appeal || null)
            setAppealError(null)
          } else {
            const appealData = await appealRes.json().catch(() => ({}))
            setAppeal(null)
            setAppealError(appealData.error || "Appeals are temporarily unavailable.")
          }
        } else {
          setAppeal(null)
          setAppealError(null)
          setAppealReason("")
          setAppealEvidenceUrl("")
        }
      }
    } finally {
      setLoading(false)
    }
  }, [user, getAuthHeader])

  useEffect(() => {
    load()
  }, [load])

  const pending = requests.find((r) => r.status === "pending")
  const latest = requests[0]

  const canSubmit = Boolean(user && profile && !profile.is_verified && !pending)

  const submit = async () => {
    if (!form.realName.trim() || !form.reason.trim()) {
      toast({ title: "Missing details", description: "Your real name and reason are required." })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/verification/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({
          realName: form.realName.trim(),
          socialLinks: form.socialLinks.trim(),
          reason: form.reason.trim(),
          verificationType: form.verificationType,
          documents: form.documents.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Submit failed")
      toast({ title: "Request submitted", description: "The Loop team reviews requests in order. You'll be notified of the decision." })
      setForm({ verificationType: form.verificationType, realName: "", socialLinks: "", reason: "", documents: "" })
      load()
    } catch (err: any) {
      toast({ title: "Could not submit", description: err.message, variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const submitAppeal = async () => {
    if (!latest || latest.status !== "rejected" || !appealReason.trim()) return
    setAppealSubmitting(true)
    try {
      const response = await fetch(
        `/api/verification/request/${encodeURIComponent(String(latest.id))}/appeal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({
            reason: appealReason.trim(),
            evidenceUrl: appealEvidenceUrl.trim() || null,
          }),
        },
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not submit appeal")
      toast({
        title: "Appeal submitted",
        description: "The team will review your appeal separately. This does not grant verification.",
      })
      setAppealReason("")
      setAppealEvidenceUrl("")
      await load()
    } catch (error) {
      toast({
        title: "Could not submit appeal",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setAppealSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Current status */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            profile?.is_verified ? "bg-sky-500/10" : "bg-muted",
          )}>
            <BadgeCheck className={cn("h-5 w-5", profile?.is_verified ? "text-sky-500" : "text-muted-foreground")} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {profile?.is_verified ? "Your account is verified" : "Get verified on Loop"}
            </p>
            <p className="text-sm text-muted-foreground">
              {profile?.is_verified
                ? "The checkmark shows next to your name across Loop."
                : "Verification is an identity and authenticity review. Premium never grants a checkmark or priority."}
            </p>
          </div>
        </div>
      </div>

      {/* Pending / latest decision */}
      {pending && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <Clock className="h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-semibold">Request under review</p>
            <p className="text-xs text-muted-foreground">
              Submitted {new Date(pending.created_at).toLocaleDateString()} · you'll get a notification when it's decided.
            </p>
          </div>
        </div>
      )}
      {!pending && latest?.status === "rejected" && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-600">
            <XCircle className="h-4 w-4" /> Previous request wasn't approved
          </p>
          {latest.rejection_reason && <p className="mt-1 text-xs text-muted-foreground">Reviewer feedback: {latest.rejection_reason}</p>}
          <p className="mt-1 text-xs text-muted-foreground">You can submit one appeal for this decision, or provide further evidence with a new application.</p>
        </div>
      )}
      {!pending && latest?.status === "rejected" && appeal?.status === "pending" && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold">Appeal submitted</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your appeal is awaiting review. The original decision remains in place until the appeal is reviewed.
          </p>
        </div>
      )}
      {!pending && latest?.status === "rejected" && appeal?.status === "accepted" && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
          <p className="text-sm font-semibold">Application returned to review</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your appeal was accepted and the original application was reopened. This is not a verification approval.
          </p>
        </div>
      )}
      {!pending && latest?.status === "rejected" && appeal?.status === "rejected" && (
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm font-semibold">Appeal reviewed</p>
          {appeal.rejection_reason && <p className="mt-1 text-xs text-muted-foreground">{appeal.rejection_reason}</p>}
          <p className="mt-1 text-xs text-muted-foreground">This application has used its one appeal.</p>
        </div>
      )}
      {!pending && latest?.status === "rejected" && !appeal && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Appeal this decision</p>
            <p className="text-xs text-muted-foreground">
              Add context the reviewer may have missed. One appeal is allowed per application; include new evidence or explain what the original review may have missed.
            </p>
          </div>
          {appealError && <p className="mt-2 text-xs text-amber-600">{appealError}</p>}
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="verification-appeal-reason">Why should this decision be reconsidered?</Label>
              <Textarea
                id="verification-appeal-reason"
                rows={3}
                maxLength={2000}
                value={appealReason}
                onChange={(event) => setAppealReason(event.target.value.slice(0, 2000))}
                placeholder="Explain what the original review may have missed."
              />
              <p className="text-right text-xs text-muted-foreground">
                {appealReason.trim().length}/2000 characters · 20 minimum
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verification-appeal-evidence">Additional public HTTPS evidence link (optional)</Label>
              <Input
                id="verification-appeal-evidence"
                type="url"
                maxLength={2048}
                value={appealEvidenceUrl}
                onChange={(event) => setAppealEvidenceUrl(event.target.value)}
                placeholder="https://example.com/official-profile"
              />
            </div>
            <Button
              className="rounded-full"
              onClick={submitAppeal}
              disabled={appealSubmitting || appealReason.trim().length < 20 || Boolean(appealError)}
            >
              {appealSubmitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
              Submit appeal
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-card p-4">
        <p className="text-sm font-semibold">What the review considers</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The team reviews whether the account represents the person or organization applying,
          the consistency of its public presence, and the evidence you provide. Apply only for an
          account you represent. Do not upload identity documents here; use public evidence links.
        </p>
      </div>

      {!user && (
        <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
          Sign in to request verification.
        </p>
      )}
      {user && !profile && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
          We could not load your account details. Reload this page before submitting a request.
        </p>
      )}

      {/* Request form */}
      {profile?.is_verified || pending || !user || !profile ? null : (
        <div className="rounded-2xl border bg-card p-4">
          <p className="mb-3 text-sm font-semibold">Request verification</p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Verification type</Label>
              <Select value={form.verificationType} onValueChange={(v) => setForm((p) => ({ ...p, verificationType: v }))} disabled={!canSubmit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label} — <span className="text-muted-foreground">{t.hint}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="vr-name">Real name <span className="text-red-500">*</span></Label>
                <Input
                  id="vr-name"
                  maxLength={160}
                  value={form.realName}
                  onChange={(e) => setForm((p) => ({ ...p, realName: e.target.value }))}
                  placeholder="Your legal or stage name"
                  disabled={!canSubmit}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vr-links">Social links</Label>
                <Input
                  id="vr-links"
                  maxLength={2000}
                  value={form.socialLinks}
                  onChange={(e) => setForm((p) => ({ ...p, socialLinks: e.target.value }))}
                  placeholder="Instagram, YouTube, X…"
                  disabled={!canSubmit}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vr-reason">Why should you be verified? <span className="text-red-500">*</span></Label>
              <Textarea
                id="vr-reason"
                rows={3}
                maxLength={2000}
                value={form.reason}
                onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value.slice(0, 2000) }))}
                placeholder="Tell the team who you are and where people follow you."
                disabled={!canSubmit}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vr-docs">Supporting link (optional)</Label>
              <Input
                id="vr-docs"
                type="url"
                maxLength={2048}
                value={form.documents}
                onChange={(e) => setForm((p) => ({ ...p, documents: e.target.value }))}
                placeholder="Link to press page, portfolio, or official site"
                disabled={!canSubmit}
              />
              <p className="text-[11px] text-muted-foreground">
                Don't upload ID documents here. The team may ask for proof through official channels if needed.
              </p>
            </div>
            <Button className="rounded-full" disabled={!canSubmit || submitting} onClick={submit}>
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
              Submit request
            </Button>
          </div>
        </div>
      )}

      {/* History */}
      {requests.length > 0 && (
        <div className="rounded-2xl border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">Request history</p>
          <div className="space-y-2">
            {requests.map((r) => {
              const meta = STATUS_META[r.status] || STATUS_META.pending
              const Icon = meta.icon
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-xl border p-3">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium capitalize">{r.verification_type.replace("_", " ")} verification</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                      {r.reviewed_at ? ` · reviewed ${new Date(r.reviewed_at).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn("shrink-0 rounded-full text-[10px]", meta.cls)}>
                    {meta.label}
                  </Badge>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

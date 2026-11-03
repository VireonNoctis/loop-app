"use client";
import type React from "react";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BadgeCheck, CheckCircle, Clock, Shield, Star, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

type VerificationType = "creator" | "business" | "public_figure" | "nonprofit";

interface ExistingRequest {
  id: string | number;
  verification_type: string;
  status: string;
  rejection_reason?: string | null;
  created_at: string;
}

const TYPE_OPTIONS: Array<{ value: VerificationType; label: string; hint: string }> = [
  { value: "creator", label: "Creator", hint: "You make content people follow" },
  { value: "business", label: "Business / Brand", hint: "A company or brand presence" },
  { value: "public_figure", label: "Public figure", hint: "You're known outside Loop" },
  { value: "nonprofit", label: "Nonprofit", hint: "Registered organization" },
];

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  pending: { label: "Under review", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", icon: Clock },
  approved: { label: "Approved", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", icon: CheckCircle },
  rejected: { label: "Not approved", cls: "bg-red-500/10 text-red-600 border-red-500/30", icon: XCircle },
};

export function VerificationRequest() {
  const [formData, setFormData] = useState({
    realName: "",
    socialLinks: "",
    reason: "",
    documents: "",
    category: "creator" as VerificationType,
  });
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [profile, setProfile] = useState<{ is_verified: boolean } | null>(null)
  const [existingRequests, setExistingRequests] = useState<ExistingRequest[]>([])
  const { toast } = useToast()
  const { user, getAuthHeader } = useAuth()

  // Load the signed-in account's verification state and request history.
  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const [meRes, reqRes] = await Promise.all([
          fetch("/api/auth/me", { headers: getAuthHeader() }).catch(() => null),
          fetch("/api/verification/request", { headers: getAuthHeader() }).catch(() => null),
        ])
        if (!mounted) return
        if (meRes?.ok) {
          const data = await meRes.json()
          const p = data.profile || data.user || null
          if (p) {
            setProfile({ is_verified: Boolean(p.is_verified) })
          }
        }
        if (reqRes?.ok) {
          const data = await reqRes.json()
          setExistingRequests(data.requests || [])
        }
      } catch {
        /* non-blocking */
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [getAuthHeader])

  const pendingRequest = existingRequests.find((r) => r.status === "pending")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/verification/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          realName: formData.realName,
          socialLinks: formData.socialLinks,
          reason: formData.reason,
          verificationType: formData.category,
          documents: formData.documents,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit verification request')
      }

      toast({
        title: "Verification Request Submitted!",
        description: "Your request is in the review queue. We'll notify you when a decision is made.",
      })

      // Reset form
      setFormData((prev) => ({
        realName: "",
        socialLinks: "",
        reason: "",
        documents: "",
        category: prev.category,
      }))
      // Refresh request history so the pending banner shows immediately.
      const reqRes = await fetch("/api/verification/request", { headers: getAuthHeader() }).catch(() => null)
      if (reqRes?.ok) {
        const reqData = await reqRes.json()
        setExistingRequests(reqData.requests || [])
      }
    } catch (error) {
      toast({
        title: "Couldn't submit request",
        description: error instanceof Error ? error.message : "Double-check your details and resubmit.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const alreadyVerified = Boolean(profile?.is_verified)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
            <Shield className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        <h1 className="text-3xl font-bold">Get Verified on loopapp.me</h1>
        <p className="text-gray-600 dark:text-gray-400">Verification is a manual authenticity review. Premium never grants a checkmark or priority.</p>
      </div>

      {alreadyVerified && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-500" />
          <p className="text-sm font-medium">Your account is already verified — no need to apply again.</p>
        </div>
      )}

      {!pendingRequest && !alreadyVerified && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <Star className="w-8 h-8 text-blue-500 mx-auto" />
              <h3 className="font-semibold">Creator Verification</h3>
              <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                Blue Checkmark
              </Badge>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                For content creators and notable individual accounts
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <CheckCircle className="w-8 h-8 text-green-500 mx-auto" />
              <h3 className="font-semibold">Organization Verification</h3>
              <Badge variant="secondary" className="bg-green-100 text-green-700">
                Official Badge
              </Badge>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                For organizations, businesses, and official accounts
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {pendingRequest && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <Clock className="h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-semibold">Request under review</p>
            <p className="text-xs text-muted-foreground">
              Submitted {new Date(pendingRequest.created_at).toLocaleDateString()} · you'll get a notification when it's decided.
            </p>
          </div>
        </div>
      )}

      {!user && (
        <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
          Sign in to request verification.
        </p>
      )}

      {/* Request form — hidden while signed out, pending or already verified */}
      {user && !alreadyVerified && !pendingRequest && (
        <Card>
          <CardHeader>
            <CardTitle>Verification Application</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="realName">Real Name *</Label>
                  <Input
                    id="realName"
                    maxLength={160}
                    value={formData.realName}
                    onChange={(e) => setFormData((prev) => ({ ...prev, realName: e.target.value }))}
                    placeholder="Your full legal name"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Verification Type</Label>
                <div className="flex flex-wrap gap-4">
                  {TYPE_OPTIONS.map((t) => (
                    <label key={t.value} className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="radio"
                        name="category"
                        value={t.value}
                        checked={formData.category === t.value}
                        onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value as VerificationType }))}
                      />
                      <span>{t.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="socialLinks">Social Media Links</Label>
                <Textarea
                  id="socialLinks"
                  maxLength={2000}
                  value={formData.socialLinks}
                  onChange={(e) => setFormData((prev) => ({ ...prev, socialLinks: e.target.value }))}
                  placeholder={"Instagram: @username\nWebsite: https://..."}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="documents">Supporting link (optional)</Label>
                <Input
                  id="documents"
                  type="url"
                  maxLength={2048}
                  value={formData.documents}
                  onChange={(e) => setFormData((prev) => ({ ...prev, documents: e.target.value }))}
                  placeholder="https://your-official-site.example"
                />
                <p className="text-xs text-muted-foreground">
                  Add a public portfolio, press page or official website. Do not submit identity documents here.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">Why should you be verified? *</Label>
                <Textarea
                  id="reason"
                  maxLength={2000}
                  value={formData.reason}
                  onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="Explain your public interest, notable achievements, or why verification would benefit the community..."
                  rows={4}
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-gradient-to-r from-blue-500 to-purple-500"
              >
                {isSubmitting ? "Submitting..." : "Submit Verification Request"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {existingRequests.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Request history</p>
          {existingRequests.map((r) => {
            const meta = STATUS_META[r.status] || STATUS_META.pending
            const Icon = meta.icon
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border p-3">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium capitalize">{r.verification_type.replace("_", " ")} verification</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p>
                  {r.rejection_reason && <p className="mt-0.5 text-[11px] text-muted-foreground">Note: {r.rejection_reason}</p>}
                </div>
                <Badge variant="outline" className="shrink-0 rounded-full text-[10px]">
                  {meta.label}
                </Badge>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

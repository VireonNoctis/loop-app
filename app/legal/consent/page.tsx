"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, Check, FileText, LockKeyhole, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/skeletons"
import { useAuth } from "@/hooks/use-auth"
import { rustApiRequest } from "@/lib/rust-api"

type LegalAcceptanceStatus = {
  terms_version: string
  privacy_version: string
  terms_accepted: boolean
  privacy_acknowledged: boolean
  complete: boolean
  publication_ready: boolean
  missing_publication_fields: string[]
}

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value === "/legal/consent" || value.startsWith("/legal/consent/")) {
    return "/"
  }
  return value
}

export default function LegalConsentPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-background">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      }
    >
      <LegalConsentContent />
    </Suspense>
  )
}

function LegalConsentContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading } = useAuth()
  const authToken = user?.access_token || user?.token
  const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {}
  const destination = safeReturnPath(searchParams.get("returnTo"))
  const [status, setStatus] = useState<LegalAcceptanceStatus | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [checking, setChecking] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace(`/login?redirect=${encodeURIComponent(destination)}`)
      return
    }

    let active = true
    setChecking(true)
    setStatus(null)
    setError("")

    Promise.all([
      rustApiRequest<LegalAcceptanceStatus>("legal/acceptance", { headers: authHeaders }),
      fetch("/api/legal/publication-readiness", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("We could not verify LOOP's legal publication details.")
        return response.json() as Promise<{ publication_ready: boolean; missing_publication_fields: string[] }>
      }),
    ])
      .then(([result, frontendReadiness]) => {
        if (!active) return
        const missing = Array.from(new Set([
          ...result.missing_publication_fields,
          ...frontendReadiness.missing_publication_fields,
        ]))
        const combined = {
          ...result,
          publication_ready: result.publication_ready && frontendReadiness.publication_ready && missing.length === 0,
          missing_publication_fields: missing,
        }
        setStatus(combined)
        if (combined.complete && combined.publication_ready) router.replace(destination)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(reason instanceof Error ? reason.message : "We could not load your agreement status.")
      })
      .finally(() => {
        if (active) setChecking(false)
      })

    return () => {
      active = false
    }
  }, [user?.id, authToken, loading, router, destination, retryCount])

  const confirmAgreement = async () => {
    if (!accepted || saving || !status?.publication_ready) return
    setSaving(true)
    setError("")

    try {
      const result = await rustApiRequest<LegalAcceptanceStatus>("legal/acceptance", {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          terms_accepted: true,
          privacy_acknowledged: true,
        }),
      })
      setStatus(result)
      router.replace(destination)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your agreement could not be saved. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  if (loading || checking) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-5">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Spinner className="h-5 w-5" />
          Checking your agreement…
        </div>
      </main>
    )
  }

  if (!user) return null

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-primary/[0.10] blur-3xl" />
        <div className="absolute -bottom-56 -right-32 h-[26rem] w-[26rem] rounded-full bg-sky-500/[0.07] blur-3xl" />
        <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:52px_52px]" />
      </div>

      <section className="loop-consent-enter w-full max-w-xl">
        <div className="mb-7 flex items-center justify-center">
          <Link href="/" aria-label="LOOP home" className="group inline-flex items-center gap-3 rounded-full border border-border/70 bg-card/70 px-4 py-2 shadow-sm backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-primary/30">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-background ring-1 ring-border">
              <img src="/icons/icon.svg" alt="" className="h-full w-full" />
            </span>
            <span className="text-lg font-semibold tracking-tight">LOOP</span>
            <span className="text-xs text-muted-foreground">Your account, your choice</span>
          </Link>
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-border/80 bg-card/90 shadow-[0_28px_90px_-35px_hsl(var(--foreground)/0.24)] backdrop-blur-2xl">
          <div className="border-b border-border/70 px-6 pb-6 pt-7 sm:px-9 sm:pt-9">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">One last step</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">A clear agreement before you continue.</h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
              Please review the documents below. We’ll save your agreement to your account with the document versions and the time you accepted them.
            </p>
            {status && (
              <p className="mt-3 text-[11px] font-medium tracking-wide text-muted-foreground">
                CURRENT VERSIONS · TERMS {status.terms_version} · PRIVACY {status.privacy_version}
              </p>
            )}
            {status && !status.publication_ready && (
              <div role="alert" className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-6">
                <p className="font-semibold text-foreground">Agreement is not available yet.</p>
                <p className="mt-1 text-muted-foreground">
                  The service owner must publish verified operator, provider, transfer, and retention details before LOOP can record your agreement.
                </p>
                {status.missing_publication_fields.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {status.missing_publication_fields.map((field) => (
                      <li key={field}>{field.replaceAll("_", " ").toLowerCase()}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4 px-6 py-6 sm:px-9 sm:py-8">
            <Link href="/terms" target="_blank" rel="noopener noreferrer" className="group flex items-center gap-4 rounded-2xl border border-border bg-background/65 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg hover:shadow-primary/5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileText className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Terms of Service</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">The rules and conditions for using LOOP.</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>

            <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="group flex items-center gap-4 rounded-2xl border border-border bg-background/65 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg hover:shadow-primary/5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400"><LockKeyhole className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Privacy Policy</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">What information is used and how it is handled.</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>

            <label htmlFor="legal-acceptance" className="flex cursor-pointer gap-3 rounded-2xl border border-border bg-muted/35 p-4 transition-colors hover:border-primary/35 has-[:checked]:border-primary/45 has-[:checked]:bg-primary/[0.045]">
              <input
                id="legal-acceptance"
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              />
              <span className="text-sm leading-6">
                I agree to the <Link href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-4" onClick={(event) => event.stopPropagation()}>Terms of Service</Link> and acknowledge that I have read the <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-4" onClick={(event) => event.stopPropagation()}>Privacy Policy</Link>.
              </span>
            </label>

            {error && (
              <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
                <button type="button" className="ml-2 font-semibold underline underline-offset-4" onClick={() => setRetryCount((count) => count + 1)}>Retry</button>
              </div>
            )}

            <Button
              type="button"
              size="lg"
              className="group h-12 w-full rounded-xl"
              disabled={!accepted || saving || !status || !status.publication_ready}
              onClick={confirmAgreement}
            >
              {saving ? <Spinner className="mr-2 h-4 w-4" /> : <Check className="mr-2 h-4 w-4 transition-transform group-hover:scale-110" />}
              {saving ? "Saving your agreement…" : "Agree and continue"}
              {!saving && <ArrowRight className="ml-auto h-4 w-4 transition-transform group-hover:translate-x-1" />}
            </Button>

            <p className="text-center text-xs leading-5 text-muted-foreground">
              You can revisit these documents at any time from the footer and account settings. The checkbox is required before account access continues.
            </p>
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.email}</span>
        </p>
      </section>
    </main>
  )
}

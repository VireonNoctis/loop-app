"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Check,
  Code2,
  Coins,
  CreditCard,
  Crown,
  DollarSign,
  Flame,
  Gift,
  Lock,
  MessageSquare,
  Pin,
  ShieldCheck,
  Swords,
  TrendingUp,
  Type,
  Upload,
  Users,
  Video,
  Zap,
} from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { CheckoutReceipt } from "@/components/premium/checkout-receipt"
import { useToast } from "@/hooks/use-toast"
import { PRO_FEATURES, PRO_PRICING, type ProPlanId } from "@/lib/pro-features"
import { cn } from "@/lib/utils"

const iconMap = {
  upload: Upload,
  zap: Zap,
  coins: Coins,
  sparkles: Zap, crown: Crown,
  code: Code2,
  video: Video,
  trending: TrendingUp,
  lock: Lock,
  dollar: DollarSign,
  gift: Gift,
  swords: Swords,
  users: Users,
  shield: ShieldCheck,
  flame: Flame,
  type: Type,
  pin: Pin,
  discord: MessageSquare,
} as const

export function PremiumUpgrade() {
  const [selectedPlan, setSelectedPlan] = useState<ProPlanId>("annual")
  const [busy, setBusy] = useState(false)
  const [portalBusy, setPortalBusy] = useState(false)
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null)
  const [checkoutCancelled, setCheckoutCancelled] = useState(false)
  const coinPurchaseAttempt = useRef<{ plan: ProPlanId; key: string } | null>(null)
  const [billingStatus, setBillingStatus] = useState<{
    can_manage?: boolean
    status?: string
    current_period_end?: string | null
    cancel_at_period_end?: boolean
  } | null>(null)
  const { user, getAuthHeader, refreshUser } = useAuth()
  const { toast } = useToast()

  useEffect(() => {
    const url = new URL(window.location.href)
    const checkout = url.searchParams.get("checkout")
    if (checkout === "success") {
      setCheckoutSessionId(url.searchParams.get("session_id"))
    } else if (checkout === "cancelled") {
      setCheckoutCancelled(true)
    }
  }, [])

  useEffect(() => {
    if (!user?.is_premium) {
      setBillingStatus(null)
      return
    }
    let active = true
    void fetch("/api/premium/status", { headers: getAuthHeader(), cache: "no-store" })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Could not load billing status")
        if (active) setBillingStatus(data.subscription || null)
      })
      .catch(() => {
        if (active) setBillingStatus(null)
      })
    return () => { active = false }
  }, [getAuthHeader, user?.id, user?.is_premium])

  const manageBilling = async () => {
    setPortalBusy(true)
    try {
      const response = await fetch("/api/premium/portal", {
        method: "POST",
        headers: getAuthHeader(),
      })
      const data = await response.json()
      if (!response.ok || !data.url) throw new Error(data.error || "Could not open billing settings")
      window.location.href = data.url
    } catch (error: any) {
      toast({
        title: "Billing settings unavailable",
        description: error.message || "Try again later.",
        variant: "destructive",
      })
    } finally {
      setPortalBusy(false)
    }
  }

  const handleReceiptComplete = useCallback(() => {
    void refreshUser()
  }, [refreshUser])

  const activate = async (plan: ProPlanId, method: "coins" | "stripe" = "coins") => {
    if (!user) {
      toast({ title: "Sign in required", description: "Please sign in to upgrade." })
      return
    }
    setBusy(true)
    const attempt = method === "coins"
      ? coinPurchaseAttempt.current?.plan === plan
        ? coinPurchaseAttempt.current
        : { plan, key: crypto.randomUUID() }
      : null
    if (attempt) coinPurchaseAttempt.current = attempt
    try {
      const res = await fetch("/api/premium/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
          ...(attempt ? { "Idempotency-Key": attempt.key } : {}),
        },
        body: JSON.stringify({ plan, method }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not activate Pro")
      if (method === "stripe" && data.checkout_url) {
        window.location.href = data.checkout_url
        return
      }
      if (attempt && coinPurchaseAttempt.current?.key === attempt.key) {
        coinPurchaseAttempt.current = null
      }
      await refreshUser?.()
      toast({ title: "You're Pro!", description: data.message })
    } catch (error: any) {
      toast({
        title: "Couldn’t unlock Pro",
        description: error.message,
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  if (checkoutSessionId) {
    return (
      <div className="mx-auto max-w-2xl">
        <CheckoutReceipt
          sessionId={checkoutSessionId}
          onComplete={handleReceiptComplete}
          onClose={() => {
            setCheckoutSessionId(null)
            window.history.replaceState({}, "", "/premium")
          }}
        />
      </div>
    )
  }

  if (user?.is_premium) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 text-center">
        <div className="rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 p-6 text-white">
          <Crown className="mx-auto mb-4 h-12 w-12" />
          <h1 className="mb-2 text-2xl font-bold">You&apos;re on Loop Pro</h1>
          <p className="text-white/90">
            {user.premium_expires_at
              ? `Active until ${new Date(user.premium_expires_at).toLocaleDateString()}`
              : "All Pro perks are unlocked."}
          </p>
        </div>
        <Card>
          <CardContent className="grid gap-3 p-6 text-left">
            {PRO_FEATURES.filter((feature) => feature.enforced).map((feature) => (
              <div key={feature.id} className="flex items-start gap-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                <div>
                  <p className="font-medium">{feature.title}</p>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
          <Button asChild className="rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-400 hover:to-purple-500">
            <Link href="/lounge">
              <Lock className="mr-2 h-4 w-4" /> Enter the Pro Lounge
            </Link>
          </Button>
          {billingStatus?.can_manage ? (
            <Button variant="outline" className="rounded-full" onClick={() => void manageBilling()} disabled={portalBusy}>
              {portalBusy ? "Opening billing…" : "Manage subscription"}
            </Button>
          ) : null}
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/">Back to feed</Link>
          </Button>
        </div>
        {billingStatus?.cancel_at_period_end && billingStatus.current_period_end ? (
          <p className="text-sm text-muted-foreground">
            Your card subscription is set to end on {new Date(billingStatus.current_period_end).toLocaleDateString()}. Pro remains active until then.
          </p>
        ) : null}
      </div>
    )
  }

  const plan = PRO_PRICING[selectedPlan]
  const balance = Number(user?.loop_coins || 0)

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {checkoutCancelled ? (
        <Card className="border-border/70">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted-foreground">Checkout was cancelled. No subscription was started.</p>
            <Button variant="ghost" size="sm" onClick={() => setCheckoutCancelled(false)}>Dismiss</Button>
          </CardContent>
        </Card>
      ) : null}
      <div className="space-y-3 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-600">
          <Crown className="h-7 w-7 text-white" />
        </div>
        <Badge variant="secondary" className="rounded-full">
          Launch pricing — limited while Loop is new
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Loop Pro that actually feels worth it
        </h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Choose a recurring card subscription or a separate prepaid Coin pass. Both unlock the same Pro membership; card renewals can be cancelled through billing settings.
        </p>
      </div>

      {/* Secret VIP Lounge Highlight Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-950/40 via-purple-950/30 to-slate-900 p-6 shadow-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40">
              <Lock className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">Secret Pro Lounge (#LoopPro)</h3>
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px] uppercase tracking-wider">
                  Invite Only
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-300 max-w-xl">
                Get instant access to the private #LoopPro Circle. Network directly with top creators, participate in monthly founder Q&As, test upcoming features before launch, and receive 0% commission payouts.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3.5 py-1.5 text-xs font-semibold text-amber-300 border border-amber-500/30">
              <Zap className="h-3.5 w-3.5" />
              Included with Pro
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(Object.values(PRO_PRICING) as Array<(typeof PRO_PRICING)[ProPlanId]>).map((item) => (
          <Card
            key={item.id}
            className={cn(
              "relative cursor-pointer transition",
              selectedPlan === item.id ? "ring-2 ring-amber-500 shadow-lg" : "hover:border-amber-500/40",
              "popular" in item && item.popular ? "border-amber-500/50" : "",
            )}
            onClick={() => setSelectedPlan(item.id)}
          >
            {"popular" in item && item.popular ? (
              <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-amber-500 text-slate-900 hover:bg-amber-500">
                Best value
              </Badge>
            ) : null}
            <CardHeader className="text-center">
              <CardTitle>{item.name}</CardTitle>
              <div className="space-y-1">
                <p className="text-4xl font-bold">
                  {item.priceLabel}
                  <span className="text-base font-normal text-muted-foreground">{item.period}</span>
                </p>
                <p className="text-sm text-muted-foreground">{item.description}</p>
                {"savings" in item && item.savings ? (
                  <p className="text-sm font-medium text-emerald-600">{item.savings}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">or {item.coins.toLocaleString()} Loop Coins as a prepaid pass</p>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Button
          size="lg"
          disabled={busy || !user}
          onClick={() => void activate(selectedPlan, "coins")}
          className="w-full rounded-full bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-400 hover:to-orange-500 sm:w-auto"
        >
          <Coins className="mr-2 h-4 w-4" />
          {busy ? "Unlocking…" : `Prepay ${plan.name} · ${plan.coins} coins`}
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={busy || !user}
          onClick={() => void activate(selectedPlan, "stripe")}
          className="w-full rounded-full border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400 sm:w-auto"
        >
          <CreditCard className="mr-2 h-4 w-4" />
          {busy ? "Redirecting…" : `Subscribe with card · ${plan.priceLabel}`}
        </Button>
        <Button asChild size="lg" variant="ghost" className="w-full rounded-full sm:w-auto">
          <Link href="/shop">Buy coins in Shop</Link>
        </Button>
      </div>
      {user ? (
        <p className="text-center text-sm text-muted-foreground">
          Your balance: <span className="font-semibold text-foreground">{balance.toLocaleString()} coins</span>
          {balance < plan.coins ? " — a prepaid pass needs enough Coins" : " — enough for a prepaid pass"}
        </p>
      ) : (
        <p className="text-center text-sm">
          <Link href="/login" className="font-medium text-primary underline">
            Sign in
          </Link>{" "}
          to unlock Pro
        </p>
      )}
      <p className="text-center text-xs text-muted-foreground">
        Card subscriptions renew {selectedPlan === "annual" ? "yearly" : "monthly"}. Coin passes do not auto-renew.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {PRO_FEATURES.map((feature) => {
          const Icon = iconMap[feature.icon as keyof typeof iconMap] || Zap
          return (
            <Card key={feature.id} className="border-border/70">
              <CardContent className="flex gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{feature.title}</p>
                    {!feature.enforced ? (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        In development · Not available yet
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{feature.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Free: {feature.free} · <span className="font-medium text-foreground">Pro: {feature.pro}</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

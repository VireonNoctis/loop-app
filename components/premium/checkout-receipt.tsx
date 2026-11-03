"use client"

import { useCallback, useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { CheckCircle2, Loader2, Printer, RotateCw } from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"

type ReceiptStage = "processing" | "printing" | "complete"

interface ReceiptData {
  order_number: string
  plan: string
  amount_total: number
  currency: string
  created_at: string
  current_period_end: string | null
  subscription_status: string
}

interface ReceiptResponse {
  state: "processing" | "complete"
  receipt: ReceiptData | null
  error?: string
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100)
}

/**
 * Original LOOP receipt-printer confirmation, inspired by the Dqnamo Kitchen
 * receipt-printer interaction. It completes only after server-side payment
 * and subscription verification for the signed-in user.
 */
export function CheckoutReceipt({
  sessionId,
  onComplete,
  onClose,
}: {
  sessionId: string
  onComplete: () => void
  onClose: () => void
}) {
  const { user, loading: authLoading, getAuthHeader } = useAuth()
  const reduceMotion = useReducedMotion()
  const [stage, setStage] = useState<ReceiptStage>("processing")
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [error, setError] = useState("")
  const [checking, setChecking] = useState(false)
  const [attempts, setAttempts] = useState(0)

  const verify = useCallback(async () => {
    if (!user) return
    setChecking(true)
    setError("")
    try {
      const response = await fetch(
        `/api/premium/checkout-status?session_id=${encodeURIComponent(sessionId)}`,
        { headers: getAuthHeader(), cache: "no-store" },
      )
      const data = await response.json() as ReceiptResponse
      if (!response.ok) throw new Error(data.error || "Could not verify checkout")
      setReceipt(data.receipt)
      setStage(data.state === "complete" && data.receipt ? "printing" : "processing")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify checkout")
    } finally {
      setChecking(false)
    }
  }, [getAuthHeader, sessionId, user])

  useEffect(() => {
    if (!authLoading && user) void verify()
  }, [authLoading, user, verify])

  useEffect(() => {
    if (stage !== "processing" || attempts >= 6 || checking || !user) return
    const timer = window.setTimeout(() => {
      setAttempts((current) => current + 1)
      void verify()
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [attempts, checking, stage, user, verify])

  useEffect(() => {
    if (stage !== "printing") return
    const timer = window.setTimeout(() => {
      setStage("complete")
      onComplete()
    }, reduceMotion ? 0 : 950)
    return () => window.clearTimeout(timer)
  }, [onComplete, reduceMotion, stage])

  const dateLabel = receipt
    ? new Date(receipt.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Verifying payment"

  return (
    <section className="mx-auto w-full max-w-md space-y-4 py-4" aria-label="Premium checkout receipt">
      <div className="space-y-1 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">LOOP · CHECKOUT</p>
        <h1 className="text-2xl font-bold tracking-tight">Your Pro receipt</h1>
        <p className="text-sm text-muted-foreground">We verify your subscription before marking the order complete.</p>
      </div>

      <div className="relative overflow-hidden rounded-[28px] border border-zinc-700 bg-gradient-to-b from-zinc-700 to-zinc-950 p-4 text-zinc-50 shadow-2xl">
        <div className="mb-4 flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/10"><Printer className="h-4 w-4" /></span>
            <span className="text-xs font-semibold tracking-[0.16em]">LOOP PRINT</span>
          </div>
          <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] uppercase tracking-wider text-white/65">Digital receipt</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/70 p-3 shadow-inner">
          <div className="flex items-center gap-2">
            {stage === "complete"
              ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              : <Loader2 className="h-4 w-4 animate-spin text-amber-300 motion-reduce:animate-none" />}
            <span className="text-xs font-medium" aria-live="polite">
              {stage === "complete" ? "Receipt printed · Subscription active" : stage === "printing" ? "Printing your receipt…" : "Processing your subscription…"}
            </span>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full bg-emerald-400"
              initial={false}
              animate={{ width: stage === "complete" ? "100%" : stage === "printing" ? "78%" : "32%" }}
              transition={{ duration: reduceMotion ? 0 : 0.65 }}
            />
          </div>
        </div>

        <div className="relative mx-auto -mt-1 h-[330px] max-w-[310px] overflow-hidden px-3">
          <motion.article
            className="relative min-h-[310px] bg-[#faf8f1] px-5 pb-6 pt-6 font-mono text-[11px] text-zinc-900 shadow-xl"
            style={{ clipPath: "polygon(0 0,100% 0,100% 98%,98% 100%,96% 98%,94% 100%,92% 98%,90% 100%,88% 98%,86% 100%,84% 98%,82% 100%,80% 98%,78% 100%,76% 98%,74% 100%,72% 98%,70% 100%,68% 98%,66% 100%,64% 98%,62% 100%,60% 98%,58% 100%,56% 98%,54% 100%,52% 98%,50% 100%,48% 98%,46% 100%,44% 98%,42% 100%,40% 98%,38% 100%,36% 98%,34% 100%,32% 98%,30% 100%,28% 98%,26% 100%,24% 98%,22% 100%,20% 98%,18% 100%,16% 98%,14% 100%,12% 98%,10% 100%,8% 98%,6% 100%,4% 98%,2% 100%,0 98%)" }}
            initial={false}
            animate={{ y: stage === "processing" ? -320 : 0, opacity: stage === "processing" ? 0.25 : 1 }}
            transition={{ duration: reduceMotion ? 0 : stage === "printing" ? 0.95 : 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="text-center">
              <p className="text-[10px] font-bold tracking-[0.28em]">LOOP</p>
              <h2 className="mt-1 text-lg font-black tracking-tight">PRO MEMBERSHIP</h2>
              <p className="mt-1 text-[9px] tracking-[0.16em] text-zinc-500">SUBSCRIPTION RECEIPT</p>
            </div>
            <div className="my-4 border-t border-dashed border-zinc-400" />
            <div className="space-y-2">
              <div className="flex justify-between gap-3"><span>ITEM</span><span className="text-right">{receipt?.plan || "Loop Pro"}</span></div>
              <div className="flex justify-between gap-3"><span>ORDER</span><span>{receipt?.order_number || "VERIFYING"}</span></div>
              <div className="flex justify-between gap-3"><span>DATE</span><span>{dateLabel}</span></div>
              <div className="flex justify-between gap-3"><span>BILLING</span><span>Recurring</span></div>
            </div>
            <div className="my-4 border-t border-dashed border-zinc-400" />
            <div className="flex items-end justify-between">
              <span className="font-bold">TOTAL PAID</span>
              <strong className="text-lg">{receipt ? formatAmount(receipt.amount_total, receipt.currency) : "—"}</strong>
            </div>
            {receipt?.current_period_end ? (
              <p className="mt-2 text-[10px] text-zinc-600">
                Current period ends {new Date(receipt.current_period_end).toLocaleDateString()}
              </p>
            ) : null}
            <div className="my-4 border-t border-dashed border-zinc-400" />
            <p className="text-center text-[9px] leading-relaxed text-zinc-500">Thank you for being part of LOOP.</p>
            <div className="mt-4 flex h-8 items-end justify-center gap-[2px]" aria-hidden="true">
              {Array.from({ length: 43 }, (_, index) => (
                <span key={index} className="bg-zinc-900" style={{ width: index % 4 === 0 ? 3 : 1, height: 9 + ((index * 7) % 22) }} />
              ))}
            </div>
          </motion.article>
        </div>
      </div>

      {error ? <p role="alert" className="text-center text-sm text-destructive">{error}</p> : null}
      {stage === "complete" ? (
        <div className="space-y-3 text-center">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Your recurring Pro subscription is active.</p>
          <Button onClick={onClose} className="w-full">Continue to LOOP Pro</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {attempts >= 6 ? <p className="text-center text-xs text-muted-foreground">Still waiting for Stripe confirmation. You can safely check again; payment is never duplicated by this screen.</p> : null}
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => void verify()} disabled={checking || authLoading || !user}>
              <RotateCw className="mr-2 h-4 w-4" /> {checking ? "Checking…" : "Check payment status"}
            </Button>
            <Button variant="ghost" onClick={onClose}>Return to Premium</Button>
          </div>
        </div>
      )}
    </section>
  )
}

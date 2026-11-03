"use client"

import { Suspense, useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { VideoAvatar } from "@/components/cosmetics/video-avatar"
import { Coins, ArrowDownLeft, ArrowUpRight, Gift, PlusCircle, CreditCard, ShieldCheck, RefreshCw, History, Zap, Check, Package, User, Heart, DollarSign, Building2, Wallet as WalletIcon, AlertCircle, RotateCcw, Target } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { TransactionFilter } from "@/components/wallet/transaction-filter"
import { Spinner } from "@/components/ui/skeletons"
import { VerifiedSeal } from "@/components/ui/verified-seal"

interface Transaction {
  id: string
  amount_usd: number
  coins_amount: number
  type: string
  description: string
  status: string
  payment_method?: string
  created_at: string
}

interface CoinGift {
  id: string
  sender_id: string
  sender_username: string
  sender_name: string
  sender_avatar: string
  receiver_id: string
  receiver_username: string
  coins_amount: number
  gift_name: string
  gift_icon: string
  message?: string
  created_at: string
}

interface InventoryItem {
  id: string
  item_id: string
  item_name: string
  item_type: string
  acquired_at: string
}

interface WithdrawalRequest {
  id: string
  coins_amount: number
  estimated_usd: number
  payout_method: string
  status: string
  created_at: string
}

interface CoinPackage {
  id: string
  name: string
  price_usd: number
  item_data?: { coins_amount?: number; bonus?: number }
}

export default function WalletPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-background">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      }
    >
      <WalletContent />
    </Suspense>
  )
}

function WalletContent() {
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [balance, setBalance] = useState<number>(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [receivedGifts, setReceivedGifts] = useState<CoinGift[]>([])
  const [sentGifts, setSentGifts] = useState<CoinGift[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [withdrawalRequests, setWithdrawalRequests] = useState<WithdrawalRequest[]>([])
  const [loading, setLoading] = useState(true)

  // Deposit Modal State
  const [depositOpen, setDepositOpen] = useState(false)
  const [coinPackages, setCoinPackages] = useState<CoinPackage[]>([])
  const [packagesLoading, setPackagesLoading] = useState(false)
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null)
  const [depositing, setDepositing] = useState(false)

  // Gift Modal State
  const [giftOpen, setGiftOpen] = useState(false)
  const [targetUsername, setTargetUsername] = useState("")
  const [giftAmount, setGiftAmount] = useState<number>(100)
  const [giftMessage, setGiftMessage] = useState("")
  const [gifting, setGifting] = useState(false)

  // Withdrawal Modal State
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawCoins, setWithdrawCoins] = useState<number>(1000)
  const [payoutMethod, setPayoutMethod] = useState("bank")
  const [payoutDetails, setPayoutDetails] = useState("")
  const [withdrawalRequestKey, setWithdrawalRequestKey] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  // Refund flow — request a refund for a recent Stripe purchase
  const [refundRequests, setRefundRequests] = useState<any[]>([])
  const [refundTx, setRefundTx] = useState<Transaction | null>(null)
  const [refundReason, setRefundReason] = useState("")
  const [refunding, setRefunding] = useState(false)

  const [activeTab, setActiveTab] = useState("transactions")

  useEffect(() => {
    const tab = searchParams?.get("tab")
    if (tab && ["transactions", "gifts", "inventory", "withdrawals"].includes(tab)) {
      setActiveTab(tab)
    }
  }, [searchParams])

  useEffect(() => {
    fetchWalletData()
    fetchGiftsAndInventory()
    fetchWithdrawalRequests()
    fetchRefundRequests()

    if (!user?.id) return

    // Supabase Real-Time Subscriptions for Wallet
    const channel = supabase
      .channel(`wallet_realtime_${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${user.id}` },
        () => {
          fetchWalletData()
          toast({ title: "Real-time Update ⚡", description: "Your wallet transaction history updated!" })
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "refund_requests", filter: `user_id=eq.${user.id}` },
        () => {
          fetchRefundRequests()
          toast({ title: "Refund update", description: "Your refund request status changed." })
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "coin_gifts", filter: `receiver_id=eq.${user.id}` },
        (payload) => {
          fetchWalletData()
          fetchGiftsAndInventory()
          const gift = payload.new as any
          toast({
            title: "Gift Received! 🎁",
            description: `Received ${gift.coins_amount} Loop Coins from @${gift.sender_username || "a supporter"}!`,
          })
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "withdrawal_requests", filter: `user_id=eq.${user.id}` },
        () => {
          fetchWithdrawalRequests()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  useEffect(() => {
    const checkoutStatus = searchParams?.get("checkout")
    if (!checkoutStatus) return

    if (checkoutStatus === "success") {
      toast({
        title: "Payment received! 🎉",
        description: "Your Loop Coins are on the way — this updates within a few seconds.",
      })
      // Stripe credits coins via webhook; poll briefly so the balance updates without a manual refresh.
      fetchWalletData()
      const retry = window.setTimeout(fetchWalletData, 3000)
      router.replace("/wallet")
      return () => window.clearTimeout(retry)
    }

    if (checkoutStatus === "cancelled") {
      toast({
        title: "Checkout cancelled",
        description: "No charge was made. You can try again anytime.",
      })
      router.replace("/wallet")
    }
  }, [searchParams])

  const fetchCoinPackages = async () => {
    setPackagesLoading(true)
    try {
      const res = await fetch("/api/shop/items?category=coins")
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          const packs: CoinPackage[] = data.items || []
          setCoinPackages(packs)
          if (packs.length > 0) setSelectedPkgId((prev) => prev ?? packs[0].id)
        }
      }
    } catch (err) {
      console.error("Failed to load coin packages:", err)
    } finally {
      setPackagesLoading(false)
    }
  }

  const fetchWalletData = async () => {
    setLoading(true)
    try {
      const token = user?.access_token
      const res = await fetch("/api/wallet/transactions", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          setBalance(data.balance ?? 0)
          setTransactions(data.transactions || [])
        }
      }
    } catch (err) {
      console.error("Failed to load wallet data:", err)
    } finally {
      setLoading(false)
    }
  }

  const fetchRefundRequests = async () => {
    try {
      const token = user?.access_token
      const res = await fetch("/api/payments/refund", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success) setRefundRequests(data.requests || [])
      }
    } catch (err) {
      console.error("Failed to load refund requests:", err)
    }
  }

  const handleSubmitRefund = async () => {
    if (!refundTx) return
    setRefunding(true)
    try {
      const token = user?.access_token
      const res = await fetch("/api/payments/refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ wallet_tx_id: refundTx.id, reason: refundReason }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast({ title: "Refund requested", description: data.message })
        setRefundTx(null)
        setRefundReason("")
        await fetchRefundRequests()
      } else {
        toast({ title: "Couldn't request refund", description: data.error || "Please try again.", variant: "destructive" })
      }
    } catch (err) {
      console.error("Refund request error:", err)
      toast({ title: "Error", description: "Failed to submit refund request", variant: "destructive" })
    } finally {
      setRefunding(false)
    }
  }

  const refundStatusForTx = (txId: string) => {
    return refundRequests.find((r) => r.wallet_tx_id === txId) || null
  }

  const canRequestRefund = (tx: Transaction) => {
    if (tx.payment_method !== "stripe" || tx.status !== "completed") return false
    if (!["deposit", "premium_purchase", "shop_purchase"].includes(tx.type)) return false
    const ageDays = (Date.now() - new Date(tx.created_at).getTime()) / (24 * 60 * 60 * 1000)
    if (ageDays > 14) return false
    const req = refundStatusForTx(tx.id)
    if (req && ["pending", "approved"].includes(req.status)) return false
    return true
  }

  const fetchGiftsAndInventory = async () => {
    try {
      const token = user?.access_token
      const res = await fetch("/api/wallet/gifts-history", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          setReceivedGifts(data.received || [])
          setSentGifts(data.sent || [])
          setInventory(data.inventory || [])
        }
      }
    } catch (err) {
      console.error("Failed to load gifts history:", err)
    }
  }

  const fetchWithdrawalRequests = async () => {
    try {
      const token = user?.access_token
      const res = await fetch("/api/wallet/withdraw", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          setWithdrawalRequests(data.requests || [])
        }
      }
    } catch (err) {
      console.error("Failed to load withdrawal requests:", err)
    }
  }

  const handleRequestWithdrawal = async () => {
    if (withdrawCoins < 500) {
      toast({ title: "Minimum Threshold", description: "Minimum cashout pre-order is 500 Loop Coins ($5.00 USD).", variant: "destructive" })
      return
    }
    if (withdrawCoins > balance) {
      toast({ title: "Insufficient Balance", description: "Withdrawal amount exceeds your current Loop Coin balance.", variant: "destructive" })
      return
    }
    if (!payoutDetails.trim() || payoutDetails.trim().length > 1000) {
      toast({ title: "Payout details required", description: "Enter the bank account, PayPal email or crypto wallet details for this request.", variant: "destructive" })
      return
    }

    const requestKey = withdrawalRequestKey || crypto.randomUUID()
    setWithdrawalRequestKey(requestKey)
    setWithdrawing(true)
    try {
      const token = user?.access_token
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          coins_amount: withdrawCoins,
          payout_method: payoutMethod,
          payout_details: payoutDetails.trim(),
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        toast({
          title: "Payout Requested 💵",
          description: data.message,
        })
        setWithdrawOpen(false)
        setWithdrawalRequestKey(null)
        setPayoutDetails("")
        fetchWithdrawalRequests()
        fetchWalletData()
      } else {
        toast({
          title: "Couldn't submit request",
          description: data.error || "Please try again in a moment.",
          variant: "destructive",
        })
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to submit payout request", variant: "destructive" })
    } finally {
      setWithdrawing(false)
    }
  }

  const handleDeposit = async () => {
    if (!selectedPkgId) {
      toast({ title: "Choose a pack", description: "Select a Loop Coin pack to continue.", variant: "destructive" })
      return
    }

    setDepositing(true)
    try {
      const token = user?.access_token
      const res = await fetch("/api/shop/purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          item_id: selectedPkgId,
          payment_method: "stripe",
        }),
      })

      const data = await res.json()
      if (res.ok && data.success && data.checkout_url) {
        // Redirect to Stripe Checkout. Coins are credited by the webhook once
        // payment actually succeeds — never before.
        window.location.href = data.checkout_url
      } else {
        toast({
          title: "Checkout Failed",
          description: data.error || "Could not start checkout",
          variant: "destructive",
        })
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      })
    } finally {
      setDepositing(false)
    }
  }

  const handleSendGift = async () => {
    if (!targetUsername.trim()) {
      toast({ title: "Error", description: "Please enter a valid target username", variant: "destructive" })
      return
    }
    if (giftAmount <= 0) {
      toast({ title: "Error", description: "Please enter a positive coin amount", variant: "destructive" })
      return
    }
    if (giftAmount > balance) {
      toast({ title: "Insufficient Coins", description: "You do not have enough coins in your vault.", variant: "destructive" })
      return
    }

    setGifting(true)
    try {
      const token = user?.access_token
      const res = await fetch("/api/wallet/gift", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          target_username: targetUsername,
          coins_amount: giftAmount,
          gift_name: "Loop Coin Transfer",
          message: giftMessage,
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setBalance(data.newBalance)
        setGiftOpen(false)
        setTargetUsername("")
        setGiftMessage("")
        fetchWalletData()
        fetchGiftsAndInventory()
        toast({
          title: "Gift Sent! 🎁",
          description: `Sent ${giftAmount.toLocaleString()} Loop Coins to @${targetUsername.replace("@", "")}!`,
        })
      } else {
        toast({
          title: "Gifting Failed",
          description: data.error || "Could not send gift",
          variant: "destructive",
        })
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      })
    } finally {
      setGifting(false)
    }
  }

  const handleUseItem = async (itemId: string, itemName: string) => {
    try {
      const token = user?.access_token
      const res = await fetch("/api/wallet/inventory/use", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ itemId }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        toast({
          title: "Item Equipped",
          description: data.message,
        })
      }
    } catch (err) {
      toast({ title: "Error", description: "Could not equip item", variant: "destructive" })
    }
  }

  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([])

  return (
    <div className="container max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2.5">
            <Coins className="w-7 h-7 text-yellow-500 shrink-0" />
            Wallet & Vault
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your Loop Coin balance, purchase top-ups, and track transaction history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchWalletData}
            disabled={loading}
            className="rounded-lg text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            asChild
            variant="secondary"
            size="sm"
            className="rounded-lg text-xs font-medium"
          >
            <Link href="/quests" className="inline-flex items-center">
              <Target className="w-3.5 h-3.5 mr-1.5 text-violet-400" />
              Quests
            </Link>
          </Button>
          <Button
            asChild
            variant="secondary"
            size="sm"
            className="rounded-lg text-xs font-medium"
          >
            <Link href="/shop">Shop & Perks</Link>
          </Button>
        </div>
      </div>

      {/* Main Grid: Balance Card + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Balance Card */}
        <Card className="lg:col-span-2 relative overflow-hidden border-border/60 bg-gradient-to-br from-indigo-950/40 via-background to-cyan-950/30 shadow-xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="border-yellow-500/40 text-yellow-500 bg-yellow-500/10 px-2.5 py-0.5 text-xs">
                Active Vault
              </Badge>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Secure Wallet
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Total Balance</p>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
                  {balance.toLocaleString()}
                </span>
                <span className="text-base sm:text-lg font-semibold text-yellow-500 flex items-center gap-1">
                  <Coins className="w-5 h-5" /> Loop Coins
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Estimated value: ${(balance * 0.01).toFixed(2)} USD
              </p>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                onClick={() => {
                  setDepositOpen(true)
                  fetchCoinPackages()
                }}
                className="rounded-xl px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white shadow-md shadow-indigo-600/20 font-semibold text-sm"
              >
                <PlusCircle className="w-4 h-4 mr-2" />
                Deposit Coins
              </Button>
              <Button
                variant="outline"
                onClick={() => setGiftOpen(true)}
                className="rounded-xl px-4 py-2.5 border-border/80 hover:bg-muted text-sm font-semibold"
              >
                <Gift className="w-4 h-4 mr-2 text-rose-500" />
                Send Gift
              </Button>
              <Button
                variant="outline"
                onClick={() => setWithdrawOpen(true)}
                className="rounded-xl px-4 py-2.5 border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-500 font-semibold text-sm flex items-center gap-2"
              >
                <DollarSign className="w-4 h-4" />
                Withdraw Cash
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0 font-bold">
                  Verified Creators
                </Badge>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Vault Stats Sidebar */}
        <Card className="border-border/60 bg-card/60 shadow-sm flex flex-col justify-between p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-500" />
              Vault Privileges
            </h3>
            <ul className="mt-3 space-y-2.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>Unlock exclusive cosmetics & profile themes in the Shop.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>Tip live stream hosts & community circle creators.</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <span>0% fee creator cashout pre-registration for verified accounts.</span>
              </li>
            </ul>
          </div>
          <div className="pt-3 border-t border-border/50 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Verified Creator Status</span>
            <Badge variant="secondary" className="font-semibold bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
              {user?.is_verified ? "Verified Creator" : "Verification Eligible"}
            </Badge>
          </div>
        </Card>
      </div>

      {/* Multi-Tab Main Content Section */}
      <Card className="border-border/60 bg-card/80 shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-border/40">
            <div>
              <CardTitle className="text-lg font-bold flex items-center gap-2">
                {activeTab === "transactions" && <History className="w-5 h-5 text-indigo-500" />}
                {activeTab === "gifts" && <Gift className="w-5 h-5 text-rose-500" />}
                {activeTab === "inventory" && <Package className="w-5 h-5 text-amber-500" />}
                {activeTab === "withdrawals" && <DollarSign className="w-5 h-5 text-emerald-500" />}
                {activeTab === "transactions" && "Recent Transactions"}
                {activeTab === "gifts" && "Received & Sent Gifts"}
                {activeTab === "inventory" && "Vault Inventory & Cosmetics"}
                {activeTab === "withdrawals" && "Creator Cashouts & Payouts"}
              </CardTitle>
              <CardDescription className="text-xs">
                {activeTab === "transactions" && "Audit log of all deposits, gifts, purchases, and rewards."}
                {activeTab === "gifts" && "Gifts received from community members and sent transfers."}
                {activeTab === "inventory" && "Equip custom profile themes, badges, and redeemed perks."}
                {activeTab === "withdrawals" && "Requests are reviewed manually by our team — coins are reserved once you submit a request."}
              </CardDescription>
            </div>

            <TabsList className="grid grid-cols-4 h-9 text-xs bg-muted/70 p-1 rounded-xl sm:w-96">
              <TabsTrigger value="transactions" className="rounded-lg px-2 py-1 text-xs font-semibold">
                Ledger
              </TabsTrigger>
              <TabsTrigger value="gifts" className="rounded-lg px-2 py-1 text-xs font-semibold">
                Gifts ({receivedGifts.length})
              </TabsTrigger>
              <TabsTrigger value="inventory" className="rounded-lg px-2 py-1 text-xs font-semibold">
                Inventory
              </TabsTrigger>
              <TabsTrigger value="withdrawals" className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-400">
                Cashouts ⚡
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          <CardContent className="pt-4">
            {/* Tab 1: Transactions */}
            <TabsContent value="transactions" className="m-0 space-y-4">
              {/* Advanced Transaction Filter */}
              <TransactionFilter
                transactions={transactions}
                onFiltered={(filtered) => setFilteredTransactions(filtered as Transaction[])}
              />

              {loading ? (
                <div className="py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                  Loading transaction ledger...
                </div>
              ) : filteredTransactions.length === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <Coins className="w-10 h-10 mx-auto text-muted-foreground/40" />
                  <p className="text-sm font-medium text-muted-foreground">No transactions recorded yet</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDepositOpen(true)
                      fetchCoinPackages()
                    }}
                    className="rounded-full text-xs"
                  >
                    Make your first deposit
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {filteredTransactions.map((tx) => {
                    const isPositive = tx.coins_amount > 0
                    return (
                      <div key={tx.id} className="py-3.5 flex items-center justify-between gap-4 text-sm hover:bg-muted/30 px-2 rounded-lg transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`p-2.5 rounded-xl shrink-0 ${isPositive ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"}`}>
                            {isPositive ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground truncate">{tx.description || tx.type}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(tx.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                            </p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p className={`font-bold tracking-tight ${isPositive ? "text-emerald-500" : "text-rose-500"}`}>
                            {isPositive ? `+${tx.coins_amount.toLocaleString()}` : `${tx.coins_amount.toLocaleString()}`} Coins
                          </p>
                          <div className="flex items-center justify-end gap-1.5">
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 uppercase">
                              {tx.status}
                            </Badge>
                            {refundStatusForTx(tx.id) && (
                              <Badge
                                className={`text-[10px] px-1.5 py-0 uppercase ${
                                  refundStatusForTx(tx.id).status === "approved"
                                    ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
                                    : refundStatusForTx(tx.id).status === "rejected"
                                      ? "bg-rose-500/10 text-rose-500 border border-rose-500/30"
                                      : "bg-amber-500/15 text-amber-600 border border-amber-500/30"
                                }`}
                              >
                                {refundStatusForTx(tx.id).status}
                              </Badge>
                            )}
                          </div>
                          {canRequestRefund(tx) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRefundTx(tx)}
                              className="mt-1.5 h-7 rounded-full px-2.5 text-[11px] text-amber-600 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400"
                            >
                              <RotateCcw className="mr-1 h-3 w-3" />
                              Request refund
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </TabsContent>

            {/* Tab 2: Received & Sent Gifts */}
            <TabsContent value="gifts" className="m-0 space-y-4">
              <div className="space-y-4">
                <h4 className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Gift className="w-3.5 h-3.5 text-rose-500" />
                  Received Gifts
                </h4>

                {receivedGifts.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground bg-muted/20 rounded-xl">
                    No received gifts yet. When users send you Loop Coins or gifts, they will appear here!
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {receivedGifts.map((gift) => (
                      <div key={gift.id} className="p-3.5 rounded-xl border border-border/50 bg-card/60 flex items-start gap-3 shadow-xs">
                        <Avatar className="w-9 h-9 border border-border">
                          <AvatarImage src={gift.sender_avatar} />
                          <AvatarFallback>{gift.sender_username?.charAt(0) || "U"}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold text-foreground truncate">
                              @{gift.sender_username}
                            </p>
                            <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-[10px] px-1.5 py-0">
                              +{gift.coins_amount} Coins
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{gift.gift_name}</p>
                          {gift.message && (
                            <p className="text-[11px] text-muted-foreground/90 italic mt-1 bg-muted/40 p-1.5 rounded-md border border-border/30">
                              "{gift.message}"
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-1.5">
                            {new Date(gift.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Tab 4: Withdrawals */}
            <TabsContent value="withdrawals" className="m-0 space-y-4">
              <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/30 via-background to-teal-950/20 border border-emerald-500/30 space-y-4 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-xs px-2.5 py-0.5">
                        ⚡ Verified Creator Cashouts
                      </Badge>
                      <Badge variant="outline" className="border-sky-500/40 text-sky-400 text-[10px] px-2 py-0">
                        Manually Reviewed
                      </Badge>
                    </div>
                    <h3 className="text-lg font-bold text-foreground mt-2">Withdraw Earnings & Payouts</h3>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                      Request a real cashout of your Loop Coins to your bank account, PayPal, or Stripe. Coins are
                      reserved as soon as you submit, and our team reviews and pays out requests manually within a
                      few business days. No platform fee right now.
                    </p>
                  </div>

                  <Button
                    onClick={() => setWithdrawOpen(true)}
                    className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs shrink-0 px-4 py-2"
                  >
                    <DollarSign className="w-4 h-4 mr-1.5" />
                    Request Payout
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                  <div className="p-3 rounded-xl bg-card/60 border border-border/50 text-xs space-y-1">
                    <p className="text-muted-foreground font-semibold">Minimum Threshold</p>
                    <p className="text-base font-bold text-foreground">500 Loop Coins ($5.00)</p>
                  </div>
                  <div className="p-3 rounded-xl bg-card/60 border border-border/50 text-xs space-y-1">
                    <p className="text-muted-foreground font-semibold">Creator Platform Fee</p>
                    <p className="text-base font-bold text-emerald-500">0% (for now)</p>
                  </div>
                  <div className="p-3 rounded-xl bg-card/60 border border-border/50 text-xs space-y-1">
                    <p className="text-muted-foreground font-semibold">Estimated Cash Value</p>
                    <p className="text-base font-bold text-foreground">${(balance * 0.01).toFixed(2)} USD</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-emerald-500" />
                  Your Payout Requests
                </h4>

                {withdrawalRequests.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground bg-muted/20 rounded-xl">
                    No payout requests yet. Submit your first request above!
                  </div>
                ) : (
                  <div className="divide-y divide-border/40 border border-border/50 rounded-xl overflow-hidden bg-card/50">
                    {withdrawalRequests.map((req) => (
                      <div key={req.id} className="p-3.5 flex items-center justify-between gap-4 text-xs">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500">
                            <DollarSign className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-bold text-foreground">{req.coins_amount.toLocaleString()} Loop Coins → ${req.estimated_usd} USD</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Method: {req.payout_method.toUpperCase()}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/10 text-[10px] px-2 py-0 uppercase">
                            {req.status.replace(/_/g, " ")}
                          </Badge>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {new Date(req.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>

      {/* Deposit Modal */}
      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-4 sm:p-6 max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-indigo-500 shrink-0" />
              Deposit Loop Coins
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select a coin package to securely pay with card via Stripe Checkout.
            </DialogDescription>
          </DialogHeader>

          {packagesLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-primary" />
              Loading coin packs...
            </div>
          ) : coinPackages.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No coin packs are available right now. Please check back soon.
            </div>
          ) : (
            <div className="grid grid-cols-1 xs:grid-cols-2 gap-2.5 sm:gap-3 py-4">
              {coinPackages.map((pkg, idx) => {
                const selected = selectedPkgId === pkg.id
                const coinsAmount = Number(pkg.item_data?.coins_amount || 0)
                const bonus = Number(pkg.item_data?.bonus || 0)
                return (
                  <div
                    key={pkg.id}
                    onClick={() => setSelectedPkgId(pkg.id)}
                    className={`cursor-pointer rounded-xl border p-3 sm:p-4 transition-all relative ${
                      selected
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border/60 hover:border-border bg-card"
                    }`}
                  >
                    {idx === 1 && (
                      <Badge className="absolute -top-2.5 right-3 bg-gradient-to-r from-indigo-500 to-cyan-500 text-white text-[10px] px-2 py-0">
                        Most Popular
                      </Badge>
                    )}
                    <p className="text-xs text-muted-foreground font-medium truncate">{pkg.name}</p>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-xl font-extrabold">{(coinsAmount + bonus).toLocaleString()}</span>
                      <span className="text-xs text-yellow-500 font-semibold">Coins</span>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40 text-xs">
                      <span className="font-bold text-foreground">${pkg.price_usd}</span>
                      {bonus > 0 && <span className="text-emerald-500 font-medium">+{bonus.toLocaleString()} bonus</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-0">
            <Button variant="outline" onClick={() => setDepositOpen(false)} className="rounded-xl w-full sm:w-auto">
              Cancel
            </Button>
            <Button
              onClick={handleDeposit}
              disabled={depositing || !selectedPkgId}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-semibold w-full sm:w-auto"
            >
              {depositing
                ? "Redirecting to checkout..."
                : selectedPkgId
                  ? `Pay $${coinPackages.find((p) => p.id === selectedPkgId)?.price_usd ?? ""} with Stripe`
                  : "Select a pack"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Gift Modal */}
      <Dialog open={giftOpen} onOpenChange={setGiftOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Gift className="w-5 h-5 text-rose-500" />
              Gift Coins to User
            </DialogTitle>
            <DialogDescription className="text-xs">
              Transfer Loop Coins directly to another user by entering their handle.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="target-username" className="text-xs font-semibold">Recipient Handle</Label>
              <div className="relative mt-1.5">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">@</span>
                <Input
                  id="target-username"
                  placeholder="username"
                  value={targetUsername}
                  onChange={(e) => setTargetUsername(e.target.value)}
                  className="pl-8 rounded-xl"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="gift-amount" className="text-xs font-semibold">Coin Amount</Label>
              <Input
                id="gift-amount"
                type="number"
                min={10}
                max={balance}
                value={giftAmount}
                onChange={(e) => setGiftAmount(Number(e.target.value))}
                className="mt-1.5 rounded-xl"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Current Balance: {balance.toLocaleString()} coins</p>
            </div>

            <div>
              <Label htmlFor="gift-msg" className="text-xs font-semibold">Optional Message</Label>
              <Input
                id="gift-msg"
                placeholder="Thanks for the awesome loop!"
                value={giftMessage}
                onChange={(e) => setGiftMessage(e.target.value)}
                className="mt-1.5 rounded-xl"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setGiftOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={handleSendGift}
              disabled={gifting}
              className="rounded-xl bg-gradient-to-r from-rose-500 to-violet-600 hover:from-rose-600 hover:to-violet-700 text-white font-semibold"
            >
              {gifting ? "Sending..." : `Send ${giftAmount.toLocaleString()} Coins`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Withdrawal / Payout Request Modal */}
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-500" />
              Request Payout
            </DialogTitle>
            <DialogDescription className="text-xs">
              Submit a real cashout request. Coins are reserved immediately and our team reviews requests manually.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-2.5 text-xs">
              <AlertCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-emerald-400">Verified Creator Privilege</p>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  100 coins = $1.00 USD. Minimum cashout threshold is 500 coins ($5.00 USD).
                </p>
              </div>
            </div>

            <div>
              <Label htmlFor="withdraw-coins" className="text-xs font-semibold">Coins to Cash Out</Label>
              <Input
                id="withdraw-coins"
                type="number"
                min={500}
                max={balance}
                step={100}
                value={withdrawCoins}
                onChange={(e) => { setWithdrawCoins(Number(e.target.value)); setWithdrawalRequestKey(null) }}
                className="mt-1.5 rounded-xl font-bold text-foreground"
              />
              <p className="text-[11px] text-muted-foreground mt-1 flex justify-between">
                <span>Estimated payout value:</span>
                <span className="font-bold text-emerald-400">${(withdrawCoins * 0.01).toFixed(2)} USD</span>
              </p>
            </div>

            <div>
              <Label htmlFor="payout-method" className="text-xs font-semibold">Payout Destination</Label>
              <select
                id="payout-method"
                value={payoutMethod}
                onChange={(e) => { setPayoutMethod(e.target.value); setWithdrawalRequestKey(null) }}
                className="w-full mt-1.5 rounded-xl border border-border bg-background p-2.5 text-xs font-medium"
              >
                <option value="bank">Direct Bank Transfer (ACH / SEPA)</option>
                <option value="paypal">PayPal Account</option>
                <option value="crypto">Crypto Wallet</option>
              </select>
            </div>

            <div>
              <Label htmlFor="payout-details" className="text-xs font-semibold">Account Details / Email</Label>
              <Input
                id="payout-details"
                placeholder="Enter your IBAN, PayPal email or wallet address"
                value={payoutDetails}
                required
                maxLength={1000}
                onChange={(e) => { setPayoutDetails(e.target.value); setWithdrawalRequestKey(null) }}
                className="mt-1.5 rounded-xl text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setWithdrawOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={handleRequestWithdrawal}
              disabled={withdrawing || !payoutDetails.trim() || withdrawCoins < 500 || withdrawCoins > balance}
              className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold"
            >
              {withdrawing ? "Submitting..." : `Request $${(withdrawCoins * 0.01).toFixed(2)} Payout`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund request dialog */}
      <Dialog open={Boolean(refundTx)} onOpenChange={(open) => { if (!open) { setRefundTx(null); setRefundReason("") } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-500" />
              Request a refund
            </DialogTitle>
            <DialogDescription>
              {refundTx && (
                <>
                  Refund <span className="font-semibold text-foreground">${Number(refundTx.amount_usd || 0).toFixed(2)}</span> for "{refundTx.description}"? Refunds are reviewed within 2–3 business days and returned to your original payment method.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="refund-reason" className="text-xs font-semibold">Reason (optional)</Label>
              <textarea
                id="refund-reason"
                rows={3}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g. accidental purchase, didn't receive coins…"
                className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              Only purchases made within the last 14 days with a card are eligible. Read our{" "}
              <Link href="/terms#refund-policy" className="font-medium text-primary underline">refund policy</Link>.
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setRefundTx(null); setRefundReason("") }} className="rounded-xl">
              Cancel
            </Button>
            <Button
              onClick={() => void handleSubmitRefund()}
              disabled={refunding}
              className="rounded-xl bg-amber-500 text-white hover:bg-amber-400"
            >
              {refunding ? <Spinner className="mr-2 h-4 w-4" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Submit refund request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

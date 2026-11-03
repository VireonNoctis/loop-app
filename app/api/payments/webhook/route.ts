import { type NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createServerClient } from "@/lib/supabase"
import { notifyUser } from "@/lib/notifications"
import { syncStripePremiumSubscription } from "@/lib/stripe-premium-subscriptions"
import { grantStripePremiumCheckout } from "@/lib/stripe-premium-grants"

export async function POST(request: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes("your_stripe_secret_key")) {
      const status = process.env.NODE_ENV === "production" ? 503 : 200
      return NextResponse.json(
        { received: false, message: "Stripe is not configured" },
        { status },
      )
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Always use the API version pinned by the installed stripe package.
      apiVersion: Stripe.API_VERSION,
    })

    const body = await request.text()
    const signature = request.headers.get("stripe-signature")

    if (!signature) {
      return NextResponse.json({ error: "No signature provided" }, { status: 400 })
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET.includes("your_webhook_secret")) {
      const status = process.env.NODE_ENV === "production" ? 503 : 400
      return NextResponse.json(
        { error: "Stripe webhook secret is not configured" },
        { status },
      )
    }

    const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET)
    const supabase = createServerClient()

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any
        const metadata = session.metadata || {}

        if (metadata.kind === "premium_subscription" && metadata.user_id) {
          if (!["paid", "no_payment_required"].includes(session.payment_status)) break
          const subscriptionValue = session.subscription as string | Stripe.Subscription | null
          if (!subscriptionValue) break
          const subscription = typeof subscriptionValue === "string"
            ? await stripe.subscriptions.retrieve(subscriptionValue)
            : subscriptionValue
          await syncStripePremiumSubscription(supabase, subscription)
          break
        }

        if (metadata.kind === "premium" && metadata.user_id) {
          if (session.payment_status !== "paid") {
            console.warn(`Premium checkout ${session.id} completed but payment_status=${session.payment_status}`)
            break
          }

          const userId = String(metadata.user_id)
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          if (!uuidPattern.test(userId)) {
            console.error(`Premium checkout ${session.id} contains an invalid account reference`)
            break
          }

          const requestedDays = Number(metadata.plan_days)
          const days = Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 3660
            ? requestedDays
            : 30
          const transactionId = `stripe_${session.id}`
          const amountUsd = typeof session.amount_total === "number" ? session.amount_total / 100 : 0
          const paymentIntentId = typeof session.payment_intent === "string"
            ? session.payment_intent
            : null

          // The SQL function locks the account and commits the entitlement
          // with the unique transaction row, so concurrent webhook retries
          // cannot extend Pro more than once for this Checkout Session.
          const grant = await grantStripePremiumCheckout(supabase, {
            userId,
            transactionId,
            days,
            amountUsd,
            paymentIntentId,
            plan: typeof metadata.plan === "string" ? metadata.plan : null,
          })

          if (!grant.already_processed) {
            try {
              await notifyUser(supabase, {
                userId,
                type: "system",
                title: "Welcome to Loop Pro! 👑",
                message: `Your Pro membership is active until ${new Date(grant.premium_expires_at).toLocaleDateString()}.`,
                data: { plan: metadata.plan, premium_expires_at: grant.premium_expires_at },
                actionUrl: "/lounge",
              })
            } catch (notificationError) {
              // Payment and entitlement are already committed. A notification
              // outage must not cause Stripe to retry a successfully granted purchase.
              console.error("Could not send Premium activation notification:", notificationError)
            }
          }
          break
        }

        if (metadata.kind === "shop_item" && metadata.user_id && metadata.item_id) {
          const userId = String(metadata.user_id)
          const itemId = String(metadata.item_id)
          const itemType = String(metadata.item_type || "item")
          const txId = `stripe_${session.id}`

          // The catalogue row is the source for everything but the id: the
          // session metadata does not carry a name or a payload.
          const { data: item } = await supabase
            .from("shop_items")
            .select("id, name, item_type, category, rarity, item_data, preview_data")
            .eq("id", itemId)
            .maybeSingle()

          if (session.payment_status !== "paid") {
            console.warn(`Shop checkout ${session.id} completed but payment_status=${session.payment_status}`)
            break
          }

          const { data: existingTx } = await supabase
            .from("wallet_transactions")
            .select("id")
            .eq("id", txId)
            .maybeSingle()

          if (existingTx) {
            console.log(`Shop checkout ${session.id} already granted, skipping`)
            break
          }

          const { error: inventoryError } = await supabase.from("user_inventory").upsert(
            {
              user_id: userId,
              item_id: itemId,
              item_type: itemType,
              category: item?.category || null,
              rarity: item?.rarity || "common",
              item_name: item?.name || null,
              item_data: item?.item_data || {},
              preview_data: item?.preview_data || {},
              acquired_from: "stripe",
              source: "stripe",
              is_active: false,
              purchased_at: new Date().toISOString(),
              payment_method: "stripe",
            },
            { onConflict: "user_id,item_id" },
          )

          if (inventoryError) {
            console.error("Failed to grant shop item from checkout session:", inventoryError)
            break
          }

          const amountUsd = typeof session.amount_total === "number" ? session.amount_total / 100 : 0

          await supabase.from("wallet_transactions").insert({
            id: txId,
            user_id: userId,
            amount_usd: amountUsd,
            coins_amount: 0,
            type: "shop_purchase",
            description: `Purchased ${metadata.item_name || "Shop item"}`,
            status: "completed",
            payment_method: "stripe",
            payment_intent_id: session.payment_intent || null,
            item_id: metadata.item_id || null,
            created_at: new Date().toISOString(),
          })

          await notifyUser(supabase, {
            userId,
            type: "system",
            title: "Purchase complete! 🛍️",
            message: `“${metadata.item_name || "Your item"}” is now in your inventory.`,
            data: { item_id: itemId },
            actionUrl: "/inventory",
          })
          break
        }

        if (metadata.kind === "coin_pack" && metadata.user_id && metadata.coins_amount) {
          const userId = String(metadata.user_id)
          const coinsToAdd = Number(metadata.coins_amount) || 0
          const txId = `stripe_${session.id}`

          // Idempotency: Stripe may retry webhook delivery — never double-credit.
          const { data: existingTx } = await supabase
            .from("wallet_transactions")
            .select("id")
            .eq("id", txId)
            .maybeSingle()

          if (existingTx) {
            console.log(`Checkout session ${session.id} already credited, skipping`)
            break
          }

          if (session.payment_status !== "paid") {
            console.warn(`Checkout session ${session.id} completed but payment_status=${session.payment_status}`)
            break
          }

          const { data: profile } = await supabase
            .from("profiles")
            .select("loop_coins")
            .eq("id", userId)
            .maybeSingle()

          const currentCoins = Number(profile?.loop_coins || 0)
          const newBalance = currentCoins + coinsToAdd

          const { error: creditError } = await supabase
            .from("profiles")
            .upsert({ id: userId, loop_coins: newBalance, updated_at: new Date().toISOString() })

          if (creditError) {
            console.error("Failed to credit loop_coins from checkout session:", creditError)
            break
          }

          const amountUsd = typeof session.amount_total === "number" ? session.amount_total / 100 : 0

          await supabase.from("wallet_transactions").insert({
            id: txId,
            user_id: userId,
            amount_usd: amountUsd,
            coins_amount: coinsToAdd,
            type: "deposit",
            description: `Purchased ${coinsToAdd.toLocaleString()} Loop Coins`,
            status: "completed",
            payment_method: "stripe",
            payment_intent_id: session.payment_intent || null,
            item_id: metadata.item_id || null,
            created_at: new Date().toISOString(),
          })

          if (metadata.item_id) {
            const { data: item } = await supabase
              .from("shop_items")
              .select("purchase_count")
              .eq("id", metadata.item_id)
              .maybeSingle()
            await supabase
              .from("shop_items")
              .update({ purchase_count: Number(item?.purchase_count || 0) + 1 })
              .eq("id", metadata.item_id)
          }

          await notifyUser(supabase, {
            userId,
            type: "system",
            title: "Coins added! 🎉",
            message: `${coinsToAdd.toLocaleString()} Loop Coins were added to your wallet.`,
            data: { coins_amount: coinsToAdd },
            actionUrl: "/wallet",
          })
        }
        break
      }
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent
        // The legacy PaymentIntent creator accepted arbitrary prices and metadata.
        // Keep payment logs reconcilable, but never grant Pro or inventory from
        // client-authored metadata. Current checkout flows have their own trusted
        // server-priced session and grant paths.
        const { error: paymentLogError } = await supabase
          .from("payment_logs")
          .update({ status: "succeeded" })
          .eq("payment_intent_id", paymentIntent.id)

        if (paymentLogError) {
          console.error("Could not update legacy PaymentIntent log:", paymentLogError)
          throw paymentLogError
        }

        if (paymentIntent.metadata?.item_type === "premium" || paymentIntent.metadata?.item_id) {
          console.warn("Ignoring entitlement metadata from retired PaymentIntent flow:", paymentIntent.id)
        }
        break
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // Stripe may deliver subscription events out of order. The event object
        // is only a snapshot; retrieve the canonical current object before
        // syncing entitlements so a delayed update cannot revive a cancelled
        // subscription or overwrite a newer billing period.
        const eventSubscription = event.data.object as Stripe.Subscription
        const subscription = await stripe.subscriptions.retrieve(eventSubscription.id)
        await syncStripePremiumSubscription(supabase, subscription)
        break
      }
      case "payment_intent.payment_failed":
        const failedIntent = event.data.object as any
        await supabase
          .from("payment_logs")
          .update({ status: "failed" })
          .eq("payment_intent_id", failedIntent.id)
        break
      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Webhook error:", error)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 400 })
  }
}

// Handle GET requests for webhook endpoint verification
export async function GET() {
  return NextResponse.json({
    message: "Stripe webhook endpoint is active",
    timestamp: new Date().toISOString(),
  })
}

import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

function legacyPayoutUnavailable() {
  return NextResponse.json(
    {
      error: "USD earnings payouts are not enabled. The supported payout request is verified creator Loop Coin cashout from the Wallet.",
      code: "USD_EARNINGS_PAYOUTS_UNAVAILABLE",
      wallet_url: "/wallet?tab=withdrawals",
    },
    { status: 410 },
  )
}

/**
 * Retired legacy USD payout endpoint. Its old withdrawals table was not part
 * of the production schema, and the previous read-then-write flow was not
 * transaction-safe. Do not re-enable it without a complete ledger, provider,
 * approval and reconciliation workflow.
 */
export async function GET() {
  return legacyPayoutUnavailable()
}

export async function POST() {
  return legacyPayoutUnavailable()
}

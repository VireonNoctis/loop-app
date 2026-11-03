import { describe, expect, it } from "vitest"
import { POST } from "@/app/api/payments/create-payment-intent/route"

describe("retired legacy PaymentIntent endpoint", () => {
  it("does not accept client-priced payments or client-authored entitlement metadata", async () => {
    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body.code).toBe("LEGACY_PAYMENT_INTENT_DISABLED")
  })
})

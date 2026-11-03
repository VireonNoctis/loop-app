"use client"

import { usePathname } from "next/navigation"
import type React from "react"
import { MobileBottomNav } from "@/components/navigation/mobile-bottom-nav"
import { AppUpdateBanner } from "@/components/app-update-banner"
import { ScreenshotDetector } from "@/components/media-protection"

/**
 * Wraps page content inside the global layout.
 *
 * The /messages page is intentionally full-viewport on phones (WhatsApp-style
 * chat), so it renders its own spacing and its own bottom-nav placement. For
 * every other route we keep the standard mobile bottom nav + safe padding.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isMessagesPage = pathname === "/messages" || pathname.startsWith("/messages/")
  const isLegalDocumentPage = pathname === "/terms" || pathname === "/privacy"
  const isStandalonePage = [
    "/login",
    "/signup",
    "/onboarding",
    "/landing",
    "/reset-password",
    "/verify-email",
    "/email-confirmed",
    "/terms",
    "/privacy",
    "/legal/consent",
  ].some((route) => pathname === route || pathname.startsWith(`${route}/`))

  return (
    <>
      <div className={`loop-app-content flex-1 min-w-0 ${isMessagesPage || isStandalonePage ? "pb-0" : "pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0"} ${isLegalDocumentPage ? "legal-page-shell" : ""}`}>
        {!isMessagesPage && !isStandalonePage && <AppUpdateBanner />}
        {children}
      </div>
      {!isMessagesPage && !isStandalonePage && <MobileBottomNav />}
      <ScreenshotDetector />
    </>
  )
}

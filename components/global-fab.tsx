"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"

// Pages where a global "create" FAB doesn't belong: auth flows, the create
// flow itself (redundant), Co-Loop studio/join (has its own primary
// actions), chat/messages (has its own "new message" action), Reels (full-
// screen video with its own controls), Circles/communities (has its own
// per-room compose actions), Live streams (video + chat + gifting already
// fill the screen), and settings/admin surfaces.
const EXCLUDED_PREFIXES = [
  "/login",
  "/signup",
  "/onboarding",
  "/create",
  "/co-loop",
  "/messages",
  "/trees",
  "/communities",
  "/circles",
  "/streams",
  "/settings",
  "/loopadmin",
  "/verify-email",
  "/verification",
  "/reset-password",
  "/landing",
  "/legal",
  "/terms",
  "/privacy",
]

function isExcludedPath(pathname: string) {
  return EXCLUDED_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

export function GlobalFab() {
  const pathname = usePathname()
  const [hidden, setHidden] = useState(false)
  const lastScrollY = useRef(0)

  // X/Twitter-style compose button: hide while scrolling down (reading),
  // reappear as soon as the user scrolls up, and always show near the top.
  useEffect(() => {
    lastScrollY.current = window.scrollY
    let ticking = false

    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const currentY = window.scrollY
        const delta = currentY - lastScrollY.current

        if (currentY < 80) {
          setHidden(false)
        } else if (Math.abs(delta) > 8) {
          setHidden(delta > 0)
        }

        lastScrollY.current = currentY
        ticking = false
      })
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // Never let a route change leave the button stuck hidden.
  useEffect(() => {
    setHidden(false)
  }, [pathname])

  if (isExcludedPath(pathname)) {
    return null
  }

  return (
    <div
      className={cn(
        "fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-50 sm:bottom-6 sm:right-6 transition-all duration-300 ease-out",
        hidden ? "translate-y-24 opacity-0 pointer-events-none" : "translate-y-0 opacity-100",
      )}
    >
      <Link
        href="/create"
        data-tour="create-loop"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-110 active:scale-95 transition-transform duration-200 focus:outline-none focus:ring-4 focus:ring-cyan-500/40 border border-white/20"
        title="Create New Post / Loop"
      >
        <Plus className="h-7 w-7 stroke-[2.5]" />
        <span className="sr-only">Create New Post</span>
      </Link>
    </div>
  )
}

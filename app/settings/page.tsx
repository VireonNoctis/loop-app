"use client"

import { Suspense } from "react"
import Link from "next/link"
import { Header } from "@/components/header"
import { EnhancedSettings } from "@/components/settings/enhanced-settings"

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="container mx-auto max-w-4xl px-4 py-6 sm:py-8">
        <div className="mb-6 space-y-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
          <p className="text-muted-foreground">Manage your profile, theme, notifications, communities, privacy, and more.</p>
        </div>
        <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Loading settings…</div>}>
          <EnhancedSettings />
        </Suspense>
        <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-border/70 pt-5 text-xs text-muted-foreground">
          <Link href="/terms" className="transition-colors hover:text-foreground">Terms of Service</Link>
          <Link href="/privacy" className="transition-colors hover:text-foreground">Privacy Policy</Link>
          <Link href="/help" className="transition-colors hover:text-foreground">Help &amp; support</Link>
        </footer>
      </main>
    </div>
  )
}

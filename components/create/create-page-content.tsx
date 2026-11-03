"use client"

import { Header } from "@/components/header"
import { CreateHub, type CreateTab } from "@/components/create/create-hub"
import { useAuth } from "@/hooks/use-auth"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Zap } from "lucide-react"

export function CreatePageContent({ defaultTab = "loop" }: { defaultTab?: CreateTab }) {
  const { user, loading, authResolved } = useAuth()
  const router = useRouter()

  // Only bounce to sign-in once the session check has actually *concluded*
  // that nobody is signed in. Firing on `!user` alone redirected signed-in
  // users to /login whenever their session lookup was still in flight or had
  // failed transiently — which is exactly what a page refresh used to do.
  useEffect(() => {
    if (!loading && authResolved && !user) {
      // Preserve where they were headed so signing in lands them back here.
      router.replace("/login?redirect=/create")
    }
  }, [user, loading, authResolved, router])

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-100">
      <Header />
      <main className="container mx-auto max-w-4xl px-4 py-6 sm:py-8">
        {/* Studio header */}
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 shadow-lg shadow-violet-900/30">
              <Zap className="h-5 w-5 text-white" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Create
              </h1>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Publish a Loop, make a Reel, or collaborate through Co-Loop and Chains — your draft is saved automatically.
              </p>
            </div>
          </div>
        </div>
        <CreateHub defaultTab={defaultTab} />
      </main>
    </div>
  )
}

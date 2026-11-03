"use client"

import { Suspense, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Header } from "@/components/header"
import { AdminDashboard } from "@/components/admin/admin-dashboard"
import { useAuth } from "@/hooks/use-auth"
import { PageLoading } from "@/components/loading-states"
import { Spinner } from "@/components/ui/skeletons"
import { Shield } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function LoopAdminPage() {
  const { user, loading, authResolved } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && authResolved && !user) {
      router.replace("/login?redirect=/loopadmin")
    }
  }, [loading, authResolved, user, router])

  if (loading) {
    return <PageLoading message="Loading admin…" />
  }

  if (!user) {
    return <PageLoading message="Redirecting to login…" />
  }

  if (!user.staff_role && !user.is_admin && !user.is_moderator) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main className="mx-auto flex max-w-lg flex-col items-center justify-center gap-4 px-4 py-24 text-center">
          <Shield className="h-12 w-12 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Admins only</h1>
          <p className="text-muted-foreground">
            Your account does not have dashboard access. Ask a Developer or Admin to assign a staff role.
          </p>
          <Button asChild variant="outline">
            <Link href="/">Back home</Link>
          </Button>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="container mx-auto px-3 py-6 sm:px-4 sm:py-8">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">App Admin</h1>
          <p className="text-sm text-muted-foreground">
            Manage users, verification, premium, quests, and platform settings.
          </p>
        </div>
        <Suspense
          fallback={
            <div className="flex min-h-[50vh] items-center justify-center">
              <Spinner className="h-6 w-6 text-muted-foreground" />
            </div>
          }
        >
          <AdminDashboard />
        </Suspense>
      </main>
    </div>
  )
}

import { Header } from "@/components/header"
import { FollowRequestsManager } from "@/components/profile/follow-requests-manager"

export const metadata = {
  title: "Follow requests — LOOP",
  description: "Review people who want to follow your private profile.",
}

export default function FollowRequestsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 pb-24 sm:px-6 lg:py-10">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your social graph</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Follow requests</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Choose who can follow your private profile. Requests only become follows after you accept them.
          </p>
        </header>
        <FollowRequestsManager />
      </main>
    </div>
  )
}

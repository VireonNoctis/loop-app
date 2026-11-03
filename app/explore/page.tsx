import Link from "next/link";
import { Header } from "@/components/header";
import { ExploreContent } from "@/components/explore/explore-content";
import { Film, GitBranch } from "lucide-react";

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const params = await searchParams
  const initialTab = params.tab === "chains" ? "deepest" : "recent"
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 max-w-6xl">
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              Explore
            </h1>
            <p className="text-muted-foreground text-lg">Discover Loops, Chains, creators and communities.</p>
          </div>

          <Link
            href="/explore/reels"
            className="group flex items-center justify-between rounded-2xl border border-border bg-gradient-to-r from-violet-500/10 via-transparent to-teal-500/10 px-5 py-4 transition hover:border-violet-500/40 hover:shadow-lg hover:shadow-violet-500/5"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-teal-500 text-white shadow-md shadow-violet-500/20">
                <Film className="h-5 w-5" />
              </span>
              <div>
                <p className="font-bold">Explore Reels</p>
                <p className="text-sm text-muted-foreground">Swipe through trending and fresh clips</p>
              </div>
            </div>
            <span className="text-sm font-semibold text-violet-500 transition group-hover:translate-x-0.5">→</span>
          </Link>


          <Link
            href="/chains"
            className="group flex items-center justify-between rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-transparent to-violet-500/10 px-5 py-4 transition hover:border-primary/45 hover:shadow-lg hover:shadow-primary/5"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
                <GitBranch className="h-5 w-5" />
              </span>
              <div>
                <p className="font-bold">Explore Chains</p>
                <p className="text-sm text-muted-foreground">Join ideas, contribute and build something together</p>
              </div>
            </div>
            <span className="text-sm font-semibold text-primary transition group-hover:translate-x-0.5">→</span>
          </Link>

          <ExploreContent initialTab={initialTab} />
        </div>
      </main>
    </div>
  )
}

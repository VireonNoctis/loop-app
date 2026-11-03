import { Header } from "@/components/header"
import { DropsHub } from "@/components/drops/drops-hub"

export const metadata = {
  title: "Drops — LOOP",
  description: "Live events and community challenges from across LOOP.",
}

export default function DropsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 pb-24 sm:px-6 lg:py-10">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your activity board</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Drops</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Find something happening, join a challenge or show up for your community.
          </p>
        </header>
        <DropsHub />
      </main>
    </div>
  )
}

import { Header } from "@/components/header"
import { CollectionsHub } from "@/components/collections/collections-hub"

export const metadata = {
  title: "Collections — LOOP",
  description: "Organize Loops, Circles and links into collections.",
}

export default function CollectionsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 pb-24 sm:px-6 lg:py-10">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your library</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Collections</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Build useful collections from Loops, Circles and links. Keep them private, share a link or publish them for discovery.
          </p>
        </header>
        <CollectionsHub />
      </main>
    </div>
  )
}

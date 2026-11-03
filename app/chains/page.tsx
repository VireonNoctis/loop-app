import type { Metadata } from "next"
import { Header } from "@/components/header"
import { ChainsHub } from "@/components/chains/chains-hub"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Chains — Create together on LOOP",
  description: "Start a collaborative idea, contribute to a growing Chain and build something together.",
}

export default function ChainsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-10">
        <ChainsHub />
      </main>
    </div>
  )
}

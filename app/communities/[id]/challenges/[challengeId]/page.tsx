import { Header } from "@/components/header"
import { ChallengeDetailClient } from "@/components/drops/challenge-detail-client"

export const dynamic = "force-dynamic"

export default async function ChallengeDetailPage({
  params,
}: {
  params: Promise<{ id: string; challengeId: string }>
}) {
  const { id, challengeId } = await params

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="mx-auto w-full max-w-4xl px-4 py-6 pb-24 sm:px-6 lg:py-10">
        <ChallengeDetailClient circleId={id} challengeId={challengeId} />
      </main>
    </div>
  )
}

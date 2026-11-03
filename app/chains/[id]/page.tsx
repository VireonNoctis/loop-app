import type { Metadata } from "next"
import { Header } from "@/components/header"
import { ChainDetailClient } from "@/components/chains/chain-detail-client"
import { getAbsoluteAppUrl } from "@/lib/app-url"
import {
  buildSharedResourceMetadata,
  buildUnavailableSharedResourceMetadata,
  fetchPublicRustResource,
} from "@/lib/shared-resource-metadata"

export const dynamic = "force-dynamic"

interface ChainMetadataResponse {
  chain?: {
    title?: string
    description?: string
    prompt?: string
    visibility?: string
    contribution_count?: number
    creator_display_name?: string
    creator_username?: string
    creator_avatar_url?: string | null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const baseUrl = await getAbsoluteAppUrl()
  const path = `/chains/${id}`
  const detail = await fetchPublicRustResource<ChainMetadataResponse>("chains", id)
  const chain = detail?.chain

  if (!chain) return buildUnavailableSharedResourceMetadata(baseUrl, path, "chain")

  return buildSharedResourceMetadata({
    baseUrl,
    path,
    kind: "chain",
    visibility: chain.visibility || "unknown",
    title: chain.title || "Chain on LOOP",
    description: chain.description || chain.prompt,
    itemCount: chain.contribution_count,
    creatorName: chain.creator_display_name,
    creatorUsername: chain.creator_username,
    creatorAvatarUrl: chain.creator_avatar_url,
  })
}

export default async function ChainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <ChainDetailClient chainId={id} />
    </div>
  )
}

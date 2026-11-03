import type { Metadata } from "next"
import { Header } from "@/components/header"
import { CollectionDetailClient } from "@/components/collections/collection-detail-client"
import { getAbsoluteAppUrl } from "@/lib/app-url"
import {
  buildSharedResourceMetadata,
  buildUnavailableSharedResourceMetadata,
  fetchPublicRustResource,
} from "@/lib/shared-resource-metadata"

export const dynamic = "force-dynamic"

interface CollectionMetadataResponse {
  collection?: {
    title?: string
    description?: string
    visibility?: string
    item_count?: number
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const baseUrl = await getAbsoluteAppUrl()
  const path = `/collections/${id}`
  const detail = await fetchPublicRustResource<CollectionMetadataResponse>("collections", id)
  const collection = detail?.collection

  if (!collection) return buildUnavailableSharedResourceMetadata(baseUrl, path, "collection")

  return buildSharedResourceMetadata({
    baseUrl,
    path,
    kind: "collection",
    visibility: collection.visibility || "unknown",
    title: collection.title || "Collection on LOOP",
    description: collection.description,
    itemCount: collection.item_count,
  })
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <CollectionDetailClient collectionId={id} />
    </div>
  )
}

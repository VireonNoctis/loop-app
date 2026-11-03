import { NextResponse } from "next/server"
import { getLegalPublicationInfo } from "@/lib/legal-operator"

export const dynamic = "force-dynamic"

export async function GET() {
  const publication = getLegalPublicationInfo()

  return NextResponse.json(
    {
      publication_ready: publication.publicationReady,
      missing_publication_fields: publication.missingFields.map(({ key }) => key),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

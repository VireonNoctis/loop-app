"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowUpRight, Bookmark, GitBranch, MessageCircle } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { rustApiRequest } from "@/lib/rust-api"
import { Card, CardContent } from "@/components/ui/card"

type ProfileChain = {
  id: string
  title: string
  description: string
  kind: string
  contribution_count: number
  participant_count: number
  updated_at: string
}

type ProfileContribution = {
  id: string
  chain_id: string
  chain_title: string
  contribution_type: string
  title: string | null
  content_preview: string
  created_at: string
}

type ProfileCollection = {
  id: string
  title: string
  description: string
  visibility: string
  item_count: number
  updated_at: string
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Recently updated" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function ProfileCreativeWork({ userId }: { userId: string }) {
  const { getAuthHeader } = useAuth()
  const [chains, setChains] = useState<ProfileChain[]>([])
  const [contributions, setContributions] = useState<ProfileContribution[]>([])
  const [collections, setCollections] = useState<ProfileCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrors([])
    const load = async () => {
      const [chainResult, contributionResult, collectionResult] = await Promise.allSettled([
        rustApiRequest<{ chains: ProfileChain[] }>("chains?creator_id=" + encodeURIComponent(userId) + "&limit=6&sort=recent", { headers: getAuthHeader(), cache: "no-store" }),
        rustApiRequest<{ success: boolean; contributions: ProfileContribution[] }>("users/" + encodeURIComponent(userId) + "/chain-contributions?limit=9", { headers: getAuthHeader(), cache: "no-store" }),
        rustApiRequest<ProfileCollection[]>("collections?owner_id=" + encodeURIComponent(userId) + "&limit=6", { headers: getAuthHeader(), cache: "no-store" }),
      ])
      if (cancelled) return
      const nextErrors: string[] = []
      if (chainResult.status === "fulfilled") setChains(Array.isArray(chainResult.value.chains) ? chainResult.value.chains : [])
      else { setChains([]); nextErrors.push("Chains could not be loaded.") }
      if (contributionResult.status === "fulfilled") setContributions(Array.isArray(contributionResult.value.contributions) ? contributionResult.value.contributions : [])
      else { setContributions([]); nextErrors.push("Contributions could not be loaded.") }
      if (collectionResult.status === "fulfilled") setCollections(Array.isArray(collectionResult.value) ? collectionResult.value : [])
      else { setCollections([]); nextErrors.push("Collections could not be loaded.") }
      setErrors(nextErrors)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [getAuthHeader, userId])

  if (loading) return <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl border border-border bg-muted/40" />)}</div>

  return (
    <div className="space-y-8">
      {errors.length > 0 && <p role="status" className="text-sm text-muted-foreground">{errors.join(" ")}</p>}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Chains</h2><p className="text-sm text-muted-foreground">Collaborative ideas and contributions.</p></div><Link href="/chains" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Explore <ArrowUpRight className="h-3.5 w-3.5" /></Link></div>
        {chains.length === 0 ? <Card className="rounded-2xl border-dashed"><CardContent className="p-5 text-sm text-muted-foreground">No public Chains to show here yet.</CardContent></Card> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{chains.map((chain) => <Link key={chain.id} href={"/chains/" + chain.id} className="group block"><Card className="h-full rounded-2xl border-border/70 transition-colors group-hover:border-primary/40"><CardContent className="flex h-full flex-col gap-3 p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><GitBranch className="h-3.5 w-3.5 text-primary" /><span className="capitalize">{chain.kind.replace(/_/g, " ")}</span><span className="ml-auto">{formatDate(chain.updated_at)}</span></div><h3 className="font-semibold group-hover:text-primary">{chain.title}</h3><p className="line-clamp-2 text-sm text-muted-foreground">{chain.description || "A collaborative Chain."}</p><p className="mt-auto text-xs text-muted-foreground">{chain.contribution_count} contributions · {chain.participant_count} contributors</p></CardContent></Card></Link>)}</div>}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Contributions</h2>
            <p className="text-sm text-muted-foreground">Work added to other people's collaborative Chains.</p>
          </div>
          <span className="text-xs text-muted-foreground">{contributions.length} recent</span>
        </div>
        {contributions.length === 0 ? (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="p-5 text-sm text-muted-foreground">No visible Chain contributions yet.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {contributions.map((contribution) => (
              <Link key={contribution.id} href={"/chains/" + contribution.chain_id} className="group block">
                <Card className="h-full rounded-2xl border-border/70 transition-colors group-hover:border-primary/40">
                  <CardContent className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MessageCircle className="h-3.5 w-3.5 text-primary" />
                      <span className="capitalize">{contribution.contribution_type.replace(/_/g, " ")}</span>
                      <span className="ml-auto">{formatDate(contribution.created_at)}</span>
                    </div>
                    <h3 className="font-semibold group-hover:text-primary">{contribution.title || contribution.chain_title}</h3>
                    <p className="line-clamp-3 text-sm text-muted-foreground">{contribution.content_preview || "Structured contribution"}</p>
                    <p className="mt-auto flex items-center gap-1 text-xs font-medium text-primary">In {contribution.chain_title} <ArrowUpRight className="h-3.5 w-3.5" /></p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Collections</h2><p className="text-sm text-muted-foreground">Things gathered and organized.</p></div><Link href="/collections" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Explore <ArrowUpRight className="h-3.5 w-3.5" /></Link></div>
        {collections.length === 0 ? <Card className="rounded-2xl border-dashed"><CardContent className="p-5 text-sm text-muted-foreground">No public Collections to show here yet.</CardContent></Card> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{collections.map((collection) => <Link key={collection.id} href={"/collections/" + collection.id} className="group block"><Card className="h-full rounded-2xl border-border/70 transition-colors group-hover:border-primary/40"><CardContent className="flex h-full flex-col gap-3 p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Bookmark className="h-3.5 w-3.5 text-primary" /><span className="capitalize">{collection.visibility}</span><span className="ml-auto">{formatDate(collection.updated_at)}</span></div><h3 className="font-semibold group-hover:text-primary">{collection.title}</h3><p className="line-clamp-2 text-sm text-muted-foreground">{collection.description || "A curated collection."}</p><p className="mt-auto text-xs text-muted-foreground">{collection.item_count} saved items</p></CardContent></Card></Link>)}</div>}
      </section>
    </div>
  )
}

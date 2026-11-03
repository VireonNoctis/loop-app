"use client"

import { use, useState } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { Header } from "@/components/header"
import { MobileBottomNav } from "@/components/navigation/mobile-bottom-nav"
import { SearchResults } from "@/components/search/search-results"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface SearchPageProps {
  params: Promise<{ query: string }>
}

export default function SearchQueryPage({ params }: SearchPageProps) {
  const { query } = use(params)
  const decodedQuery = decodeURIComponent(query)
  const [searchQuery, setSearchQuery] = useState(decodedQuery)
  const router = useRouter()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    if (!q) return
    router.push(`/search/${encodeURIComponent(q)}`)
  }

  return (
    <div className="min-h-screen bg-background pb-[4.25rem] lg:pb-0">
      <Header />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Search</h1>
          <p className="text-sm text-muted-foreground">People, Loops, Chains, Collections, hashtags, and Circles</p>
        </div>

        <form onSubmit={submit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search @users, keywords, #tags…"
              className="rounded-full pl-9"
            />
          </div>
          <Button type="submit" className="rounded-full">
            Search
          </Button>
        </form>

        <SearchResults query={decodedQuery} />
      </main>
      <div className="lg:hidden">
        <MobileBottomNav />
      </div>
    </div>
  )
}

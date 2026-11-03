"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Archive, ArrowUpRight, Bookmark, Lock, Plus, Users, Globe2 } from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { rustApiRequest } from "@/lib/rust-api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DynamicButton } from "@/components/ui/dynamic-button"

interface CollectionInvitation {
  collection_id: string
  title: string
  description: string
  owner_id: string
  owner_username: string
  owner_display_name: string
  owner_avatar_url: string | null
  role: "editor" | "viewer"
  invited_at: string
  expires_at: string
}

export interface CollectionSummary {
  id: string
  owner_id: string
  title: string
  description: string
  visibility: "private" | "unlisted" | "public"
  is_collaborative: boolean
  item_count: number
  created_at: string
  updated_at: string
}

function VisibilityIcon({ visibility }: { visibility: CollectionSummary["visibility"] }) {
  if (visibility === "public") return <Globe2 className="h-3.5 w-3.5" />
  if (visibility === "unlisted") return <Users className="h-3.5 w-3.5" />
  return <Lock className="h-3.5 w-3.5" />
}

export function CollectionsHub() {
  const { user, loading: authLoading, getAuthHeader } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [invitations, setInvitations] = useState<CollectionInvitation[]>([])
  const [respondingInvitation, setRespondingInvitation] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [visibility, setVisibility] = useState<CollectionSummary["visibility"]>("private")
  const [collaborative, setCollaborative] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [data, invitationData] = await Promise.all([
        rustApiRequest<CollectionSummary[]>("collections?limit=25&offset=0", {
          headers: getAuthHeader(),
        }),
        user
          ? rustApiRequest<CollectionInvitation[]>("collections/invitations", { headers: getAuthHeader() })
          : Promise.resolve([]),
      ])
      const page = Array.isArray(data) ? data : []
      setCollections(page)
      setInvitations(Array.isArray(invitationData) ? invitationData : [])
      setHasMore(page.length === 25)
    } catch (error) {
      toast({
        title: "Couldn't load collections",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [getAuthHeader, toast, user])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, load])

  const respondToInvitation = async (collectionId: string, action: "accept" | "decline") => {
    setRespondingInvitation(collectionId)
    try {
      await rustApiRequest<void>(`collections/${encodeURIComponent(collectionId)}/invitation`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify({ action }),
      })
      setInvitations((current) => current.filter((invitation) => invitation.collection_id !== collectionId))
      if (action === "accept") {
        toast({
          title: "Invitation accepted",
          description: "The collection is now available in your shared collections.",
        })
        await load()
      } else {
        toast({ title: "Invitation declined" })
      }
    } catch (error) {
      toast({
        title: "Couldn't update invitation",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setRespondingInvitation(null)
    }
  }

  const loadMore = async () => {
    if (!hasMore || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await rustApiRequest<CollectionSummary[]>("collections?limit=25&offset=" + collections.length, {
        headers: getAuthHeader(),
      })
      const next = Array.isArray(page) ? page : []
      setCollections((current) => {
        const known = new Set(current.map((collection) => collection.id))
        return [...current, ...next.filter((collection) => !known.has(collection.id))]
      })
      setHasMore(next.length === 25)
    } catch (error) {
      toast({
        title: "Couldn't load more collections",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      })
    } finally {
      setLoadingMore(false)
    }
  }

  const createCollection = async () => {
    if (!title.trim()) return
    setCreating(true)
    try {
      const collection = await rustApiRequest<CollectionSummary>("collections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          visibility,
          is_collaborative: collaborative,
        }),
      })
      setCollections((current) => [collection, ...current])
      setDialogOpen(false)
      setTitle("")
      setDescription("")
      setVisibility("private")
      setCollaborative(false)
      router.push(`/collections/${collection.id}`)
    } catch (error) {
      toast({
        title: "Couldn't create collection",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-44 animate-pulse rounded-2xl border border-border/60 bg-muted/40" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Keep the things you find useful together.</p>
          <p className="text-xs text-muted-foreground">Collections can contain Loops, Chains, Circles and external references.</p>
        </div>
        {user ? (
          <Button onClick={() => setDialogOpen(true)} className="loop-tactile gap-2 self-start sm:self-auto">
            <Plus className="h-4 w-4" />
            New collection
          </Button>
        ) : (
          <Button variant="outline" onClick={() => router.push("/login?redirect=/collections")} className="self-start sm:self-auto">
            Log in to create
          </Button>
        )}
      </div>

      {user && invitations.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Collection invitations</h2>
            <Badge variant="secondary">{invitations.length}</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {invitations.map((invitation) => (
              <Card key={invitation.collection_id} className="rounded-2xl border-primary/20">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{invitation.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {invitation.owner_display_name} (@{invitation.owner_username}) invited you as {invitation.role}.
                      </p>
                      {invitation.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{invitation.description}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Expires {new Date(invitation.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={respondingInvitation === invitation.collection_id}
                      onClick={() => void respondToInvitation(invitation.collection_id, "decline")}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      disabled={respondingInvitation === invitation.collection_id}
                      onClick={() => void respondToInvitation(invitation.collection_id, "accept")}
                    >
                      {respondingInvitation === invitation.collection_id ? "Saving…" : "Accept invitation"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {collections.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <Bookmark className="h-5 w-5 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-semibold">{user ? "Start your first collection" : "No public collections yet"}</h2>
            <p className="max-w-md text-sm text-muted-foreground">{user ? "Build a reading list, gather inspiration, save useful Loops or make a shared reference shelf for a Circle." : "Public collections shared by their owners will appear here. Sign in to create your own."}</p>
            {user ? (
              <Button onClick={() => setDialogOpen(true)} className="loop-tactile gap-2">
                <Plus className="h-4 w-4" />
                Create collection
              </Button>
            ) : (
              <Button variant="outline" onClick={() => router.push("/login?redirect=/collections")}>
                Log in to create a collection
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {collections.map((collection) => (
            <Link key={collection.id} href={`/collections/${collection.id}`} className="group block">
              <Card className="h-full overflow-hidden rounded-2xl border-border/70 transition-colors group-hover:border-primary/40 group-focus-visible:ring-2 group-focus-visible:ring-ring">
                <CardContent className="flex min-h-44 flex-col gap-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                      <Archive className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <Badge variant="secondary" className="gap-1.5 rounded-full font-medium capitalize">
                      <VisibilityIcon visibility={collection.visibility} />
                      {collection.visibility}
                    </Badge>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <h2 className="truncate text-base font-semibold">{collection.title}</h2>
                    <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                      {collection.description || "No description yet."}
                    </p>
                  </div>
                  <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
                    <span>{collection.item_count} {collection.item_count === 1 ? "item" : "items"}</span>
                    <span className="inline-flex items-center gap-1 transition-colors group-hover:text-foreground">
                      Open <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading collections…" : "Load more collections"}
          </Button>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Create a collection</DialogTitle>
            <DialogDescription>Give a set of useful things a name. You can change its visibility later.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="collection-title" className="text-sm font-medium">Name</label>
              <Input
                id="collection-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Games worth playing"
                maxLength={80}
                autoFocus
              />
              <p className="text-right text-[11px] text-muted-foreground">{title.length}/80</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="collection-description" className="text-sm font-medium">Description</label>
              <Textarea
                id="collection-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What belongs in this collection?"
                maxLength={500}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="collection-visibility" className="text-sm font-medium">Visibility</label>
              <select
                id="collection-visibility"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as CollectionSummary["visibility"])}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="private">Private — only you</option>
                <option value="unlisted">Unlisted — anyone with the link</option>
                <option value="public">Public — discoverable</option>
              </select>
            </div>
            <label className="flex items-start gap-3 rounded-xl border border-border/70 p-3 text-sm">
              <input
                type="checkbox"
                checked={collaborative}
                onChange={(event) => setCollaborative(event.target.checked)}
                className="mt-0.5"
              />
              <span className="space-y-0.5">
                <span className="block font-medium">Allow collaboration</span>
                <span className="block text-xs text-muted-foreground">After creating it, invite editors from the collection page to build the collection together.</span>
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <DynamicButton
              onClick={createCollection}
              disabled={creating || !title.trim()}
              feedback="press"
              stateKey={creating ? "creating" : "create"}
              icon={creating ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : <Plus className="h-4 w-4" />}
            >
              {creating ? "Creating…" : "Create collection"}
            </DynamicButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

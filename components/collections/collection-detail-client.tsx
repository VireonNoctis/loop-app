"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Archive, Bookmark, Circle, ExternalLink, GitBranch, Globe2, Link2, Lock, Plus, Trash2, Users } from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { rustApiRequest } from "@/lib/rust-api"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DynamicButton } from "@/components/ui/dynamic-button"
import { type CollectionSummary } from "@/components/collections/collections-hub"

interface CollectionItem {
  id: string
  item_type: "loop" | "circle" | "chain" | "external"
  loop_id: string | null
  circle_id: string | null
  chain_id: string | null
  external_url: string | null
  title_override: string | null
  note: string | null
  position: number
  created_at: string
}

interface CollectionCollaborator {
  user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  role: "editor" | "viewer"
  joined_at: string
}

interface CollectionMemberInvitationResult {
  collection_id: string
  user_id: string
  username: string
  role: "editor" | "viewer"
  status: "pending" | "active"
  expires_at: string | null
}

interface CollectionPendingInvitation {
  user_id: string
  username: string
  display_name: string
  role: "editor" | "viewer"
  invited_at: string
  expires_at: string
}

interface CollectionDetail {
  collection: CollectionSummary
  items: CollectionItem[]
  collaborators: CollectionCollaborator[]
  pending_invitations: CollectionPendingInvitation[]
  can_edit: boolean
  can_manage_members: boolean
}

type ItemType = CollectionItem["item_type"]

function extractUuid(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
  return match?.[0] || trimmed
}

function visibilityLabel(visibility: CollectionSummary["visibility"]) {
  if (visibility === "public") return "Public"
  if (visibility === "unlisted") return "Unlisted"
  return "Private"
}

export function CollectionDetailClient({ collectionId }: { collectionId: string }) {
  const { user, loading: authLoading, getAuthHeader } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const [data, setData] = useState<CollectionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [itemType, setItemType] = useState<ItemType>("loop")
  const [target, setTarget] = useState("")
  const [titleOverride, setTitleOverride] = useState("")
  const [note, setNote] = useState("")
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [inviteUsername, setInviteUsername] = useState("")
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor")
  const [inviting, setInviting] = useState(false)
  const [removingCollaborator, setRemovingCollaborator] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await rustApiRequest<CollectionDetail>(`collections/${encodeURIComponent(collectionId)}`, {
        headers: getAuthHeader(),
      })
      setData(result)
    } catch (error) {
      toast({
        title: "Couldn't open collection",
        description: error instanceof Error ? error.message : "This collection may be private or unavailable.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [collectionId, getAuthHeader, toast, user])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, load])

  const addItem = async () => {
    if (!target.trim()) return
    setAdding(true)
    try {
      let payload: Record<string, unknown>
      if (itemType === "loop") {
        payload = { item_type: "loop", loop_id: extractUuid(target) }
      } else if (itemType === "circle") {
        payload = { item_type: "circle", circle_id: extractUuid(target) }
      } else if (itemType === "chain") {
        payload = { item_type: "chain", chain_id: extractUuid(target) }
      } else {
        payload = { item_type: "external", external_url: target.trim() }
      }
      if (titleOverride.trim()) payload.title_override = titleOverride.trim()
      if (note.trim()) payload.note = note.trim()

      await rustApiRequest<CollectionItem>(`collections/${encodeURIComponent(collectionId)}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify(payload),
      })
      setTarget("")
      setTitleOverride("")
      setNote("")
      await load()
      toast({ title: "Added to collection" })
    } catch (error) {
      toast({
        title: "Couldn't add item",
        description: error instanceof Error ? error.message : "Check the link or ID and try again.",
        variant: "destructive",
      })
    } finally {
      setAdding(false)
    }
  }

  const removeItem = async (itemId: string) => {
    setRemoving(itemId)
    try {
      await rustApiRequest<void>(
        `collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`,
        { method: "DELETE", headers: getAuthHeader() },
      )
      setData((current) => current
        ? { ...current, items: current.items.filter((item) => item.id !== itemId), collection: { ...current.collection, item_count: Math.max(0, current.collection.item_count - 1) } }
        : current)
      toast({ title: "Item removed" })
    } catch (error) {
      toast({
        title: "Couldn't remove item",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setRemoving(null)
    }
  }

  const inviteCollaborator = async () => {
    const username = inviteUsername.trim().replace(/^@/, "")
    if (!username || !data?.can_manage_members) return
    setInviting(true)
    try {
      const invitation = await rustApiRequest<CollectionMemberInvitationResult>(
        `collections/${encodeURIComponent(collectionId)}/members`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getAuthHeader(),
          },
          body: JSON.stringify({ username, role: inviteRole }),
        },
      )
      setInviteUsername("")
      await load()
      toast({
        title: invitation.status === "active" ? "Access updated" : "Invitation sent",
        description: invitation.status === "active"
          ? `@${username}'s access is now set to ${inviteRole}.`
          : inviteRole === "editor"
            ? `@${username} can edit after accepting the invitation.`
            : `@${username} can view after accepting the invitation.`,
      })
    } catch (error) {
      toast({
        title: "Couldn't add collaborator",
        description: error instanceof Error ? error.message : "Check the username and try again.",
        variant: "destructive",
      })
    } finally {
      setInviting(false)
    }
  }

  const removeCollaborator = async (memberUserId: string) => {
    setRemovingCollaborator(memberUserId)
    try {
      await rustApiRequest<void>(
        `collections/${encodeURIComponent(collectionId)}/members/${encodeURIComponent(memberUserId)}`,
        { method: "DELETE", headers: getAuthHeader() },
      )
      await load()
      toast({ title: "Collaborator access updated" })
    } catch (error) {
      toast({
        title: "Couldn't update collaborators",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      })
    } finally {
      setRemovingCollaborator(null)
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/collections/${collectionId}`)
      toast({ title: "Collection link copied" })
    } catch {
      toast({ title: "Couldn't copy link", description: "Clipboard access is unavailable in this browser.", variant: "destructive" })
    }
  }

  if (authLoading || loading) {
    return <div className="mx-auto max-w-5xl space-y-4 px-4 py-8"><div className="h-10 w-48 animate-pulse rounded-lg bg-muted" /><div className="h-40 animate-pulse rounded-2xl bg-muted" /></div>
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-12 text-center">
        <Archive className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Collection unavailable</h1>
        <p className="text-sm text-muted-foreground">It may have been deleted, made private or the link may be incorrect.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {!user ? <Button onClick={() => router.push(`/login?redirect=/collections/${collectionId}`)}>Log in</Button> : null}
          <Button variant="outline" onClick={() => router.push("/collections")}>Back to collections</Button>
        </div>
      </div>
    )
  }

  const collection = data.collection

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 pb-24 sm:px-6 lg:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/collections" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Collections
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5 rounded-full">
            {collection.visibility === "public" ? <Globe2 className="h-3.5 w-3.5" /> : collection.visibility === "unlisted" ? <Link2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {visibilityLabel(collection.visibility)}
          </Badge>
          <Button variant="outline" size="sm" onClick={copyLink} className="loop-tactile-flat gap-2">
            <ExternalLink className="h-4 w-4" /> Share link
          </Button>
        </div>
      </div>

      <section className="space-y-3 border-b border-border/70 pb-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <Archive className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{collection.title}</h1>
        {collection.description ? <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{collection.description}</p> : null}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{collection.item_count} {collection.item_count === 1 ? "item" : "items"}</span>
          {collection.is_collaborative ? <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> Collaborative</span> : null}
        </div>
      </section>

      {collection.is_collaborative || (data.can_manage_members && data.pending_invitations.length > 0) ? (
        <Card className="rounded-2xl border-border/70">
          <CardContent className="space-y-4 p-4 sm:p-5">
            {!collection.is_collaborative && data.can_manage_members ? (
              <p className="rounded-xl border border-dashed border-border/70 p-3 text-xs text-muted-foreground">
                Collaboration is paused. Existing members cannot access or edit this collection. You can cancel outstanding invitations here; turn collaboration back on to invite members again.
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <h2 className="font-semibold">Collaborators</h2>
              <Badge variant="secondary" className="ml-auto">{data.collaborators.length}</Badge>
            </div>
            {data.collaborators.length ? (
              <div className="divide-y divide-border/60">
                {data.collaborators.map((member) => (
                  <div key={member.user_id} className="flex items-center gap-3 py-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
                      {member.avatar_url ? (
                        <img src={member.avatar_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        (member.display_name || member.username).slice(0, 1).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{member.display_name || member.username}</p>
                      <p className="truncate text-xs text-muted-foreground">@{member.username} · {member.role}</p>
                    </div>
                    {(data.can_manage_members || member.user_id === user?.id) && member.user_id !== collection.owner_id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removingCollaborator === member.user_id}
                        onClick={() => void removeCollaborator(member.user_id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        {removingCollaborator === member.user_id ? "Updating…" : data.can_manage_members ? "Remove" : "Leave"}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No collaborators yet. Add someone to build this collection together.</p>
            )}
            {data.can_manage_members && data.pending_invitations.length > 0 ? (
              <div className="space-y-2 border-t border-border/60 pt-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold">Pending invitations</p>
                  <Badge variant="secondary">{data.pending_invitations.length}</Badge>
                </div>
                {data.pending_invitations.map((invitation) => (
                  <div key={invitation.user_id} className="flex items-center gap-3 rounded-xl bg-muted/30 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {invitation.display_name || invitation.username}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        @{invitation.username} · {invitation.role} · sent {new Date(invitation.invited_at).toLocaleDateString()} · expires {new Date(invitation.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="outline">Awaiting response</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={removingCollaborator === invitation.user_id}
                      onClick={() => void removeCollaborator(invitation.user_id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      Cancel
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {data.can_manage_members && collection.is_collaborative ? (
              <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row">
                <Input
                  value={inviteUsername}
                  onChange={(event) => setInviteUsername(event.target.value)}
                  placeholder="LOOP username"
                  aria-label="Collaborator username"
                  maxLength={51}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !inviting && inviteUsername.trim()) {
                      event.preventDefault()
                      void inviteCollaborator()
                    }
                  }}
                />
                <select
                  aria-label="Collaborator access level"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
                <Button onClick={() => void inviteCollaborator()} disabled={inviting || !inviteUsername.trim()} className="loop-tactile gap-2">
                  <Plus className="h-4 w-4" />
                  {inviting ? "Sending…" : "Send invitation"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {data.can_edit ? (
        <Card className="rounded-2xl border-border/70">
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              <h2 className="font-semibold">Add something to this collection</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
              <select
                aria-label="Item type"
                value={itemType}
                onChange={(event) => setItemType(event.target.value as ItemType)}
                className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="loop">Loop</option>
                <option value="circle">Circle</option>
                <option value="chain">Chain</option>
                <option value="external">External link</option>
              </select>
              <Input
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder={itemType === "loop" ? "Paste a Loop link or ID" : itemType === "circle" ? "Paste a Circle link or ID" : itemType === "chain" ? "Paste a Chain link or ID" : "https://example.com"}
                aria-label={itemType === "external" ? "External URL" : `${itemType} link or ID`}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={titleOverride} onChange={(event) => setTitleOverride(event.target.value)} placeholder="Display title (optional)" maxLength={160} />
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Personal note (optional)" maxLength={500} />
            </div>
            <div className="flex justify-end">
              <DynamicButton
                onClick={addItem}
                disabled={adding || !target.trim()}
                feedback="press"
                stateKey={adding ? "adding" : "add"}
                icon={adding ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : <Plus className="h-4 w-4" />}
              >
                {adding ? "Adding…" : "Add to collection"}
              </DynamicButton>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {data.items.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Bookmark className="h-7 w-7 text-muted-foreground" />
            <h2 className="font-semibold">Nothing in this collection yet</h2>
            <p className="max-w-md text-sm text-muted-foreground">{data.can_edit ? "Add a Loop, Circle, Chain or external reference to start building it." : "The owner hasn't added anything yet."}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.items.map((item) => (
            <Card key={item.id} className="rounded-xl border-border/70">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                    {item.item_type === "loop" ? <Bookmark className="h-4 w-4" /> : item.item_type === "circle" ? <Circle className="h-4 w-4" /> : item.item_type === "chain" ? <GitBranch className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium">{item.title_override || (item.item_type === "loop" ? "Loop" : item.item_type === "circle" ? "Circle" : item.item_type === "chain" ? "Chain" : item.external_url)}</p>
                    {item.note ? <p className="text-xs text-muted-foreground">{item.note}</p> : null}
                    {item.item_type === "loop" && item.loop_id ? <Link href={`/loop/${item.loop_id}`} className="text-xs text-primary hover:underline">Open Loop</Link> : null}
                    {item.item_type === "circle" && item.circle_id ? <Link href={`/communities/${item.circle_id}`} className="text-xs text-primary hover:underline">Open Circle</Link> : null}
                    {item.item_type === "chain" && item.chain_id ? <Link href={`/chains/${item.chain_id}`} className="text-xs text-primary hover:underline">Open Chain</Link> : null}
                    {item.item_type === "external" && item.external_url ? <a href={item.external_url} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-primary hover:underline">{item.external_url}</a> : null}
                  </div>
                </div>
                {data.can_edit ? (
                  <Button variant="ghost" size="sm" disabled={removing === item.id} onClick={() => void removeItem(item.id)} className="self-end text-muted-foreground hover:text-destructive sm:self-auto">
                    {removing === item.id ? "Removing…" : <><Trash2 className="mr-1.5 h-4 w-4" /> Remove</>}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  )
}

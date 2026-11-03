"use client"

import { useEffect, useState } from "react"
import { BookmarkPlus, Check, FolderPlus } from "lucide-react"

import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { rustApiRequest } from "@/lib/rust-api"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { useLoginGate } from "@/hooks/use-login-gate"

interface CollectionOption {
  id: string
  title: string
  visibility: string
  item_count: number
}

export function AddLoopToCollectionItem({ loopId }: { loopId: string }) {
  const { user, getAuthHeader } = useAuth()
  const { toast } = useToast()
  const { requireAuth } = useLoginGate()
  const [open, setOpen] = useState(false)
  const [collections, setCollections] = useState<CollectionOption[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    let active = true
    setLoading(true)
    rustApiRequest<CollectionOption[]>("collections", { headers: getAuthHeader() })
      .then((result) => {
        if (!active) return
        const rows = Array.isArray(result) ? result : []
        setCollections(rows)
        setSelectedId((current) => current || rows[0]?.id || "")
      })
      .catch((error) => {
        if (active) {
          toast({
            title: "Couldn't load collections",
            description: error instanceof Error ? error.message : "Try again.",
            variant: "destructive",
          })
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [getAuthHeader, open, toast, user])

  const add = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      await rustApiRequest(`collections/${encodeURIComponent(selectedId)}/items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify({ item_type: "loop", loop_id: loopId }),
      })
      setOpen(false)
      toast({ title: "Added to collection" })
    } catch (error) {
      toast({
        title: "Couldn't add this Loop",
        description: error instanceof Error ? error.message : "Try another collection.",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DropdownMenuItem
        className="cursor-pointer gap-2 py-2 text-xs"
        onSelect={(event) => {
          event.preventDefault()
          if (!requireAuth("post")) return
          setOpen(true)
        }}
      >
        <FolderPlus className="h-4 w-4 text-primary" />
        <span>Add to collection</span>
      </DropdownMenuItem>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Add to a collection</DialogTitle>
            <DialogDescription>Keep this Loop with related ideas, references and recommendations.</DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="h-10 animate-pulse rounded-lg bg-muted" />
          ) : collections.length === 0 ? (
            <div className="space-y-3 rounded-xl border border-dashed border-border p-4 text-center">
              <BookmarkPlus className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">You haven't created a collection yet.</p>
              <Button variant="outline" onClick={() => window.location.assign("/collections")}>Create a collection</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => setSelectedId(collection.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${selectedId === collection.id ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{collection.title}</span>
                    <span className="block text-xs text-muted-foreground">{collection.item_count} items · {collection.visibility}</span>
                  </span>
                  {selectedId === collection.id ? <Check className="h-4 w-4 text-primary" /> : null}
                </button>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={add} disabled={loading || saving || !selectedId || collections.length === 0}>
              {saving ? "Adding…" : "Add Loop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

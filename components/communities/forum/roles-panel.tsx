"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/skeletons"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
  POWER_COLORS,
  POWER_GROUPS,
  POWER_ICONS,
  type PermissionSpec,
} from "@/lib/community-permissions"
import {
  DEFAULT_THREAD_POLICY,
  type ThreadCreationPolicy,
} from "@/lib/community-thread-policy"
import {
  Check,
  Crown,
  Hammer,
  Leaf,
  Loader2,
  Palette,
  Pencil,
  Plus,
  Shield,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

interface CircleOwnershipCandidate {
  user_id: string
  user?: {
    username?: string | null
    display_name?: string | null
  } | null
}

interface Power {
  id: number
  name: string
  description: string
  color: string
  icon: string
  permissions: string[]
  priority: number
  is_default: boolean
  member_count?: number
}

const ICONS: Record<string, LucideIcon> = {
  shield: Shield,
  star: Star,
  sparkles: Sparkles,
  hammer: Hammer,
  palette: Palette,
  compass: Leaf,
  leaf: Leaf,
  crown: Crown,
}

function iconFor(name: string): LucideIcon {
  return ICONS[name] || Shield
}

const BLANK: Power = {
  id: 0,
  name: "",
  description: "",
  color: POWER_COLORS[0],
  icon: "shield",
  permissions: ["post.create", "thread.create", "chat.send"],
  priority: 10,
  is_default: false,
}

/**
 * Powers: the community's own roles.
 *
 * Owners and admins create a role of any kind, give it any combination of
 * permissions, decide which roles may start threads, and choose the role every
 * new member receives on join — all in one panel, all saved through the roles
 * API.
 */
export function RolesDialog({
  communityId,
  open,
  onOpenChange,
}: {
  communityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { getAuthHeader, user } = useAuth()
  const { toast } = useToast()

  const [loading, setLoading] = useState(false)
  const [roles, setRoles] = useState<Power[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [canEditSettings, setCanEditSettings] = useState(false)
  const [policy, setPolicy] = useState<ThreadCreationPolicy>(DEFAULT_THREAD_POLICY)
  const [policyDraft, setPolicyDraft] = useState<ThreadCreationPolicy>(DEFAULT_THREAD_POLICY)
  const [policySaving, setPolicySaving] = useState(false)
  const [editing, setEditing] = useState<Power | null>(null)
  const [busy, setBusy] = useState<number | "new" | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Power | null>(null)
  const [canTransferOwnership, setCanTransferOwnership] = useState(false)
  const [ownershipCandidates, setOwnershipCandidates] = useState<CircleOwnershipCandidate[]>([])
  const [selectedNewOwner, setSelectedNewOwner] = useState("")
  const [confirmOwnershipTransfer, setConfirmOwnershipTransfer] = useState(false)
  const [transferringOwnership, setTransferringOwnership] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/communities/${communityId}/roles`, {
        headers: { ...getAuthHeader() },
        cache: "no-store",
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Failed to load roles")
      setRoles(Array.isArray(json.roles) ? json.roles : [])
      setCanEdit(Boolean(json.can_assign))
      setCanEditSettings(Boolean(json.can_edit_settings))
      const nextPolicy =
        json.thread_creation && typeof json.thread_creation === "object"
          ? json.thread_creation
          : DEFAULT_THREAD_POLICY
      setPolicy(nextPolicy)
      setPolicyDraft(nextPolicy)

      // Ownership is a separate capability: only the canonical owner sees
      // the transfer control, and candidates come from the active roster.
      try {
        const ownershipResponse = await fetch(`/api/circles/${communityId}/ownership`, {
          headers: { ...getAuthHeader() },
          cache: "no-store",
        })
        const ownershipJson = await ownershipResponse.json().catch(() => ({}))
        const ownerCanTransfer = ownershipResponse.ok && ownershipJson.can_transfer === true
        setCanTransferOwnership(ownerCanTransfer)
        if (ownerCanTransfer) {
          const memberResponse = await fetch(`/api/circles/${communityId}/members?limit=100`, {
            headers: { ...getAuthHeader() },
            cache: "no-store",
          })
          const memberJson = await memberResponse.json().catch(() => ({}))
          setOwnershipCandidates(
            memberResponse.ok && Array.isArray(memberJson.members)
              ? memberJson.members.filter((member: CircleOwnershipCandidate) =>
                  typeof member.user_id === "string" && member.user_id !== user?.id,
                )
              : [],
          )
        } else {
          setOwnershipCandidates([])
          setSelectedNewOwner("")
        }
      } catch {
        setCanTransferOwnership(false)
        setOwnershipCandidates([])
      }
    } catch (e: any) {
      toast({ title: "Could not load roles", description: e.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [communityId, getAuthHeader, toast, user?.id])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const savePower = async (power: Power) => {
    setBusy(power.id || "new")
    try {
      const res = await fetch(`/api/communities/${communityId}/roles`, {
        method: power.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify(
          power.id
            ? {
                id: power.id,
                name: power.name,
                description: power.description,
                color: power.color,
                icon: power.icon,
                permissions: power.permissions,
                priority: power.priority,
                is_default: power.is_default,
              }
            : {
                name: power.name,
                description: power.description,
                color: power.color,
                icon: power.icon,
                permissions: power.permissions,
                priority: power.priority,
                is_default: power.is_default,
              },
        ),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Could not save")
      toast({ title: power.id ? "Role updated" : "Role created" })
      setEditing(null)
      await load()
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const deletePower = async (power: Power) => {
    setBusy(power.id)
    try {
      const res = await fetch(`/api/communities/${communityId}/roles?id=${power.id}`, {
        method: "DELETE",
        headers: { ...getAuthHeader() },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Could not delete")
      toast({ title: "Role deleted" })
      setConfirmDelete(null)
      await load()
    } catch (e: any) {
      toast({ title: "Could not delete", description: e.message, variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const savePolicy = async () => {
    setPolicySaving(true)
    try {
      const res = await fetch(`/api/communities/${communityId}/roles`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ thread_creation: policyDraft }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Could not save")
      setPolicy(json.thread_creation || policyDraft)
      toast({ title: "Thread permissions saved" })
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" })
    } finally {
      setPolicySaving(false)
    }
  }

  const policyDirty = JSON.stringify(policy) !== JSON.stringify(policyDraft)

  const transferOwnership = async () => {
    if (!selectedNewOwner) return
    setTransferringOwnership(true)
    try {
      const response = await fetch(`/api/circles/${communityId}/ownership`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ new_owner_id: selectedNewOwner }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || "Could not transfer ownership")
      toast({
        title: "Circle ownership transferred",
        description: "The new owner now manages the Circle. Your account remains an admin.",
      })
      setConfirmOwnershipTransfer(false)
      setSelectedNewOwner("")
      await load()
    } catch (e: any) {
      toast({ title: "Could not transfer ownership", description: e.message, variant: "destructive" })
    } finally {
      setTransferringOwnership(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Roles &amp; permissions</DialogTitle>
            <DialogDescription>
              Invent any role, hand it any permission, and decide who may open threads and what
              everyone gets when they join.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Spinner className="h-5 w-5" /> Loading roles…
            </div>
          ) : (
            <div className="space-y-6">
              {/* ── Thread creation ── */}
              <section className="rounded-2xl border border-border bg-muted/20 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-foreground">
                    Who can start threads
                  </h3>
                  {canEditSettings ? (
                    <button
                      type="button"
                      disabled={policySaving || !policyDirty}
                      onClick={() => void savePolicy()}
                      className="rounded-full bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground transition-opacity disabled:opacity-40"
                    >
                      {policySaving ? "Saving…" : "Save"}
                    </button>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase text-muted-foreground">View only</span>
                  )}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    {
                      id: "members" as const,
                      title: "Anyone who can post",
                      hint: "Members keep the Open threads Power they already have.",
                    },
                    {
                      id: "roles" as const,
                      title: "Only chosen roles",
                      hint: "Pick exactly which roles may open a thread here.",
                    },
                  ].map((opt) => {
                    const active = policyDraft.mode === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={!canEditSettings}
                        onClick={() => setPolicyDraft({ ...policyDraft, mode: opt.id })}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          active
                            ? "border-primary bg-primary/10"
                            : "border-border bg-card hover:border-primary/40",
                          !canEditSettings && "cursor-default opacity-70",
                        )}
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <span
                            className={cn(
                              "flex h-4 w-4 items-center justify-center rounded-full border",
                              active ? "border-primary bg-primary text-primary-foreground" : "border-border",
                            )}
                          >
                            {active && <Check className="h-3 w-3" />}
                          </span>
                          {opt.title}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">{opt.hint}</span>
                      </button>
                    )
                  })}
                </div>

                {policyDraft.mode === "roles" && (
                  <div className="mt-3 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Roles allowed to start threads
                    </p>
                    {roles.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Create a role first — owners and moderators can always start threads.
                      </p>
                    ) : (
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {roles.map((r) => {
                          const checked = policyDraft.roles.includes(Number(r.id))
                          const Icon = iconFor(r.icon)
                          return (
                            <label
                              key={r.id}
                              className={cn(
                                "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors",
                                checked ? "border-primary/50 bg-primary/10" : "border-border bg-card",
                                !canEditSettings && "cursor-default",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="accent-[var(--primary)]"
                                checked={checked}
                                disabled={!canEditSettings}
                                onChange={(e) => {
                                  const ids = e.target.checked
                                    ? [...policyDraft.roles, Number(r.id)]
                                    : policyDraft.roles.filter((x) => x !== Number(r.id))
                                  setPolicyDraft({
                                    ...policyDraft,
                                    roles: Array.from(new Set(ids)),
                                  })
                                }}
                              />
                              <span
                                className="flex h-5 w-5 items-center justify-center rounded-md"
                                style={{ background: `${r.color}22`, color: r.color }}
                              >
                                <Icon className="h-3 w-3" />
                              </span>
                              <span className="truncate font-medium">{r.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Owners and moderators can always start threads, whatever is picked here.
                    </p>
                  </div>
                )}
              </section>

              {canTransferOwnership && (
                <section className="rounded-2xl border border-border bg-muted/20 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Crown className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold">Transfer Circle ownership</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Choose an active member to become the owner. You will remain an admin after the transfer.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <select
                          aria-label="New Circle owner"
                          value={selectedNewOwner}
                          onChange={(event) => setSelectedNewOwner(event.target.value)}
                          className="min-h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="">Choose an active member</option>
                          {ownershipCandidates.map((candidate) => {
                            const username = candidate.user?.username || candidate.user_id
                            const label = candidate.user?.display_name || username
                            return (
                              <option key={candidate.user_id} value={candidate.user_id}>
                                {label} (@{username})
                              </option>
                            )
                          })}
                        </select>
                        <Button
                          className="rounded-full"
                          disabled={!selectedNewOwner || transferringOwnership}
                          onClick={() => setConfirmOwnershipTransfer(true)}
                        >
                          Transfer ownership
                        </Button>
                      </div>
                      {ownershipCandidates.length === 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          There are no other active members available to receive ownership.
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* ── Roles ── */}
              <section>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-foreground">Roles</h3>
                    <p className="text-[11px] text-muted-foreground">
                      {roles.length} {roles.length === 1 ? "role" : "roles"} ·{" "}
                      {roles.some((r) => r.is_default) ? "new members get the default role" : "no default role set yet"}
                    </p>
                  </div>
                  {canEdit && (
                    <Button size="sm" className="rounded-full" onClick={() => setEditing({ ...BLANK })}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> New role
                    </Button>
                  )}
                </div>

                {roles.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                    No roles yet{canEdit ? " — create the first one." : "."}
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {roles.map((r) => {
                      const Icon = iconFor(r.icon)
                      return (
                        <li
                          key={r.id}
                          className="flex items-start gap-3 rounded-xl border border-border bg-card p-3"
                        >
                          <span
                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                            style={{ background: `${r.color}22`, color: r.color }}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                              {r.name}
                              {r.is_default && (
                                <span className="rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-primary">
                                  On join
                                </span>
                              )}
                              <span className="text-[11px] font-medium text-muted-foreground">
                                {r.member_count || 0} {r.member_count === 1 ? "member" : "members"}
                              </span>
                            </p>
                            {r.description && (
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {r.permissions.length === 0 ? (
                                <span className="text-[11px] italic text-muted-foreground">No permissions</span>
                              ) : (
                                r.permissions.map((p) => {
                                  const spec = findPermission(p)
                                  return (
                                    <span
                                      key={p}
                                      title={spec?.hint}
                                      className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground"
                                    >
                                      {spec?.label || p}
                                    </span>
                                  )
                                })
                              )}
                            </div>
                          </div>
                          {canEdit && (
                            <div className="flex shrink-0 gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 rounded-full p-0"
                                aria-label={`Edit ${r.name}`}
                                onClick={() => setEditing(r)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 rounded-full p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`Delete ${r.name}`}
                                disabled={busy === r.id}
                                onClick={() => setConfirmDelete(r)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOwnershipTransfer} onOpenChange={setConfirmOwnershipTransfer}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer Circle ownership?</DialogTitle>
            <DialogDescription>
              This is a permanent role change. The selected active member becomes the owner, and your account is retained as an admin. Premium status and verification are unaffected.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              className="rounded-full"
              disabled={transferringOwnership}
              onClick={() => setConfirmOwnershipTransfer(false)}
            >
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={transferringOwnership || !selectedNewOwner}
              onClick={() => void transferOwnership()}
            >
              {transferringOwnership ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Crown className="mr-1.5 h-4 w-4" />}
              Confirm transfer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {editing && (
        <PowerEditor
          communityId={communityId}
          power={editing}
          busy={busy === (editing.id || "new")}
          onCancel={() => setEditing(null)}
          onSave={savePower}
        />
      )}

      <Dialog open={Boolean(confirmDelete)} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>
              The role and its assignments disappear for good. Members keep their base role.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="rounded-full" onClick={() => setConfirmDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={busy === confirmDelete?.id}
              onClick={() => confirmDelete && void deletePower(confirmDelete)}
            >
              Delete role
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function findPermission(key: string): PermissionSpec | undefined {
  for (const group of POWER_GROUPS) {
    const hit = group.items.find((i) => i.key === key)
    if (hit) return hit
  }
  return undefined
}

/* ─────────────────────────── Role editor ─────────────────────────── */

function PowerEditor({
  communityId,
  power,
  busy,
  onCancel,
  onSave,
}: {
  communityId: string
  power: Power
  busy: boolean
  onCancel: () => void
  onSave: (power: Power) => void
}) {
  const [draft, setDraft] = useState<Power>(power)
  const [isNew, setIsNew] = useState(true)

  useEffect(() => {
    setDraft(power)
    setIsNew(!power.id)
  }, [power])

  // Community-wide permissions are set by the thread policy above, so the
  // editor keeps them out of the checkbox grid to avoid two sources of truth.
  const groups = POWER_GROUPS

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "Create a role" : `Edit ${power.name}`}</DialogTitle>
          <DialogDescription>
            {communityId ? "Any permission can be combined — this role only grants what you tick." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="power-name" className="text-xs font-medium">
                Name
              </Label>
              <Input
                id="power-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                maxLength={32}
                placeholder="e.g. Greeter, Editor, Night shift"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Colour</Label>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {POWER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Colour ${c}`}
                    onClick={() => setDraft({ ...draft, color: c })}
                    className={cn(
                      "h-7 w-7 rounded-full transition-transform hover:scale-110",
                      draft.color === c && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="power-desc" className="text-xs font-medium">
              What is this role for?
            </Label>
            <Textarea
              id="power-desc"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              maxLength={240}
              placeholder="One line your members will understand."
              className="resize-none rounded-xl text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Icon</Label>
            <div className="flex flex-wrap gap-1.5">
              {POWER_ICONS.map((icon) => {
                const Icon = iconFor(icon)
                return (
                  <button
                    key={icon}
                    type="button"
                    aria-label={`Icon ${icon}`}
                    onClick={() => setDraft({ ...draft, icon })}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
                      draft.icon === icon
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-xs font-medium">Permissions</Label>
            {groups.map((group) => (
              <div key={group.group} className="rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {group.group}
                  <span className="ml-1.5 font-normal normal-case tracking-normal opacity-80">
                    — {group.hint}
                  </span>
                </p>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {group.items.map((item) => {
                    const checked = draft.permissions.includes(item.key)
                    return (
                      <label
                        key={item.key}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition-colors",
                          checked ? "bg-card shadow-sm" : "hover:bg-card/60",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-[var(--primary)]"
                          checked={checked}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              permissions: e.target.checked
                                ? [...draft.permissions, item.key]
                                : draft.permissions.filter((k) => k !== item.key),
                            })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold leading-tight">{item.label}</span>
                          <span className="block text-[11px] leading-snug text-muted-foreground">
                            {item.hint}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setDraft({ ...draft, is_default: !draft.is_default })}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
              draft.is_default ? "border-primary/50 bg-primary/10" : "border-border hover:bg-muted/40",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                draft.is_default ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              <Users0 />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">Give this role when someone joins</span>
              <span className="block text-xs text-muted-foreground">
                {draft.is_default
                  ? "Every new (and existing) member receives it automatically."
                  : "Only assigned by hand."}
              </span>
            </span>
            <span
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                draft.is_default ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all",
                  draft.is_default ? "left-[18px]" : "left-0.5",
                )}
              />
            </span>
          </button>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" className="rounded-full" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              className="rounded-full"
              disabled={busy || draft.name.trim().length < 2}
              onClick={() => onSave({ ...draft, name: draft.name.trim() })}
            >
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              {isNew ? "Create role" : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Tiny "people" glyph for the default-role toggle. */
function Users0() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

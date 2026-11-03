"use client"

import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { RefreshCw, Save, Search, ShieldCheck, Users } from "lucide-react"

type StaffRole = "developer" | "admin" | "moderator" | "user"
interface AccessUser {
  id: string
  username: string | null
  display_name: string | null
  email: string | null
  staff_role: StaffRole
  permissions: string[]
}
interface PermissionDef { key: string; label: string; description: string }
interface Draft { staff_role: StaffRole; permissions: string[] }
interface AccessAudit {
  id: string
  actor_name: string
  target_name: string
  previous_role: string
  next_role: string
  created_at: string
  previous_permissions: string[]
  next_permissions: string[]
}
const roleLabel = (role: StaffRole) => role === "user" ? "User" : role[0].toUpperCase() + role.slice(1)

export function AdminAccessControl() {
  const { user, getAuthHeader } = useAuth()
  const { toast } = useToast()
  const [users, setUsers] = useState<AccessUser[]>([])
  const [accessAudit, setAccessAudit] = useState<AccessAudit[]>([])
  const [permissions, setPermissions] = useState<PermissionDef[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [actorRole, setActorRole] = useState<StaffRole>("user")
  const [canManageRoles, setCanManageRoles] = useState(false)
  const [canAssignModerators, setCanAssignModerators] = useState(false)
  const [query, setQuery] = useState("")
  const [activeQuery, setActiveQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  const loadUsers = useCallback(async (search = activeQuery) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set("q", search.trim())
      const response = await fetch(`/api/admin/access-control?${params.toString()}`, {
        headers: getAuthHeader(),
        cache: "no-store",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not load access settings")
      const loaded = (data.users || []) as AccessUser[]
      setUsers(loaded)
      setAccessAudit((data.access_audit || []) as AccessAudit[])
      setPermissions(data.available_permissions || [])
      setActorRole(data.actor_role || "user")
      setCanManageRoles(Boolean(data.can_manage_roles))
      setCanAssignModerators(Boolean(data.can_assign_moderators))
      const next: Record<string, Draft> = {}
      for (const entry of loaded) next[entry.id] = {
        staff_role: entry.staff_role || "user",
        permissions: [...(entry.permissions || [])],
      }
      setDrafts(next)
    } catch (error) {
      toast({ title: "Access controls unavailable", description: error instanceof Error ? error.message : "Could not load access settings", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [activeQuery, getAuthHeader, toast])

  useEffect(() => { void loadUsers() }, [loadUsers])

  const updateDraft = (id: string, update: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...update } }))

  const togglePermission = (id: string, key: string) => {
    const current = drafts[id]?.permissions || []
    updateDraft(id, { permissions: current.includes(key) ? current.filter((item) => item !== key) : [...current, key] })
  }

  const hasChanges = (entry: AccessUser) => {
    const draft = drafts[entry.id]
    return Boolean(draft && (entry.staff_role !== draft.staff_role ||
      JSON.stringify([...entry.permissions].sort()) !== JSON.stringify([...draft.permissions].sort())))
  }

  const save = async (entry: AccessUser) => {
    const draft = drafts[entry.id]
    if (!draft || entry.id === user?.id) return
    setSavingId(entry.id)
    try {
      const response = await fetch("/api/admin/access-control", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ user_id: entry.id, staff_role: draft.staff_role, permissions: draft.permissions }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not update access")
      toast({ title: "Access updated", description: "The account's role and permissions were saved." })
      await loadUsers()
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : "Could not update access", variant: "destructive" })
    } finally {
      setSavingId(null)
    }
  }

  const rolesFor = (entry: AccessUser): StaffRole[] => {
    if (canManageRoles) return ["user", "developer", "admin", "moderator"]
    if (canAssignModerators && (entry.staff_role === "user" || entry.staff_role === "moderator")) return ["user", "moderator"]
    return [entry.staff_role]
  }

  return (
    <Card className="min-w-0 overflow-hidden border-border/80">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-primary" /> Roles & user permissions</CardTitle>
          <Badge variant="outline" className="ml-auto">{users.length} accounts</Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">Assign Developer, Admin and Moderator roles, then grant the exact dashboard sections each account needs. Every save is verified by the API and written to the access audit.</p>
        <form className="flex min-w-0 flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); setActiveQuery(query) }}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search username, name or email" className="pl-9" />
          </div>
          <Button type="submit" variant="outline" disabled={loading}>Search</Button>
          <Button type="button" variant="ghost" onClick={() => void loadUsers()} disabled={loading} aria-label="Refresh accounts"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </form>
        <p className="text-xs text-muted-foreground">
          {actorRole === "developer" ? "Developers manage the full role hierarchy."
            : actorRole === "admin" ? "Admins can assign Moderators and edit non-admin accounts. Developer and Admin accounts are protected."
            : "Moderators can only manage Moderation and Support permissions on regular accounts."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-14 text-sm text-muted-foreground"><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading access records…</div>
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center"><Users className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No matching accounts</p><p className="mt-1 text-xs text-muted-foreground">Try another username, name or email.</p></div>
        ) : users.map((entry) => {
          const draft = drafts[entry.id]
          const self = entry.id === user?.id
          const protectedTarget = (actorRole !== "developer" && entry.staff_role === "developer") || (actorRole === "admin" && entry.staff_role === "admin") || (actorRole === "moderator" && entry.staff_role !== "user")
          const roleDisabled = self || protectedTarget || (!canManageRoles && !canAssignModerators) || savingId === entry.id
          const restricted = actorRole === "moderator"
          return (
            <section key={entry.id} className="rounded-xl border border-border/80 p-3 sm:p-4">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{entry.display_name || entry.username || "Unnamed account"}</p>
                  <p className="truncate text-xs text-muted-foreground">{entry.username ? `@${entry.username}` : entry.email || "No public handle"}</p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant={entry.staff_role === "developer" ? "default" : "outline"}>{roleLabel(entry.staff_role)}</Badge>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Role</span>
                    <select value={draft?.staff_role || "user"} disabled={roleDisabled}
                      onChange={(event) => updateDraft(entry.id, { staff_role: event.target.value as StaffRole })}
                      className="h-9 max-w-[150px] rounded-lg border border-border bg-background px-2 text-sm text-foreground disabled:opacity-60"
                      aria-label={`Role for ${entry.username || entry.email || entry.id}`}>
                      {rolesFor(entry).map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                    </select>
                  </label>
                  {self && <Badge variant="outline">Your account</Badge>}
                </div>
              </div>
              <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {permissions.map((permission) => {
                  const limited = restricted && !["moderation", "support"].includes(permission.key)
                  return (
                    <label key={permission.key} className={`flex min-w-0 items-start gap-2.5 rounded-lg border border-border/70 p-2.5 text-left transition-colors ${limited ? "opacity-50" : "hover:bg-muted/30"}`}>
                      <Checkbox checked={draft?.permissions.includes(permission.key) || false}
                        disabled={self || protectedTarget || limited || savingId === entry.id}
                        onCheckedChange={() => togglePermission(entry.id, permission.key)} className="mt-0.5" />
                      <span className="min-w-0"><span className="block text-xs font-medium">{permission.label}</span><span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{permission.description}</span></span>
                    </label>
                  )
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                <span className="text-xs text-muted-foreground">{draft?.permissions.length || 0} section grants</span>
                <Button size="sm" onClick={() => void save(entry)} disabled={!hasChanges(entry) || savingId === entry.id || self || protectedTarget}>
                  {savingId === entry.id ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />} Save access
                </Button>
              </div>
            </section>
          )
        })}
        {actorRole !== "moderator" && (
          <section className="mt-6 space-y-3 border-t border-border/70 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Recent access changes</h3>
                <p className="mt-1 text-xs text-muted-foreground">Role and permission updates recorded by the server.</p>
              </div>
              <Badge variant="outline">{accessAudit.length} records</Badge>
            </div>
            {accessAudit.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">No access changes have been recorded yet.</p>
            ) : accessAudit.map((event) => (
              <div key={event.id} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/70 px-3 py-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{event.actor_name} updated {event.target_name}</p>
                  <p className="text-[11px] text-muted-foreground">{roleLabel((event.previous_role || "user") as StaffRole)} → {roleLabel((event.next_role || "user") as StaffRole)}</p>
                </div>
                <time dateTime={event.created_at} className="shrink-0 text-[10px] text-muted-foreground">
                  {new Date(event.created_at).toLocaleString()}
                </time>
              </div>
            ))}
          </section>
        )}
      </CardContent>
    </Card>
  )
}

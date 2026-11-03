"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Clock3,
  Loader2,
  MapPin,
  Plus,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

type EventRsvpStatus = "attending" | "pending" | "declined" | null

type CircleEvent = {
  id: string
  title: string
  description: string | null
  event_type: string
  starts_at: string
  ends_at: string | null
  max_participants: number | null
  participant_count: number
  location: string | null
  event_link: string | null
  tags: string[] | null
  requires_approval: boolean
  rsvp_status: EventRsvpStatus
  organizer_id: string
  organizer: {
    username: string | null
    display_name: string | null
    avatar_url: string | null
  } | null
}

type EventPerson = {
  user_id: string
  profile: {
    username: string | null
    display_name: string | null
    avatar_url: string | null
  } | null
  created_at: string
}

type EventManagement = {
  pending_participants: EventPerson[]
  pending_count: number
}

type EventForm = {
  title: string
  description: string
  event_type: "discussion" | "voice_chat" | "screen_share" | "game"
  starts_at: string
  ends_at: string
  max_participants: string
  location: string
  event_link: string
  tags: string
  requires_approval: boolean
}

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function initialForm(): EventForm {
  const start = new Date(Date.now() + 60 * 60_000)
  const end = new Date(start.getTime() + 60 * 60_000)
  return {
    title: "",
    description: "",
    event_type: "discussion",
    starts_at: localDateTime(start),
    ends_at: localDateTime(end),
    max_participants: "50",
    location: "",
    event_link: "",
    tags: "",
    requires_approval: false,
  }
}

function dateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Time to be announced"
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function eventTypeLabel(value: string) {
  return ({
    discussion: "Discussion",
    voice_chat: "Voice room",
    screen_share: "Co-working / screen share",
    game: "Game session",
  } as Record<string, string>)[value] || "Circle event"
}

export function CircleEvents({
  communityId,
  isMember,
}: {
  communityId: string
  isMember: boolean
}) {
  const { user, getAuthHeader } = useAuth()
  const [events, setEvents] = useState<CircleEvent[]>([])
  const [canManageEvents, setCanManageEvents] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [form, setForm] = useState<EventForm>(initialForm)
  const [saving, setSaving] = useState(false)
  const [managementId, setManagementId] = useState<string | null>(null)
  const [management, setManagement] = useState<Record<string, EventManagement>>({})
  const [managementLoading, setManagementLoading] = useState<string | null>(null)

  const endpoint = "/api/circles/" + encodeURIComponent(communityId) + "/events"

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(endpoint + "?status=upcoming&limit=8", {
        headers: getAuthHeader(),
        cache: "no-store",
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not load Circle events")
      setEvents(Array.isArray(result.events) ? result.events as CircleEvent[] : [])
      setCanManageEvents(Boolean(result.can_manage_events))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Circle events")
    } finally {
      setLoading(false)
    }
  }, [endpoint, getAuthHeader, user?.id])

  useEffect(() => {
    void load()
  }, [load])

  const changeRsvp = async (event: CircleEvent) => {
    if (!user) {
      window.location.assign("/login?redirect=" + encodeURIComponent("/communities/" + communityId))
      return
    }

    setBusyId(event.id)
    setError("")
    setNotice("")
    try {
      const response = await fetch(
        endpoint + "/" + encodeURIComponent(event.id) + "/participants",
        {
          method: event.rsvp_status === "attending" || event.rsvp_status === "pending" ? "DELETE" : "POST",
          headers: { ...getAuthHeader() },
        },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not update RSVP")
      setNotice(result.message || "RSVP updated")
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update RSVP")
    } finally {
      setBusyId(null)
    }
  }

  const loadManagement = async (eventId: string) => {
    setManagementId(eventId)
    setManagementLoading(eventId)
    setError("")
    try {
      const response = await fetch(
        endpoint + "/" + encodeURIComponent(eventId) + "/participants",
        { headers: getAuthHeader(), cache: "no-store" },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not load RSVP requests")
      setManagement((current) => ({
        ...current,
        [eventId]: {
          pending_participants: Array.isArray(result.pending_participants) ? result.pending_participants : [],
          pending_count: Number(result.pending_count) || 0,
        },
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load RSVP requests")
    } finally {
      setManagementLoading(null)
    }
  }

  const decideRequest = async (eventId: string, userId: string, action: "approve" | "decline") => {
    setBusyId(eventId + ":" + userId)
    setError("")
    try {
      const response = await fetch(
        endpoint + "/" + encodeURIComponent(eventId) + "/participants",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeader() },
          body: JSON.stringify({ user_id: userId, action }),
        },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not update this request")
      await Promise.all([loadManagement(eventId), load()])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this request")
    } finally {
      setBusyId(null)
    }
  }

  const openCreate = () => {
    setEditingEventId(null)
    setForm(initialForm())
    setCreateOpen(true)
  }

  const openEdit = (event: CircleEvent) => {
    setEditingEventId(event.id)
    setForm({
      title: event.title,
      description: event.description || "",
      event_type: (["discussion", "voice_chat", "screen_share", "game"].includes(event.event_type) ? event.event_type : "discussion") as EventForm["event_type"],
      starts_at: localDateTime(new Date(event.starts_at)),
      ends_at: event.ends_at ? localDateTime(new Date(event.ends_at)) : "",
      max_participants: event.max_participants === null ? "" : String(event.max_participants),
      location: event.location || "",
      event_link: event.event_link || "",
      tags: (event.tags || []).join(", "),
      requires_approval: event.requires_approval,
    })
    setCreateOpen(true)
  }

  const deleteEvent = async (event: CircleEvent) => {
    if (!window.confirm("Delete “" + event.title + "” and cancel all RSVPs?")) return
    setBusyId(event.id)
    setError("")
    setNotice("")
    try {
      const response = await fetch(endpoint + "?eventId=" + encodeURIComponent(event.id), {
        method: "DELETE",
        headers: getAuthHeader(),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not delete event")
      setNotice("Event deleted.")
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete event")
    } finally {
      setBusyId(null)
    }
  }

  const createEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const body = {
        ...form,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        max_participants: form.max_participants ? Number(form.max_participants) : null,
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      }
      const response = await fetch(endpoint, {
        method: editingEventId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify(editingEventId ? { ...body, eventId: editingEventId } : body),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Could not create event")
      setCreateOpen(false)
      setEditingEventId(null)
      setForm(initialForm())
      setNotice(editingEventId ? "Your event was updated." : "Your Circle event is live in the schedule.")
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create event")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-7 space-y-4" aria-labelledby="circle-events-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Do something together</p>
          <h2 id="circle-events-title" className="mt-1 text-xl font-bold tracking-tight">Upcoming events</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Set up a conversation, shared work session or game night for the Circle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="rounded-full">
            <RefreshCw className={"mr-1.5 h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} />
            Refresh
          </Button>
          {isMember && canManageEvents ? (
            <Button size="sm" onClick={openCreate} className="rounded-full">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Create event
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-2xl border border-border bg-card" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-card px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">Nothing scheduled yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Events give your Circle a reason to meet beyond the feed.
            </p>
          </div>
          {isMember && canManageEvents ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} className="rounded-full">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Plan the first event
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {events.map((event) => {
            const managed = management[event.id]
            const isBusy = busyId === event.id
            const organizer = Array.isArray(event.organizer) ? event.organizer[0] : event.organizer
            return (
              <article key={event.id} className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/30">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">
                    {eventTypeLabel(event.event_type)}
                  </span>
                  {event.requires_approval ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
                      <ShieldCheck className="h-3 w-3" /> Approval required
                    </span>
                  ) : null}
                </div>
                <h3 className="mt-3 line-clamp-2 text-base font-bold">{event.title}</h3>
                {event.description ? (
                  <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{event.description}</p>
                ) : null}
                <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" /> {dateLabel(event.starts_at)}
                  </p>
                  {event.ends_at ? (
                    <p className="flex items-center gap-2">
                      <Clock3 className="h-3.5 w-3.5 shrink-0" /> Ends {dateLabel(event.ends_at)}
                    </p>
                  ) : null}
                  {event.location ? (
                    <p className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{event.location}</span>
                    </p>
                  ) : null}
                  <p className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    {Number(event.participant_count) || 0} attending
                    {event.max_participants ? " · " + event.max_participants + " spots" : ""}
                  </p>
                </div>
                {event.tags?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {event.tags.slice(0, 5).map((tag) => (
                      <span key={tag} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">#{tag}</span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 mt-4">
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    Hosted by {organizer?.display_name || organizer?.username || "Circle member"}
                  </span>
                  {event.rsvp_status === "pending" ? (
                    <Button size="sm" variant="secondary" disabled={isBusy} onClick={() => void changeRsvp(event)} className="rounded-full">
                      <Clock3 className="mr-1.5 h-3.5 w-3.5" /> Pending · Cancel
                    </Button>
                  ) : event.rsvp_status === "attending" ? (
                    <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void changeRsvp(event)} className="rounded-full">
                      <Check className="mr-1.5 h-3.5 w-3.5" /> Going · Cancel
                    </Button>
                  ) : isMember ? (
                    <Button size="sm" disabled={isBusy} onClick={() => void changeRsvp(event)} className="rounded-full">
                      {isBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                      {event.requires_approval ? "Request a spot" : "Join event"}
                    </Button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Join the Circle to RSVP</span>
                  )}
                </div>

                {event.event_link ? (
                  <Link
                    href={event.event_link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    Event link <ArrowUpRight className="h-3 w-3" />
                  </Link>
                ) : null}

                {isMember && (canManageEvents || event.organizer_id === user?.id) ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full px-3 text-xs"
                      onClick={() => openEdit(event)}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit event
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 rounded-full px-3 text-xs text-destructive hover:text-destructive"
                      disabled={busyId === event.id}
                      onClick={() => void deleteEvent(event)}
                    >
                      {busyId === event.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                      Delete
                    </Button>
                  </div>
                ) : null}

                {isMember && (canManageEvents || event.organizer_id === user?.id) ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 rounded-full px-3 text-xs"
                      onClick={() => managed ? setManagementId(managementId === event.id ? null : event.id) : void loadManagement(event.id)}
                      disabled={managementLoading === event.id}
                    >
                      {managementLoading === event.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Users className="mr-1.5 h-3.5 w-3.5" />}
                      {managed?.pending_count ? "Review " + managed.pending_count + " requests" : "Manage RSVPs"}
                    </Button>
                    {managementId === event.id && managed ? (
                      <div className="mt-2 space-y-2 rounded-xl bg-muted/40 p-3">
                        {managed.pending_participants.length ? managed.pending_participants.map((person) => {
                          const name = person.profile?.display_name || person.profile?.username || "Circle member"
                          const requestBusy = busyId === event.id + ":" + person.user_id
                          return (
                            <div key={person.user_id} className="flex flex-wrap items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-xs font-medium">{name}</span>
                              <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-[11px]" disabled={requestBusy} onClick={() => void decideRequest(event.id, person.user_id, "decline")}>
                                <X className="mr-1 h-3 w-3" /> Decline
                              </Button>
                              <Button size="sm" className="h-7 rounded-full px-2.5 text-[11px]" disabled={requestBusy} onClick={() => void decideRequest(event.id, person.user_id, "approve")}>
                                <Check className="mr-1 h-3 w-3" /> Approve
                              </Button>
                            </div>
                          )
                        }) : (
                          <p className="text-xs text-muted-foreground">No pending RSVP requests.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{editingEventId ? "Edit Circle event" : "Plan a Circle event"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={createEvent} className="mt-6 space-y-4 pb-8">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Event title</span>
              <Input value={form.title} maxLength={120} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} placeholder="Friday co-working session" required />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Description</span>
              <Textarea value={form.description} rows={4} maxLength={2000} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} placeholder="What are we doing together?" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Event format</span>
              <select value={form.event_type} onChange={(e) => setForm((current) => ({ ...current, event_type: e.target.value as EventForm["event_type"] }))} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm">
                <option value="discussion">Discussion</option>
                <option value="voice_chat">Voice room</option>
                <option value="screen_share">Co-working / screen share</option>
                <option value="game">Game session</option>
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold">Starts</span>
                <Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm((current) => ({ ...current, starts_at: e.target.value }))} required />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold">Ends</span>
                <Input type="datetime-local" value={form.ends_at} onChange={(e) => setForm((current) => ({ ...current, ends_at: e.target.value }))} />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold">Attendee limit</span>
                <Input type="number" min="2" max="5000" value={form.max_participants} onChange={(e) => setForm((current) => ({ ...current, max_participants: e.target.value }))} placeholder="50" />
                <span className="block text-[11px] text-muted-foreground">Leave blank for no limit.</span>
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold">Location / room</span>
                <Input value={form.location} maxLength={200} onChange={(e) => setForm((current) => ({ ...current, location: e.target.value }))} placeholder="Online or a place" />
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Event link</span>
              <Input type="url" value={form.event_link} onChange={(e) => setForm((current) => ({ ...current, event_link: e.target.value }))} placeholder="https://…" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Tags</span>
              <Input value={form.tags} onChange={(e) => setForm((current) => ({ ...current, tags: e.target.value }))} placeholder="anime, study, game night" />
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-border p-3">
              <input type="checkbox" checked={form.requires_approval} onChange={(e) => setForm((current) => ({ ...current, requires_approval: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-primary" />
              <span>
                <span className="block text-sm font-semibold">Approve attendees</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">Requests stay pending until an event organizer approves them. Pending requests do not reserve a seat.</span>
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.title.trim() || !form.starts_at}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                {editingEventId ? "Save changes" : "Create event"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  )
}

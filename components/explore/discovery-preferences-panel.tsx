"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { DEFAULT_DISCOVERY_PREFERENCES, type DiscoveryPreferences } from "@/lib/discovery-preferences"
import { Plus, Sparkles, VolumeX, X } from "lucide-react"

type TopicSuggestion = { tag: string; usage_count?: number; count?: number }

export function DiscoveryPreferencesPanel({ onChanged }: { onChanged?: () => void }) {
  const { user, getAuthHeader } = useAuth()
  const { toast } = useToast()
  const [preferences, setPreferences] = useState<DiscoveryPreferences>({ ...DEFAULT_DISCOVERY_PREFERENCES })
  const [suggestions, setSuggestions] = useState<TopicSuggestion[]>([])
  const [newTopic, setNewTopic] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) { setLoading(false); return }
    let active = true
    const headers = { ...getAuthHeader() }
    Promise.all([
      fetch("/api/users/discovery-preferences", { headers, cache: "no-store" }),
      fetch("/api/explore/trending?type=hashtags&limit=12", { cache: "no-store" }),
    ]).then(async ([preferencesResponse, topicsResponse]) => {
      const [preferenceData, topicData] = await Promise.all([
        preferencesResponse.json().catch(() => ({})), topicsResponse.json().catch(() => ({})),
      ])
      if (!active) return
      if (!preferencesResponse.ok) throw new Error(preferenceData.error || "Could not load Discover preferences")
      setPreferences(preferenceData.preferences || { ...DEFAULT_DISCOVERY_PREFERENCES })
      setSuggestions(topicData.hashtags || topicData.data || [])
    }).catch((error: any) => {
      if (active) toast({ title: "Discover preferences unavailable", description: error.message, variant: "destructive" })
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user?.id])

  const save = async (next: DiscoveryPreferences) => {
    setSaving(true)
    try {
      const response = await fetch("/api/users/discovery-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeader() },
        body: JSON.stringify(next),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Could not save Discover preferences")
      setPreferences(data.preferences)
      onChanged?.()
    } catch (error: any) {
      toast({ title: "Could not save preferences", description: error.message, variant: "destructive" })
    } finally { setSaving(false) }
  }

  const addPreferredTopic = (raw: string) => {
    const topic = raw.trim().replace(/^#/, "").toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(topic)) {
      toast({ title: "Use a valid topic tag", description: "Start with a letter or number; use up to 40 letters, numbers, underscores or hyphens." })
      return
    }
    if (preferences.preferred_topics.includes(topic)) { setNewTopic(""); return }
    void save({
      ...preferences,
      preferred_topics: [...preferences.preferred_topics, topic].slice(-50),
      muted_topics: preferences.muted_topics.filter((value) => value !== topic),
    })
    setNewTopic("")
  }

  const muteTopic = (topic: string) => void save({
    ...preferences,
    muted_topics: [...preferences.muted_topics.filter((value) => value !== topic), topic].slice(-50),
    preferred_topics: preferences.preferred_topics.filter((value) => value !== topic),
  })

  const unmuteTopic = (topic: string) => void save({
    ...preferences,
    muted_topics: preferences.muted_topics.filter((value) => value !== topic),
  })

  if (!user) return null
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" /> Your Discover controls</CardTitle>
        <CardDescription>Choose topics that matter to you, mute ones you do not want recommended, or pause personalization completely.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Personalized recommendations</p>
            <p className="text-xs text-muted-foreground">Recent, Following and From Circles remain available when paused.</p>
          </div>
          <Switch checked={preferences.personalization_enabled} disabled={loading || saving}
            onCheckedChange={(enabled) => void save({ ...preferences, personalization_enabled: enabled })}
            aria-label="Enable personalized recommendations" />
        </div>
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); addPreferredTopic(newTopic) }}>
          <Input value={newTopic} onChange={(event) => setNewTopic(event.target.value)}
            placeholder="Add a topic, e.g. worldbuilding" maxLength={41} disabled={loading || saving}
            aria-label="Topic to add to your interests" />
          <Button type="submit" size="icon" disabled={loading || saving || !newTopic.trim()} aria-label="Add preferred topic">
            <Plus className="h-4 w-4" />
          </Button>
        </form>
        {preferences.preferred_topics.length > 0 && (
          <section className="space-y-2" aria-label="Preferred topics">
            <p className="text-xs font-semibold text-muted-foreground">YOUR TOPICS</p>
            <div className="flex flex-wrap gap-2">
              {preferences.preferred_topics.map((topic) => (
                <Badge key={topic} variant="secondary" className="gap-1 rounded-full px-2.5 py-1">
                  #{topic}
                  <button type="button" disabled={saving} aria-label={`Mute #${topic}`} onClick={() => muteTopic(topic)}><VolumeX className="h-3 w-3" /></button>
                  <button type="button" disabled={saving} aria-label={`Remove #${topic}`} onClick={() => void save({ ...preferences, preferred_topics: preferences.preferred_topics.filter((value) => value !== topic) })}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          </section>
        )}
        {preferences.muted_topics.length > 0 && (
          <section className="space-y-2" aria-label="Muted topics">
            <p className="text-xs font-semibold text-muted-foreground">MUTED TOPICS</p>
            <div className="flex flex-wrap gap-2">
              {preferences.muted_topics.map((topic) => (
                <Badge key={topic} variant="outline" className="gap-1 rounded-full px-2.5 py-1">
                  #{topic}
                  <button type="button" disabled={saving} aria-label={`Unmute #${topic}`} onClick={() => unmuteTopic(topic)}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
            </div>
          </section>
        )}
        {suggestions.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">DISCOVER TOPICS</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.slice(0, 12).map((suggestion) => {
                const topic = suggestion.tag.replace(/^#/, "").toLowerCase()
                const isPreferred = preferences.preferred_topics.includes(topic)
                return <Button key={topic} type="button" size="sm" variant={isPreferred ? "secondary" : "outline"}
                  disabled={loading || saving || isPreferred} onClick={() => addPreferredTopic(topic)} className="rounded-full">
                  {isPreferred ? "Added" : `+${topic}`}
                </Button>
              })}
            </div>
          </section>
        )}
        <p className="text-xs text-muted-foreground">{loading ? "Loading your preferences…" : saving ? "Saving…" : "Changes save automatically. Muted topics are excluded from personalized recommendations."}</p>
      </CardContent>
    </Card>
  )
}

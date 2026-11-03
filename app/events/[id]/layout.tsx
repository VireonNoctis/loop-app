import type { Metadata } from "next"
import type { ReactNode } from "react"
import { createClient } from "@/lib/supabase"
import { getAbsoluteAppUrl } from "@/lib/app-url"
import { buildOgMetadata } from "@/lib/og/metadata"
import { getEventShareVisibility } from "@/lib/event-sharing"

/** Event page is a client component — metadata is generated here instead. */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder",
)

interface EventLayoutProps {
  params: Promise<{ id: string }>
  children: ReactNode
}

function unavailableEventMetadata(baseUrl: string, id: string): Metadata {
  return buildOgMetadata({
    baseUrl,
    path: `/events/${id}`,
    type: "event",
    title: "An event on LOOP",
    description: "Events on LOOP bring communities together — live, scheduled and shared.",
    robots: { index: false, follow: false },
    params: { category: "Event", url: "loopapp.me/events" },
  })
}

export async function generateMetadata({ params }: EventLayoutProps): Promise<Metadata> {
  const { id } = await params
  const baseUrl = await getAbsoluteAppUrl()

  try {
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, title, description, category, cover_image, banner_url, start_time, starts_at, visibility, is_private, allow_type, circle_id")
      .eq("id", id)
      .maybeSingle()

    if (eventError || !event) return unavailableEventMetadata(baseUrl, id)

    let circle: { is_private?: boolean; is_active?: boolean; is_premium_only?: boolean } | null = null
    if (event.circle_id) {
      const { data, error } = await supabase.from("circles")
        .select("is_private, is_active, is_premium_only")
        .eq("id", event.circle_id)
        .maybeSingle()
      if (error || !data) return unavailableEventMetadata(baseUrl, id)
      circle = data
    }

    const shareVisibility = getEventShareVisibility(event, circle)
    if (!shareVisibility) return unavailableEventMetadata(baseUrl, id)

    const title = String(event.title || "An event on LOOP").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 90)
    const description = String(event.description || "Events on LOOP bring communities together — live, scheduled and shared.")
      .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 170)
    const category = String(event.category || "Event").slice(0, 40)
    const cover = String(event.cover_image || event.banner_url || "")
    const start = event.start_time || event.starts_at
    let when = ""
    let dateBlock: { day: string; month: string } | undefined
    if (start) {
      const date = new Date(start)
      if (!Number.isNaN(date.getTime())) {
        when = date.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
        dateBlock = {
          day: date.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" }),
          month: date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
        }
      }
    }

    return buildOgMetadata({
      baseUrl,
      path: `/events/${id}`,
      type: "event",
      title,
      description,
      ...(shareVisibility === "unlisted" ? { robots: { index: false, follow: false } } : {}),
      params: {
        category,
        date: when,
        date_day: dateBlock?.day,
        date_month: dateBlock?.month,
        media: cover,
        name: title,
        url: "loopapp.me/events",
      },
    })
  } catch (error) {
    console.error("Error generating event metadata:", error)
    return unavailableEventMetadata(baseUrl, id)
  }
}

export default function EventLayout({ children }: EventLayoutProps) {
  return children
}

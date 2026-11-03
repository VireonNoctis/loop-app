"use client"

import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Flag } from "lucide-react"
import { useState } from "react"
import { useToast } from "@/hooks/use-toast"

interface ReportContentButtonProps {
  contentType: "loop" | "profile" | "comment" | "circle_post" | "message" | string
  contentId: string
  variant?: "menu" | "button" | "icon"
  label?: string
  className?: string
}

export function ReportContentButton({
  contentType,
  contentId,
  variant = "menu",
  label = "Report",
  className,
}: ReportContentButtonProps) {
  const [open, setOpen] = useState(false)
  const [flagType, setFlagType] = useState("")
  const [description, setDescription] = useState("")
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const { user, getAuthHeader } = useAuth()

  const flagTypes = [
    { value: "spam", label: "Spam" },
    { value: "harassment", label: "Harassment" },
    { value: "inappropriate", label: "Inappropriate Content" },
    { value: "misinformation", label: "Misinformation" },
    { value: "copyright", label: "Copyright Violation" },
    { value: "other", label: "Other" },
  ]

  const handleSubmit = async () => {
    if (!user) {
      toast({ title: "Sign in required", description: "Log in to report content.", variant: "destructive" })
      return
    }
    if (!flagType) {
      toast({ title: "Pick a reason", description: "Select why you're reporting this.", variant: "destructive" })
      return
    }

    setLoading(true)
    try {
      const response = await fetch("/api/moderation/flags", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          content_type: contentType,
          content_id: contentId,
          flag_type: flagType,
          description,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Failed to submit report")

      toast({ title: "Report submitted", description: "Thanks — our team will review it." })
      setOpen(false)
      setFlagType("")
      setDescription("")
    } catch (error: any) {
      toast({ title: "Could not report", description: error.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "icon" ? (
          <Button size="icon" variant="ghost" className={className} aria-label={label}>
            <Flag className="h-4 w-4" />
          </Button>
        ) : variant === "button" ? (
          <Button variant="outline" className={className}>
            <Flag className="mr-2 h-4 w-4" />
            {label}
          </Button>
        ) : (
          <button
            type="button"
            className={className || "flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm text-red-500 dark:text-red-300 hover:bg-muted"}
            onClick={(e) => e.stopPropagation()}
          >
            <Flag className="mr-2 h-4 w-4" />
            {label}
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="border-border bg-popover text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report {contentType.replace("_", " ")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Select value={flagType} onValueChange={setFlagType}>
            <SelectTrigger className="border-border bg-muted">
              <SelectValue placeholder="Why are you reporting this?" />
            </SelectTrigger>
            <SelectContent>
              {flagTypes.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            placeholder="Optional details..."
            className="min-h-[100px] border-border bg-muted"
          />
          <p className="text-right text-xs text-muted-foreground">{description.length}/1000</p>
          <Button onClick={handleSubmit} disabled={loading} className="w-full bg-red-600 hover:bg-red-500">
            {loading ? "Submitting..." : "Submit report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { DynamicButton } from "@/components/ui/dynamic-button"
import { MagneticDropZone } from "@/components/ui/magnetic-drop-zone"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CODE_LANGUAGES } from "@/lib/pro-features"
import { MentionTextarea } from "@/components/mentions/mention-textarea"
import { useLoginGate } from "@/hooks/use-login-gate"
import { uploadMediaFile } from "@/lib/client-media-upload"
import { parseJsonResponse } from "@/lib/parse-json-response"
import { cn } from "@/lib/utils"
import {
  Code,
  Crop,
  Eye,
  EyeOff,
  FileText,
  Hash,
  ImageIcon,
  LogIn,
  Mic,
  Music,
  Plus,
  Save,
  Square,
  Upload,
  Video,
  X,
  Vote,
  Swords,
  Zap,
} from "lucide-react"
import ArrowNarrowRightIcon from "@/components/icons/animated/arrow-narrow-right-icon"
import { CreateDuelDialog } from "@/components/duels/create-duel-dialog"
import { CreateClutchDuelDialog } from "@/components/duels/create-clutch-duel-dialog"

const DRAFT_KEY = "loop-composer-draft-v1"

interface CreateLoopButtonProps {
  onLoopCreated?: () => void
  defaultOpen?: boolean
  isFab?: boolean
}

type MediaType = "text" | "image" | "video" | "audio" | "code" | "poll" | "moment"

export function CreateLoopButton({ onLoopCreated, defaultOpen = false, isFab = false }: CreateLoopButtonProps) {
  const { user, getAuthHeader } = useAuth()
  const { toast } = useToast()
  const { requireAuth, isGuest, LoginGateDialog } = useLoginGate()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [content, setContent] = useState("")
  const [hashtags, setHashtags] = useState("")
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<MediaType>("text")
  const [codeLanguage, setCodeLanguage] = useState("javascript")
  const [codeTitle, setCodeTitle] = useState("")
  const [pollQuestion, setPollQuestion] = useState("")
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""])
  const [duelDialogOpen, setDuelDialogOpen] = useState(false)
  const [clutchDuelDialogOpen, setClutchDuelDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [cropScale, setCropScale] = useState(1)
  const [discardOpen, setDiscardOpen] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [isSpoiler, setIsSpoiler] = useState(false)
  const authToken = user?.access_token || user?.token

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw)
      if (draft.content || draft.hashtags) {
        setContent(draft.content || "")
        setHashtags(draft.hashtags || "")
        setMediaType(draft.mediaType || "text")
        if (!defaultOpen && (draft.content || draft.hashtags)) setIsOpen(true)
        toast({ title: "Draft restored", description: "We restored your unfinished loop." })
      }
    } catch {
      // ignore
    }
  }, [defaultOpen, toast])

  useEffect(() => {
    const payload = { content, hashtags, mediaType, updatedAt: Date.now() }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
  }, [content, hashtags, mediaType])

  useEffect(() => {
    if (!mediaFiles[0]) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(mediaFiles[0])
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [mediaFiles])

  useEffect(() => {
    const loadSuggestions = async () => {
      try {
        const res = await fetch("/api/explore/trending?type=hashtags&limit=8")
        if (!res.ok) return
        const data = await res.json()
        const tags = (data.hashtags || data.data || [])
          .map((item: any) => String(item.tag || item.name || item).replace(/^#/, ""))
          .filter(Boolean)
        setSuggestions(tags)
      } catch {
        setSuggestions(["design", "creativity", "loops", "music", "tech", "art"])
      }
    }
    void loadSuggestions()
  }, [])

  const extractedTags = useMemo(() => {
    const fromField = hashtags.split(/[ ,#]+/).filter(Boolean)
    const fromContent = Array.from(content.matchAll(/#([a-zA-Z0-9_]+)/g)).map((m) => m[1])
    return Array.from(new Set([...fromField, ...fromContent].map((t) => t.toLowerCase())))
  }, [content, hashtags])

  const getMaxFiles = () => (user?.is_premium ? 10 : user?.is_verified ? 4 : 1)

  const clearDraft = () => localStorage.removeItem(DRAFT_KEY)

  const applyCropToImage = async (file: File) => {
    if (!file.type.startsWith("image/") || cropScale === 1) return file
    const img = document.createElement("img")
    const objectUrl = URL.createObjectURL(file)
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("Could not load image"))
      img.src = objectUrl
    })
    const canvas = canvasRef.current || document.createElement("canvas")
    const size = Math.min(img.width, img.height) / cropScale
    const sx = (img.width - size) / 2
    const sy = (img.height - size) / 2
    canvas.width = Math.min(1080, size)
    canvas.height = Math.min(1080, size)
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    ctx.drawImage(img, sx, sy, size, size, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(objectUrl)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!requireAuth("post")) return
    if (!user || !authToken) return
    setCreating(true)
    try {
      let res: Response
      const tags = extractedTags

      if (mediaType === "moment") {
        // Create Moment post directly
        if (mediaFiles.length > 0) {
          const prepared = await applyCropToImage(mediaFiles[0])
          setUploadStatus("Uploading...")
          const uploaded = await uploadMediaFile(prepared, {
            type: prepared.type.startsWith("video") ? "video" : "image",
            folder: "moments",
            authHeaders: { Authorization: `Bearer ${authToken}`, ...getAuthHeader() },
          })
          setUploadStatus(null)

          res = await fetch("/api/moments", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
              ...getAuthHeader(),
            },
            body: JSON.stringify({
              media_url: uploaded.url,
              media_type: prepared.type.startsWith("video") ? "video" : "image",
              content: content,
              hours: 24,
            }),
          })
        } else {
          res = await fetch("/api/moments", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
              ...getAuthHeader(),
            },
            body: JSON.stringify({
              content: content,
              media_type: "text",
              hours: 24,
            }),
          })
        }
      } else if (mediaFiles.length > 0) {
        // Upload every file in parallel straight to Cloudinary (video/large
        // files go direct via a signed upload, bypassing the Next.js API
        // route entirely) instead of bundling all raw files into one
        // multipart POST to /api/loops. That old path uploaded files one at
        // a time on the server via base64, which was slow for multiple
        // files/video and could exceed Vercel's ~4.5MB request body limit —
        // when that happened, Vercel returned a plain-text/HTML error that
        // the old `res.json()` call couldn't parse, surfacing as a generic
        // "JSON error" instead of a real message.
        setUploadStatus(mediaFiles.length > 1 ? `Uploading 0/${mediaFiles.length}...` : "Uploading...")
        let uploadedCount = 0
        const authHeaders = { Authorization: `Bearer ${authToken}`, ...getAuthHeader() }
        const uploadResults = await Promise.all(
          mediaFiles.map(async (file) => {
            const prepared = await applyCropToImage(file)
            const uploaded = await uploadMediaFile(prepared, {
              type: prepared.type.startsWith("video")
                ? "video"
                : prepared.type.startsWith("audio")
                  ? "audio"
                  : prepared.type.startsWith("image")
                    ? "image"
                    : "file",
              folder: "loops",
              authHeaders,
            })
            uploadedCount += 1
            setUploadStatus(mediaFiles.length > 1 ? `Uploading ${uploadedCount}/${mediaFiles.length}...` : "Uploading...")
            return uploaded
          }),
        )
        setUploadStatus("Publishing...")

        const firstFile = mediaFiles[0]
        const resolvedMediaType = firstFile.type.startsWith("video")
          ? "video"
          : firstFile.type.startsWith("audio")
            ? "audio"
            : firstFile.type.startsWith("image")
              ? "image"
              : mediaType

        res = await fetch("/api/loops", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            ...getAuthHeader(),
          },
          body: JSON.stringify({
            content_text: content,
            content_type: resolvedMediaType,
            hashtags: tags,
            media_url: uploadResults[0]?.url,
            media_urls: uploadResults.map((u) => u.url),
            is_spoiler: isSpoiler,
          }),
        })
      } else {
        res = await fetch("/api/loops", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
            ...getAuthHeader(),
          },
          body: JSON.stringify({
            content_text: content,
            content_title: mediaType === "code" ? codeTitle.trim() || null : null,
            content_type: mediaType === "poll" ? "poll" : mediaType,
            post_type: mediaType === "poll" ? "poll" : "standard",
            category: mediaType === "code" ? "code" : mediaType === "poll" ? "poll" : "general",
            hashtags: tags,
            is_spoiler: isSpoiler,
            content_metadata:
              mediaType === "code"
                ? {
                    is_code: true,
                    language: codeLanguage,
                    forks_count: 0,
                  }
                : undefined,
          }),
        })
      }

      const { data: result } = await parseJsonResponse<any>(res)
      if (!res.ok) throw new Error(result?.error || res.statusText)

      const loopId = result.loop?.id

      // If poll type, create poll attached to the loop
      if (mediaType === "poll" && loopId && pollQuestion.trim()) {
        const validOptions = pollOptions.filter((o) => o.trim().length > 0)
        if (validOptions.length >= 2) {
          await fetch("/api/polls", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
              ...getAuthHeader(),
            },
            body: JSON.stringify({
              loopId,
              question: pollQuestion,
              options: validOptions,
            }),
          })
        }
      }

      setContent("")
      setHashtags("")
      setMediaFiles([])
      setMediaType("text")
      setCodeTitle("")
      setCodeLanguage("javascript")
      setShowPreview(false)
      setCropScale(1)
      setIsSpoiler(false)
      setIsOpen(false)
      clearDraft()
      toast({ title: "Loop created", description: "Your loop is live on the feed." })
      window.dispatchEvent(new Event("loop-created"))
      if (onLoopCreated) onLoopCreated()
      else router.refresh()
    } catch (err: any) {
      toast({ title: "Failed to create loop", description: err.message || "Something went wrong", variant: "destructive" })
    } finally {
      setCreating(false)
      setUploadStatus(null)
    }
  }

  const handleSelectedFiles = (selected: File[]) => {
    if (!selected.length) return
    const maxFiles = getMaxFiles()
    const combined = [...mediaFiles, ...selected].slice(0, maxFiles)
    if (mediaFiles.length + selected.length > maxFiles) {
      toast({
        title: "File limit reached",
        description: `Up to ${maxFiles} files allowed ${user?.is_premium ? "(Pro)" : "(Upgrade to Pro for up to 10 files)"}.`,
      })
    }
    setMediaFiles(combined)
    const first = combined[0]
    if (first.type.startsWith("image/")) setMediaType("image")
    else if (first.type.startsWith("video/")) setMediaType("video")
    else if (first.type.startsWith("audio/")) setMediaType("audio")
    else setMediaType("code")
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleSelectedFiles(Array.from(e.target.files || []))
    e.target.value = ""
  }

  const removeFile = (index: number) => {
    setMediaFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const toggleAudioRecord = async () => {
    if (recording && recorderRef.current) {
      recorderRef.current.stop()
      setRecording(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: "audio/webm" })
        const file = new File([blob], `loop-voice-${Date.now()}.webm`, { type: "audio/webm" })
        setMediaType("audio")
        setMediaFiles([file])
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setMediaType("audio")
    } catch {
      toast({
        title: "Microphone blocked",
        description: "Allow mic access to record audio loops.",
        variant: "destructive",
      })
    }
  }

  const addSuggestion = (tag: string) => {
    const next = Array.from(new Set([...extractedTags, tag.toLowerCase()]))
    setHashtags(next.join(" "))
  }

  if (!isOpen) {
    if (isFab) {
      return (
        <>
          {LoginGateDialog}
          <button
            type="button"
            onClick={() => {
              if (!requireAuth("post")) return
              setIsOpen(true)
            }}
            className="fixed bottom-20 right-5 z-40 sm:bottom-6 sm:right-6 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-violet-600 text-white shadow-2xl transition-transform hover:scale-105 active:scale-95 border border-white/20 focus:outline-none"
            aria-label="Create Loop"
          >
            <Plus className="h-7 w-7" />
          </button>
        </>
      )
    }

    return (
      <>
        {LoginGateDialog}
        <Card
          className="cursor-pointer border-border/70 bg-card/60 transition hover:bg-muted/40"
          onClick={() => {
            if (!requireAuth("post")) return
            setIsOpen(true)
          }}
        >
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-sky-600 to-violet-600">
                {isGuest ? <LogIn className="h-5 w-5 text-white" /> : <Plus className="h-5 w-5 text-white" />}
              </div>
              <div>
                <p className="text-muted-foreground">
                  {isGuest
                    ? "Sign in to post a loop"
                    : `What's on your mind, ${user?.display_name || "friend"}?`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isGuest ? "Browse freely — posting needs an account" : "Drafts auto-save as you type"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </>
    )
  }

  return (
    <>
      {LoginGateDialog}
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500 shadow-md shadow-violet-900/30">
              <FileText className="h-4 w-4 text-white" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-foreground">Create a Loop</h3>
              <p className="truncate text-[11px] text-muted-foreground">
                {mediaType === "code"
                  ? "Share a forkable snippet"
                  : mediaType === "poll"
                    ? "Ask the community"
                    : "Share a story, idea, or moment"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setShowPreview((v) => !v)}>
              <Eye className="mr-1 h-4 w-4" /> {showPreview ? "Edit" : "Preview"}
            </Button>
            <Button type="button" size="icon" variant="ghost" onClick={() => setDiscardOpen(true)} title="Close composer">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {showPreview ? (
          <div className="rounded-2xl border border-border bg-muted/30 p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Preview</p>
            <p className="mb-3 whitespace-pre-wrap text-foreground">{content || "No text yet"}</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {extractedTags.map((tag) => (
                <Badge key={tag} variant="secondary">#{tag}</Badge>
              ))}
            </div>
            {previewUrl && mediaType === "image" && (
              <img src={previewUrl} alt="preview" className="max-h-72 w-full rounded-xl object-cover" style={{ transform: `scale(${cropScale})` }} />
            )}
            {previewUrl && mediaType === "video" && <video src={previewUrl} controls className="max-h-72 w-full rounded-xl" />}
            {previewUrl && mediaType === "audio" && <audio src={previewUrl} controls className="w-full" />}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mediaType === "code" ? (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_160px]">
                  <Input
                    value={codeTitle}
                    onChange={(e) => setCodeTitle(e.target.value)}
                    placeholder="Snippet title (optional)"
                    className="border-border bg-muted"
                    maxLength={80}
                  />
                  <select
                    value={codeLanguage}
                    onChange={(e) => setCodeLanguage(e.target.value)}
                    className="h-10 rounded-md border border-border bg-muted px-3 text-sm"
                  >
                    {CODE_LANGUAGES.map((lang) => (
                      <option key={lang.id} value={lang.id}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={`// Paste your ${codeLanguage} code here…\nfunction hello() {\n  return "Loop";\n}`}
                  className="min-h-[220px] border-border bg-muted font-mono text-sm text-foreground"
                  maxLength={12000}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{content.length}/12000 · others can fork, like, comment, or branch</span>
                  <span className="inline-flex items-center gap-1"><Save className="h-3 w-3" /> Draft saved</span>
                </div>
              </div>
            ) : (
              <>
                {/* Markdown Formatting Quick Toolbar */}
                <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-muted/40 p-1.5 text-xs">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-500 flex items-center gap-1 mr-1 px-1">
                    <Zap className="h-3.5 w-3.5" /> Markdown
                  </span>
                  <button
                    type="button"
                    onClick={() => setContent((prev) => prev + " **bold**")}
                    className="rounded px-2 py-0.5 font-bold hover:bg-muted border border-border/50 text-foreground"
                    title="Bold (**text**)"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => setContent((prev) => prev + " *italic*")}
                    className="rounded px-2 py-0.5 italic hover:bg-muted border border-border/50 text-foreground"
                    title="Italic (*text*)"
                  >
                    I
                  </button>
                  <button
                    type="button"
                    onClick={() => setContent((prev) => prev + "\n# Heading")}
                    className="rounded px-2 py-0.5 font-extrabold hover:bg-muted border border-border/50 text-foreground"
                    title="Heading (# text)"
                  >
                    H1
                  </button>
                  <button
                    type="button"
                    onClick={() => setContent((prev) => prev + " ~~strikethrough~~")}
                    className="rounded px-2 py-0.5 line-through hover:bg-muted border border-border/50 text-foreground"
                    title="Strikethrough (~~text~~)"
                  >
                    S
                  </button>
                  <button
                    type="button"
                    onClick={() => setContent((prev) => prev + "\n> blockquote")}
                    className="rounded px-2 py-0.5 hover:bg-muted border border-border/50 text-foreground font-serif"
                    title="Blockquote (> text)"
                  >
                    &ldquo;
                  </button>
                  <button
                    type="button"
                    onClick={() => setContent((prev) => prev + " `code`")}
                    className="rounded px-2 py-0.5 font-mono text-[10px] hover:bg-muted border border-border/50 text-foreground"
                    title="Inline Code (`text`)"
                  >
                    &lt;/&gt;
                  </button>
                  <button
                    type="button"
                    onClick={() => setContent((prev) => prev + "\n---\n")}
                    className="rounded px-2 py-0.5 hover:bg-muted border border-border/50 text-foreground"
                    title="Horizontal Divider (---)"
                  >
                    &mdash;
                  </button>
                </div>

                <MentionTextarea
                  value={content}
                  onChange={setContent}
                  placeholder="Share a story, idea, or tag someone with @username… (Markdown supported)"
                  className="min-h-[140px] border-border bg-muted"
                  maxLength={user?.is_premium ? 10000 : 3000}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className={content.trim().split(/\s+/).filter(Boolean).length > (user?.is_premium ? 1800 : 500) ? "text-rose-500 font-bold" : ""}>
                    {content.trim() ? content.trim().split(/\s+/).filter(Boolean).length : 0} / {user?.is_premium ? "1800" : "500"} words
                    {user?.is_premium ? " (Pro Limit)" : " (500 Word Limit)"}
                  </span>
                  <span className="inline-flex items-center gap-1"><Save className="h-3 w-3" /> Draft saved</span>
                </div>
              </>
            )}

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-cyan-300" />
                <Input
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  placeholder="design creativity storytelling"
                  className="border-border bg-muted"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => addSuggestion(tag)}
                    className="rounded-full border border-border bg-muted px-2.5 py-1 text-muted-foreground hover:bg-muted"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { type: "text" as const, icon: FileText, label: "Text" },
                { type: "image" as const, icon: ImageIcon, label: "Image" },
                { type: "video" as const, icon: Video, label: "Video" },
                { type: "audio" as const, icon: Music, label: "Audio" },
                { type: "code" as const, icon: Code, label: "Code" },
                { type: "poll" as const, icon: Vote, label: "Poll" },
                { type: "moment" as const, icon: Zap, label: "Moment" },
              ].map((item) => (
                <Button
                  key={item.type}
                  type="button"
                  size="sm"
                  variant={mediaType === item.type ? "default" : "outline"}
                  className={
                    mediaType === item.type
                      ? "border-transparent bg-gradient-to-r from-violet-600 to-cyan-500 text-white shadow-md shadow-violet-900/20"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }
                  onClick={() => setMediaType(item.type)}
                >
                  <item.icon className="mr-1 h-4 w-4" />
                  {item.label}
                </Button>
              ))}

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-amber-500/40 text-amber-300 hover:bg-amber-500/20"
                onClick={() => setDuelDialogOpen(true)}
              >
                <Swords className="mr-1 h-4 w-4 text-amber-400" />
                Duel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-violet-500/50 bg-violet-500/10 text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.25)] hover:bg-violet-500/25"
                onClick={() => setClutchDuelDialogOpen(true)}
              >
                <Zap className="mr-1 h-4 w-4 fill-amber-400 text-amber-400" />
                Clutch Duel
              </Button>
            </div>

            {mediaType === "poll" && (
              <div className="p-4 rounded-xl border border-cyan-500/30 bg-cyan-950/20 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-cyan-300">Poll Question</label>
                  <Input
                    value={pollQuestion}
                    onChange={(e) => setPollQuestion(e.target.value)}
                    placeholder="e.g. What is your favorite state management solution?"
                    className="bg-muted border-border text-foreground rounded-xl text-xs"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground">Poll Options (2 to 4)</label>
                  {pollOptions.map((opt, idx) => (
                    <Input
                      key={idx}
                      value={opt}
                      onChange={(e) => {
                        const copy = [...pollOptions]
                        copy[idx] = e.target.value
                        setPollOptions(copy)
                      }}
                      placeholder={`Option ${idx + 1}`}
                      className="bg-muted border-border text-foreground rounded-xl text-xs"
                    />
                  ))}
                  {pollOptions.length < 4 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPollOptions([...pollOptions, ""])}
                      className="text-xs text-cyan-400 hover:text-cyan-300 p-0 h-auto"
                    >
                      + Add Option
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-dashed border-border p-4">
              {mediaType === "code" ? (
                <p className="text-center text-sm text-muted-foreground">
                  Code loops publish as text snippets — no media upload needed. Peers can fork your code into their profile.
                </p>
              ) : (
                <>
                  <MagneticDropZone onFiles={handleSelectedFiles}>
                    <label className="flex cursor-pointer flex-col items-center gap-2 text-sm text-muted-foreground border border-dashed border-border rounded-2xl p-4 hover:bg-muted/60 transition-colors">
                    <Upload className="h-5 w-5 text-violet-400" />
                    <span>Upload media ({getMaxFiles()} file limit{user?.is_premium ? " · Pro" : ""})</span>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,video/*,audio/*"
                      multiple={getMaxFiles() > 1}
                      onChange={handleFileChange}
                    />
                  </label>
                  </MagneticDropZone>
                  {(mediaType === "audio" || mediaType === "text") && (
                    <div className="mt-3 flex justify-center">
                      <Button
                        type="button"
                        size="sm"
                        variant={recording ? "destructive" : "outline"}
                        className="border-border"
                        onClick={toggleAudioRecord}
                      >
                        {recording ? <Square className="mr-1.5 h-3.5 w-3.5" /> : <Mic className="mr-1.5 h-3.5 w-3.5" />}
                        {recording ? "Stop recording" : "Record audio"}
                      </Button>
                    </div>
                  )}
                  {mediaFiles.length > 0 && (
                    <div className="mt-3 space-y-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{mediaFiles.length} of {getMaxFiles()} files selected</span>
                        {mediaFiles.length < getMaxFiles() && (
                          <label className="cursor-pointer text-violet-400 font-semibold hover:underline">
                            + Add more files
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*,video/*,audio/*"
                              multiple={getMaxFiles() > 1}
                              onChange={handleFileChange}
                            />
                          </label>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {mediaFiles.map((file, idx) => (
                          <div key={idx} className="relative group rounded-xl overflow-hidden border border-border bg-muted p-1">
                            {file.type.startsWith("image/") ? (
                              <img
                                src={URL.createObjectURL(file)}
                                alt={file.name}
                                className="h-28 w-full object-cover rounded-lg"
                              />
                            ) : file.type.startsWith("video/") ? (
                              <video
                                src={URL.createObjectURL(file)}
                                className="h-28 w-full object-cover rounded-lg"
                              />
                            ) : (
                              <div className="flex h-28 items-center justify-center bg-muted text-xs text-muted-foreground p-2 text-center truncate rounded-lg">
                                {file.name}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => removeFile(idx)}
                              className="absolute top-2 right-2 rounded-full bg-black/80 p-1.5 text-white hover:bg-rose-600 transition-colors shadow-md"
                              title="Remove file"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {(mediaType === "image" || mediaType === "video" || mediaType === "audio") && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setIsSpoiler((v) => !v)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg border transition-all",
                    isSpoiler
                      ? "border-amber-500/60 bg-amber-500/20 text-amber-400"
                      : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  <EyeOff className="h-3.5 w-3.5" />
                </button>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-amber-300">Mark as Spoiler</p>
                  <p className="text-[10px] text-muted-foreground">Media will be blurred until tapped</p>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse items-stretch justify-end gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center">
              <span className="hidden flex-1 items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
                <Zap className="h-3 w-3 text-violet-400" />
                Drafts save automatically — nothing gets lost while you write.
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="border-border" onClick={() => setDiscardOpen(true)}>
                  Cancel
                </Button>
                <DynamicButton
                  type="submit"
                  feedback="press"
                  stateKey={creating ? uploadStatus || "publishing" : "create"}
                  icon={creating ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : <ArrowNarrowRightIcon size={16} /> }
                  disabled={creating || (!content.trim() && mediaFiles.length === 0)}
                  className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  {creating ? uploadStatus || "Publishing..." : "Create Loop"}
                </DynamicButton>
              </div>
            </div>
          </form>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </CardContent>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Close composer?"
        description="Your draft stays saved locally until you publish or clear it."
        confirmLabel="Close"
        onConfirm={() => {
          setIsOpen(false)
          setDiscardOpen(false)
        }}
      />

      <CreateDuelDialog
        open={duelDialogOpen}
        onOpenChange={setDuelDialogOpen}
        onDuelCreated={() => {
          if (onLoopCreated) onLoopCreated()
          else router.refresh()
        }}
      />

      <CreateClutchDuelDialog
        open={clutchDuelDialogOpen}
        onOpenChange={setClutchDuelDialogOpen}
        onDuelCreated={() => {
          if (onLoopCreated) onLoopCreated()
          else router.refresh()
        }}
      />
    </Card>
    </>
  )
}

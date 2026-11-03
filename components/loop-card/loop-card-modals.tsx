"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Zap, Users, ChevronLeft, ChevronRight, Volume2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AvatarWithFrame } from "@/components/ui/avatar-with-frame"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { HoldToConfirmButton } from "@/components/ui/hold-to-confirm-button"
import { Textarea } from "@/components/ui/textarea"
import { GiftModal } from "@/components/gifting/gift-modal"
import { CreateBranchDialog } from "@/components/create-branch-dialog"
import { BranchSettingsDialog } from "@/components/loops/branch-settings-dialog"
import { LoopChainDialog } from "@/components/loops/loop-chain-dialog"
import { BoostLoopDialog } from "@/components/loops/boost-loop-dialog"
import { ShareToDmModal } from "@/components/messages/share-to-dm-modal"
import { ShareToCircleModal } from "@/components/messages/share-to-circle-modal"
import { ShareAsImageModal } from "@/components/engagement/share-as-image-modal"
import { EnhancedShareSheet } from "@/components/engagement/enhanced-share-sheet"
import { ProtectedMedia } from "@/components/media-protection"
import type { QuotedLoop } from "@/components/loops/quoted-loop-card"

interface LoopCardModalsProps {
  loop: any
  rawLoop: any
  content: string
  // Gift modal
  showGiftModal: boolean
  setShowGiftModal: (v: boolean) => void
  // Branch dialog
  showBranchDialog: boolean
  setShowBranchDialog: (v: boolean) => void
  // Delete
  deleteOpen: boolean
  setDeleteOpen: (v: boolean) => void
  confirmDelete: () => void
  // Edit
  editOpen: boolean
  setEditOpen: (v: boolean) => void
  editContent: string
  setEditContent: (v: string) => void
  savingEdit: boolean
  saveEdit: () => void
  // Viewer
  viewerOpen: boolean
  setViewerOpen: (v: boolean) => void
  currentMediaIndex: number
  setCurrentMediaIndex: (fn: (prev: number) => number) => void
  // Roster
  rosterOpen: boolean
  setRosterOpen: (v: boolean) => void
  coAuthors: any[]
  // Chain
  chainDialogOpen: boolean
  setChainDialogOpen: (v: boolean) => void
  // Branch settings
  branchSettingsOpen: boolean
  setBranchSettingsOpen: (v: boolean) => void
  onBranchSettingsSaved?: (loop: any) => void
  // Boost
  boostDialogOpen: boolean
  setBoostDialogOpen: (v: boolean) => void
  boostCoinsCurrent: number
  setBoostCoinsCurrent: (v: number) => void
  setIsBoosted: (v: boolean) => void
  // Share modals
  shareDmOpen: boolean
  setShareDmOpen: (v: boolean) => void
  shareCircleOpen: boolean
  setShareCircleOpen: (v: boolean) => void
  shareImageOpen: boolean
  setShareImageOpen: (v: boolean) => void
  shareSheetOpen: boolean
  setShareSheetOpen: (v: boolean) => void
  /** The original post a quote rebranch embeds, when this post is one. */
  quoted?: QuotedLoop | null
}

export function LoopCardModals({
  loop,
  rawLoop,
  content,
  showGiftModal,
  setShowGiftModal,
  showBranchDialog,
  setShowBranchDialog,
  deleteOpen,
  setDeleteOpen,
  confirmDelete,
  editOpen,
  setEditOpen,
  editContent,
  setEditContent,
  savingEdit,
  saveEdit,
  viewerOpen,
  setViewerOpen,
  currentMediaIndex,
  setCurrentMediaIndex,
  rosterOpen,
  setRosterOpen,
  coAuthors,
  chainDialogOpen,
  setChainDialogOpen,
  branchSettingsOpen,
  setBranchSettingsOpen,
  onBranchSettingsSaved,
  boostDialogOpen,
  setBoostDialogOpen,
  boostCoinsCurrent,
  setBoostCoinsCurrent,
  setIsBoosted,
  shareDmOpen,
  setShareDmOpen,
  shareCircleOpen,
  setShareCircleOpen,
  shareImageOpen,
  setShareImageOpen,
  shareSheetOpen,
  setShareSheetOpen,
  quoted,
}: LoopCardModalsProps) {
  const router = useRouter()

  const mediaUrls = loop.media_urls || (loop.media_url ? [loop.media_url] : [])

  return (
    <>
      {/* Gift Modal */}
      <GiftModal
        open={showGiftModal}
        onOpenChange={setShowGiftModal}
        recipient={{
          id: loop.author.id,
          username: loop.author.username,
          display_name: loop.author.display_name,
          avatar_url: loop.author.avatar_url,
        }}
        context={{
          type: "post",
          id: loop.id,
          title: content.substring(0, 50) + (content.length > 50 ? "..." : ""),
        }}
      />

      {/* Branch Dialog */}
      <CreateBranchDialog
        open={showBranchDialog}
        onOpenChange={setShowBranchDialog}
        parentLoop={loop}
        onBranchCreated={(branchId) => router.push(`/loop/${branchId}`)}
      />

      {/* Branch settings (owner only) */}
      <BranchSettingsDialog
        loop={loop}
        open={branchSettingsOpen}
        onOpenChange={setBranchSettingsOpen}
        onSaved={onBranchSettingsSaved}
      />

      {/* Irreversible deletion requires a deliberate hold, not a stray tap. */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl border-border bg-popover text-foreground sm:max-w-md">
          <AlertDialogHeader className="gap-2">
            <AlertDialogTitle>Delete this Loop?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
              This cannot be undone. Branches from other people may remain. Press and hold the button to confirm; releasing early cancels the action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel className="rounded-full border-border bg-muted text-foreground">
              Cancel
            </AlertDialogCancel>
            <HoldToConfirmButton
              label="Hold to delete"
              holdingLabel="Keep holding…"
              holdDurationMs={900}
              onConfirm={confirmDelete}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="border-border bg-popover text-foreground">
          <DialogHeader>
            <DialogTitle>Edit loop</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="min-h-[140px] border-border bg-muted"
          />
          <DialogFooter>
            <Button variant="outline" className="border-border" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={savingEdit}>
              {savingEdit ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Media Viewer Dialog */}
      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-h-[100dvh] max-w-[100vw] border-0 bg-black/95 p-0 text-white sm:max-w-5xl">
          <div className="relative flex min-h-[70vh] items-center justify-center p-4">
            {(() => {
              const url = mediaUrls[currentMediaIndex]
              if (!url) return null
              if (loop.media_type === "audio") {
                return (
                  <div className="flex flex-col items-center gap-6 p-8">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-500/30 ring-2 ring-violet-500/40">
                      <Volume2 className="h-12 w-12 text-violet-300" />
                    </div>
                    <audio
                      controls
                      controlsList="nodownload"
                      className="w-full max-w-lg rounded-xl"
                      src={url}
                      preload="metadata"
                      onContextMenu={(e) => e.preventDefault()}
                      onPlay={(e) => {
                        // Remove download button from shadow DOM after play
                        const audio = e.currentTarget as HTMLAudioElement
                        try {
                          const shadow = audio.shadowRoot
                          if (shadow) {
                            const dlBtn = shadow.querySelector("[aria-label=\"Download\"]")
                            if (dlBtn) dlBtn.remove()
                          }
                        } catch { /* intentionally silent */ }
                      }}
                    />
                  </div>
                )
              }
              if (loop.media_type === "video") {
                return (
                  <ProtectedMedia
                    type="video"
                    src={url}
                    className="max-h-[85vh] max-w-full object-contain"
                  />
                )
              }
              return (
                <ProtectedMedia
                  type="image"
                  src={url}
                  alt="Full media"
                  className="max-h-[85vh] max-w-full object-contain"
                />
              )
            })()}
            {mediaUrls.length > 1 && (
              <>
                <Button
                  variant="ghost"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-white"
                  onClick={() =>
                    setCurrentMediaIndex((prev) =>
                      prev > 0 ? prev - 1 : mediaUrls.length - 1
                    )
                  }
                >
                  <ChevronLeft className="h-6 w-6" />
                </Button>
                <Button
                  variant="ghost"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white"
                  onClick={() =>
                    setCurrentMediaIndex((prev) =>
                      prev < mediaUrls.length - 1 ? prev + 1 : 0
                    )
                  }
                >
                  <ChevronRight className="h-6 w-6" />
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Co-Loop Roster Dialog */}
      <Dialog open={rosterOpen} onOpenChange={setRosterOpen}>
        <DialogContent className="border-border/60 bg-card text-foreground sm:max-w-md rounded-2xl p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Zap className="h-5 w-5 text-cyan-400" />
              Co-Loop Contributors Roster
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Primary Creator */}
            <div className="flex items-center justify-between rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3">
              <div className="flex items-center gap-3">
                <AvatarWithFrame
                  avatarUrl={loop.author.avatar_url}
                  videoAvatarUrl={loop.author.video_avatar_url || null}
                  frameId={loop.author.equipped_frame_id}
                  size={40}
                  alt={loop.author.display_name}
                  className="ring-2 ring-cyan-500"
                />
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="font-bold text-xs sm:text-sm">{loop.author.display_name}</p>
                    <Badge className="bg-cyan-500 text-[9px] font-bold px-1.5 py-0 text-black">
                      CREATOR
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">@{loop.author.username}</p>
                </div>
              </div>
              <Button asChild size="sm" variant="outline" className="rounded-xl text-xs h-8">
                <Link href={`/profile/${loop.author.username}`}>Profile</Link>
              </Button>
            </div>

            {/* Co-Authors List */}
            {coAuthors.map((ca: any, idx: number) => (
              <div
                key={ca.id || idx}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/40 p-3"
              >
                <div className="flex items-center gap-3">
                  <AvatarWithFrame
                    avatarUrl={ca.avatar_url}
                    videoAvatarUrl={ca.video_avatar_url || null}
                    frameId={ca.equipped_frame_id}
                    size={40}
                    alt={ca.display_name || ca.username}
                    className="ring-2 ring-purple-500"
                  />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="font-bold text-xs sm:text-sm">
                        {ca.display_name || ca.username}
                      </p>
                      <Badge variant="secondary" className="text-[9px] font-bold px-1.5 py-0">
                        {ca.role || "CO-AUTHOR"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">@{ca.username}</p>
                  </div>
                </div>
                <Button asChild size="sm" variant="outline" className="rounded-xl text-xs h-8">
                  <Link href={`/profile/${ca.username}`}>Profile</Link>
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" className="w-full rounded-xl" onClick={() => setRosterOpen(false)}>
              Close Roster
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loop Chain Branch Map Dialog */}
      <LoopChainDialog
        loopId={loop.id}
        open={chainDialogOpen}
        onOpenChange={setChainDialogOpen}
      />

      {/* Crowd-Funded Boost Dialog */}
      <BoostLoopDialog
        loopId={loop.id}
        loopTitle={content.slice(0, 40)}
        currentCoins={boostCoinsCurrent}
        targetCoins={rawLoop?.boost_coins_target || 1000}
        open={boostDialogOpen}
        onOpenChange={setBoostDialogOpen}
        onBoostSuccess={(newCurrent, isBoostedState) => {
          setBoostCoinsCurrent(newCurrent)
          setIsBoosted(isBoostedState)
        }}
      />

      {/* Share to Direct Message Modal */}
      <ShareToDmModal
        open={shareDmOpen}
        onOpenChange={setShareDmOpen}
        item={{
          id: loop.id,
          type: "loop",
          title: content.slice(0, 60),
          text: content,
          authorName: loop.author?.display_name || loop.author?.username,
          mediaUrl: loop.media_urls?.[0] || loop.media_url || undefined,
        }}
      />

      {/* Share to Circle Community Feed Modal */}
      <ShareToCircleModal
        open={shareCircleOpen}
        onOpenChange={setShareCircleOpen}
        item={{
          id: loop.id,
          type: "loop",
          title: content.slice(0, 60),
          text: content,
          authorName: loop.author?.display_name || loop.author?.username,
          mediaUrl: loop.media_urls?.[0] || loop.media_url || undefined,
        }}
      />

      {/* Share as image card */}
      <ShareAsImageModal
        open={shareImageOpen}
        onOpenChange={setShareImageOpen}
        quoted={
          quoted && quoted.author && !quoted.restricted && !quoted.author.is_deleted
            ? {
                text: quoted.text || "",
                created_at: quoted.created_at || undefined,
                media_url: quoted.media_url || undefined,
                media_type: quoted.media_type || undefined,
                author: {
                  username: quoted.author.username,
                  display_name: quoted.author.display_name,
                  avatar_url: quoted.author.avatar_url || undefined,
                  is_verified: Boolean(quoted.author.is_verified),
                },
              }
            : undefined
        }
        post={{
          id: loop.id,
          content: content,
          created_at: loop.created_at,
          media_url: loop.media_urls?.[0] || loop.media_url || undefined,
          media_type: loop.media_type || undefined,
          author: {
            username: loop.author?.username || "user",
            display_name: loop.author?.display_name || loop.author?.username || "User",
            avatar_url: loop.author?.avatar_url,
            is_verified: Boolean(loop.author?.is_verified),
            is_premium: Boolean(loop.author?.is_premium),
            is_sponsor: Boolean(loop.author?.is_sponsor),
            is_team: Boolean(loop.author?.is_team_member),
            badge_id: loop.author?.badge_id ?? null,
          },
          stats: {
            likes_count: Number(loop.stats?.likes_count || 0),
            comments_count: Number(loop.stats?.comments_count || 0),
            branches_count: Number(loop.stats?.branches_count || 0),
            quotes_count: Number(loop.stats?.quotes_count || loop.quote_count || 0),
            shares_count: Number(loop.stats?.shares_count || 0),
          },
        }}
      />

      {/* Enhanced Share Sheet */}
      <EnhancedShareSheet
        open={shareSheetOpen}
        onOpenChange={setShareSheetOpen}
        item={{
          id: loop.id,
          type: "loop",
          title: content.slice(0, 80),
          text: content,
          authorName: loop.author?.display_name || loop.author?.username,
          mediaUrl: loop.media_urls?.[0] || loop.media_url || undefined,
          mediaType: loop.media_type || undefined,
          sharePath: `/loop/${loop.id}`,
        }}
        onDmShare={() => setShareDmOpen(true)}
        onCircleShare={() => setShareCircleOpen(true)}
      />
    </>
  )
}

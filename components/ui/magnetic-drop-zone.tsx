"use client"

import { useRef, useState } from "react"
import type { DragEvent, ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

interface MagneticDropZoneProps {
  children: ReactNode
  onFiles: (files: File[]) => void
  disabled?: boolean
  className?: string
}

/**
 * A restrained magnetic upload target.
 *
 * It accepts files dropped anywhere over its contents while preserving the
 * nested file input for keyboard and touch users. The depth counter prevents
 * flicker when a drag crosses nested elements.
 */
export function MagneticDropZone({
  children,
  onFiles,
  disabled = false,
  className,
}: MagneticDropZoneProps) {
  const reducedMotion = useReducedMotion()
  const dragDepth = useRef(0)
  const [active, setActive] = useState(false)

  const hasFiles = (event: DragEvent<HTMLDivElement>) =>
    Array.from(event.dataTransfer.types).includes("Files")

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(event)) return
    event.preventDefault()
    dragDepth.current += 1
    setActive(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || !hasFiles(event)) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setActive(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setActive(false)
    if (disabled) return

    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFiles(files)
  }

  return (
    <motion.div
      className={cn("relative rounded-2xl", active && "z-10", className)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      animate={
        active
          ? { scale: reducedMotion ? 1 : 1.008, y: reducedMotion ? 0 : -2 }
          : { scale: 1, y: 0 }
      }
      transition={
        reducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 420, damping: 30, mass: 0.45 }
      }
      data-drag-active={active ? "true" : "false"}
    >
      {children}
      {active ? (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-primary bg-primary/10 text-sm font-semibold text-primary shadow-lg backdrop-blur-[2px]"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          Drop files to attach
        </motion.div>
      ) : null}
    </motion.div>
  )
}

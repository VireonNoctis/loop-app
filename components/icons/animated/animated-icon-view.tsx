"use client"

import { useRef } from "react"
import { motion, useReducedMotion } from "motion/react"
import type { ForwardRefExoticComponent, RefAttributes } from "react"

import { cn } from "@/lib/utils"
import type { AnimatedIconHandle, AnimatedIconProps } from "./types"

export type AnimatedIconComponent = ForwardRefExoticComponent<
  AnimatedIconProps & RefAttributes<AnimatedIconHandle>
>

interface AnimatedIconViewProps {
  component: AnimatedIconComponent
  size?: number
  color?: string
  strokeWidth?: number
  className?: string
  iconClassName?: string
}

/**
 * Shared adapter for Itshover icons.
 *
 * The source icons animate on hover and expose imperative start/stop handles.
 * This wrapper adds the same short feedback on pointer press and keyboard
 * focus, so the interaction survives touch screens and keyboard navigation.
 */
export function AnimatedIconView({
  component: Icon,
  size = 18,
  color = "currentColor",
  strokeWidth = 2,
  className,
  iconClassName,
}: AnimatedIconViewProps) {
  const iconRef = useRef<AnimatedIconHandle>(null)
  const reducedMotion = useReducedMotion()

  const start = () => {
    if (!reducedMotion) iconRef.current?.startAnimation()
  }

  const stop = () => {
    if (!reducedMotion) iconRef.current?.stopAnimation()
  }

  return (
    <motion.span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onFocus={start}
      onBlur={stop}
    >
      <Icon
        ref={iconRef}
        size={size}
        color={color}
        strokeWidth={strokeWidth}
        className={cn("pointer-events-none", iconClassName)}
        aria-hidden="true"
        focusable="false"
      />
    </motion.span>
  )
}

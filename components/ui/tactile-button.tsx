"use client"

import * as React from "react"
import { motion, useReducedMotion } from "framer-motion"
import type { VariantProps } from "class-variance-authority"

import { hapticPress, hapticTap } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

type TactileFeedback = "none" | "tap" | "press"

export interface TactileButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd">,
    VariantProps<typeof buttonVariants> {
  /** Haptic feedback is best-effort and silently falls back on unsupported devices. */
  feedback?: TactileFeedback
  /** Add a restrained pointer hover lift. Disabled on touch-only and reduced-motion contexts. */
  liftOnHover?: boolean
}

/**
 * A button for deliberate, high-value actions.
 *
 * It shares the standard Button variants, adds a short spring press response
 * and optionally triggers the existing haptics helper. Use regular Button for
 * dense toolbars, passive controls and links.
 */
export const TactileButton = React.forwardRef<HTMLButtonElement, TactileButtonProps>(
  (
    {
      className,
      variant,
      size,
      type = "button",
      disabled = false,
      feedback = "tap",
      liftOnHover = true,
      onClick,
      ...props
    },
    ref,
  ) => {
    const reducedMotion = useReducedMotion()

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!disabled) {
        if (feedback === "tap") hapticTap()
        if (feedback === "press") hapticPress()
      }
      onClick?.(event)
    }

    return (
      <motion.button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(buttonVariants({ variant, size, className }))}
        whileHover={!disabled && !reducedMotion && liftOnHover ? { y: -1 } : undefined}
        whileTap={!disabled && !reducedMotion ? { scale: 0.975 } : undefined}
        transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.35 }}
        onClick={handleClick}
        {...props}
      />
    )
  },
)

TactileButton.displayName = "TactileButton"

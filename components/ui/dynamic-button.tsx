"use client"

import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import type { Key, ReactNode } from "react"
import type { VariantProps } from "class-variance-authority"

import { buttonVariants } from "@/components/ui/button"
import { hapticPress, hapticTap } from "@/lib/haptics"
import { cn } from "@/lib/utils"

type Feedback = "none" | "tap" | "press"

export interface DynamicButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd">,
    VariantProps<typeof buttonVariants> {
  children: string
  icon?: ReactNode
  stateKey?: Key
  width?: "content" | "full"
  feedback?: Feedback
}

/**
 * Dynamic action control: the face compresses like a physical button while
 * the label/icon crossfade and the width follows the active state.
 *
 * Intended for actions such as Save -> Saved or Publish -> Published. Avoid
 * using it in dense repetitive toolbars where width changes hurt scanning.
 */
export const DynamicButton = React.forwardRef<HTMLButtonElement, DynamicButtonProps>(
  function DynamicButton(
    {
      children,
      className,
      icon,
      stateKey,
      type = "button",
      variant = "default",
      size = "default",
      width = "content",
      feedback = "tap",
      disabled = false,
      onClick,
      ...props
    },
    forwardedRef,
  ) {
    const reducedMotion = useReducedMotion()
    const buttonRef = React.useRef<HTMLButtonElement>(null)
    const measureRef = React.useRef<HTMLSpanElement>(null)
    const [measuredWidth, setMeasuredWidth] = React.useState<number | null>(null)
    const contentKey = stateKey ?? children
    const iconKey = stateKey ?? (icon ? "icon" : "no-icon")

    React.useImperativeHandle(forwardedRef, () => buttonRef.current as HTMLButtonElement)

    const measure = React.useCallback(() => {
      const button = buttonRef.current
      const label = measureRef.current
      if (!button || !label || width !== "content") {
        setMeasuredWidth(null)
        return
      }

      const computed = window.getComputedStyle(button)
      const horizontalSpace =
        Number.parseFloat(computed.paddingLeft) +
        Number.parseFloat(computed.paddingRight) +
        Number.parseFloat(computed.borderLeftWidth) +
        Number.parseFloat(computed.borderRightWidth)
      const nextWidth = Math.ceil(label.scrollWidth + horizontalSpace)
      setMeasuredWidth((current) => current === nextWidth ? current : nextWidth)
    }, [width])

    React.useLayoutEffect(() => {
      measure()
      const node = measureRef.current
      if (!node || width !== "content") return

      const observer = new ResizeObserver(measure)
      observer.observe(node)
      window.addEventListener("resize", measure)
      return () => {
        observer.disconnect()
        window.removeEventListener("resize", measure)
      }
    }, [measure, width, children, icon, stateKey])

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!disabled) {
        if (feedback === "tap") hapticTap()
        if (feedback === "press") hapticPress()
      }
      onClick?.(event)
    }

    const widthTransition = reducedMotion
      ? { duration: 0 }
      : { type: "spring" as const, stiffness: 420, damping: 36, mass: 0.5 }

    const contentTransition = {
      duration: reducedMotion ? 0.08 : 0.16,
      ease: [0.23, 1, 0.32, 1] as const,
    }

    return (
      <motion.button
        {...props}
        ref={buttonRef}
        type={type}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          buttonVariants({ variant, size }),
          "relative loop-tactile overflow-hidden whitespace-nowrap",
          width === "full" && "w-full",
          className,
        )}
        initial={false}
        animate={width === "content" ? { width: measuredWidth ?? "auto" } : { width: "100%" }}
        transition={{ width: widthTransition }}
        whileHover={!disabled && !reducedMotion ? { y: -1 } : undefined}
        whileTap={!disabled && !reducedMotion ? { y: 2, scale: 0.99 } : undefined}
      >
        <span className="relative inline-flex items-center justify-center gap-2">
          {icon ? (
            <span className="relative inline-grid size-4 shrink-0 overflow-hidden">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={iconKey}
                  className="col-start-1 row-start-1 flex size-4 items-center justify-center"
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
                  transition={contentTransition}
                >
                  {icon}
                </motion.span>
              </AnimatePresence>
            </span>
          ) : null}
          <span className="relative inline-grid overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={contentKey}
                className="col-start-1 row-start-1 block"
                initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
                transition={contentTransition}
              >
                {children}
              </motion.span>
            </AnimatePresence>
          </span>
        </span>

        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 inline-flex items-center gap-2 whitespace-nowrap opacity-0"
          ref={measureRef}
        >
          {icon ? <span className="inline-flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
          <span>{children}</span>
        </span>
      </motion.button>
    )
  },
)

DynamicButton.displayName = "DynamicButton"

"use client"

import * as React from "react"
import { useReducedMotion } from "motion/react"

import { buttonVariants } from "@/components/ui/button"
import { hapticPress, hapticSuccess, hapticTap } from "@/lib/haptics"
import { cn } from "@/lib/utils"

export interface HoldToConfirmButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragStart" | "onDragEnd"> {
  onConfirm: () => void | Promise<void>
  label?: string
  holdingLabel?: string
  undoLabel?: string
  holdDurationMs?: number
  undoDurationMs?: number
}

/**
 * Deliberate confirmation with a short undo window.
 *
 * Pointer release, pointer cancellation, focus loss or keyboard release
 * before the threshold cancels the hold. Once armed, the user can undo before
 * the irreversible callback is invoked. Space and Enter are supported.
 */
export const HoldToConfirmButton = React.forwardRef<HTMLButtonElement, HoldToConfirmButtonProps>(
  function HoldToConfirmButton(
    {
      onConfirm,
      label = "Hold to confirm",
      holdingLabel = "Keep holding…",
      undoLabel = "Undo",
      holdDurationMs = 900,
      undoDurationMs = 5000,
      disabled = false,
      className,
      onClick,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onKeyDown,
      onKeyUp,
      onBlur,
      ...props
    },
    forwardedRef,
  ) {
    const buttonRef = React.useRef<HTMLButtonElement>(null)
    const holdTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const undoTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const holdingRef = React.useRef(false)
    const pointerHoldActiveRef = React.useRef(false)
    const suppressReleaseClickRef = React.useRef(false)
    const [holding, setHolding] = React.useState(false)
    const [armed, setArmed] = React.useState(false)
    const reducedMotion = useReducedMotion()

    React.useImperativeHandle(forwardedRef, () => buttonRef.current as HTMLButtonElement)

    const clearHold = React.useCallback(() => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
      holdingRef.current = false
      setHolding(false)
    }, [])

    const undo = React.useCallback(() => {
      if (!armed) return
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current)
        undoTimerRef.current = null
      }
      setArmed(false)
      hapticTap()
    }, [armed])

    const startHold = React.useCallback(() => {
      if (disabled || armed || holdingRef.current) return
      holdingRef.current = true
      setHolding(true)
      hapticPress()

      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null
        holdingRef.current = false
        setHolding(false)
        setArmed(true)
        if (pointerHoldActiveRef.current) suppressReleaseClickRef.current = true
        hapticSuccess()

        undoTimerRef.current = setTimeout(() => {
          undoTimerRef.current = null
          setArmed(false)
          void onConfirm()
        }, undoDurationMs)
      }, holdDurationMs)
    }, [armed, disabled, holdDurationMs, onConfirm, undoDurationMs])

    React.useEffect(() => () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    }, [])

    const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      onPointerDown?.(event)
      if (event.defaultPrevented) return
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is not available in every embedded browser.
      }
      pointerHoldActiveRef.current = true
      if (!armed) startHold()
    }

    const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerUp?.(event)
      pointerHoldActiveRef.current = false
      clearHold()
    }

    const handlePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerCancel?.(event)
      pointerHoldActiveRef.current = false
      suppressReleaseClickRef.current = false
      clearHold()
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(event)
      if (event.defaultPrevented || event.repeat) return
      if (armed && (event.key === " " || event.key === "Enter")) {
        event.preventDefault()
        undo()
        return
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault()
        startHold()
      }
    }

    const handleKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      onKeyUp?.(event)
      if (event.key === " " || event.key === "Enter") clearHold()
    }

    const handleBlur = (event: React.FocusEvent<HTMLButtonElement>) => {
      onBlur?.(event)
      clearHold()
    }

    const visibleLabel = holding ? holdingLabel : armed ? undoLabel : label

    return (
      <button
        {...props}
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={props["aria-label"] || (armed ? `${undoLabel} deletion` : label)}
        aria-busy={holding}
        data-holding={holding ? "true" : "false"}
        data-armed={armed ? "true" : "false"}
        className={cn(
          buttonVariants({ variant: armed ? "secondary" : "destructive", size: "default" }),
          "loop-tactile relative isolate min-w-36 select-none overflow-hidden",
          "touch-none focus-visible:ring-2 focus-visible:ring-rose-500",
          armed && "border border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
          className,
        )}
        onClick={(event) => {
          event.preventDefault()
          if (suppressReleaseClickRef.current) {
            suppressReleaseClickRef.current = false
            return
          }
          if (armed) {
            undo()
            return
          }
          onClick?.(event)
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={() => {
          pointerHoldActiveRef.current = false
          clearHold()
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={handleBlur}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 z-0 origin-left",
            armed ? "bg-emerald-500/15" : "bg-rose-950/30",
          )}
          style={{
            transform: holding || armed ? "scaleX(1)" : "scaleX(0)",
            transition: reducedMotion ? "none" : holding ? `transform ${holdDurationMs}ms linear` : "transform 180ms ease-out",
            animation: armed && !reducedMotion
              ? `loop-hold-undo-progress ${undoDurationMs}ms linear forwards`
              : "none",
          }}
        />
        <span className="relative z-10">{visibleLabel}</span>
        <span className="sr-only" aria-live="polite">
          {holding
            ? "Hold to arm deletion. Releasing early cancels."
            : armed
              ? "Deletion is waiting. Activate Undo to cancel."
              : "Press and hold to confirm deletion."}
        </span>
      </button>
    )
  },
)

HoldToConfirmButton.displayName = "HoldToConfirmButton"

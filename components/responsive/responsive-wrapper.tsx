// @ts-nocheck
"use client"

import React from 'react'
import { useResponsiveClasses } from '@/hooks/use-responsive'
import { cn } from '@/lib/utils'

interface ResponsiveWrapperProps {
  children: React.ReactNode
  className?: string
  mobileClassName?: string
  tabletClassName?: string
  desktopClassName?: string
  as?: keyof JSX.IntrinsicElements
}

export function ResponsiveWrapper({
  children,
  className,
  mobileClassName,
  tabletClassName,
  desktopClassName,
  as: Component = 'div',
}: ResponsiveWrapperProps) {
  const { screenSize, classes } = useResponsiveClasses()

  const responsiveClassName = cn(
    className,
    screenSize.isMobile && mobileClassName,
    screenSize.isTablet && tabletClassName,
    screenSize.isDesktop && desktopClassName,
    classes.motion,
    classes.contrast
  )

  return (
    <Component className={responsiveClassName}>
      {children}
    </Component>
  )
}

interface ResponsiveGridProps {
  children: React.ReactNode
  className?: string
  cols?: {
    mobile?: number
    tablet?: number
    desktop?: number
  }
  gap?: {
    mobile?: string
    tablet?: string
    desktop?: string
  }
}

export function ResponsiveGrid({
  children,
  className,
  cols = { mobile: 1, tablet: 2, desktop: 3 },
  gap = { mobile: '0.75rem', tablet: '1rem', desktop: '1.5rem' }
}: ResponsiveGridProps) {
  const { screenSize } = useResponsiveClasses()

  const columns = screenSize.isMobile ? cols.mobile ?? 1 : screenSize.isTablet ? cols.tablet ?? 2 : cols.desktop ?? 3
  const safeColumns = Math.min(12, Math.max(1, Math.floor(columns)))
  const responsiveGap = screenSize.isMobile ? gap.mobile ?? "0.75rem" : screenSize.isTablet ? gap.tablet ?? "1rem" : gap.desktop ?? "1.5rem"

  return (
    <div
      className={cn("grid min-w-0 loop-responsive-grid", className)}
      style={{ gap: responsiveGap, gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  )
}

interface ResponsiveTextProps {
  children: React.ReactNode
  className?: string
  sizes?: {
    mobile?: string
    tablet?: string
    desktop?: string
  }
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'div'
}

export function ResponsiveText({
  children,
  className,
  sizes = { mobile: 'text-sm', tablet: 'text-base', desktop: 'text-lg' },
  as: Component = 'p'
}: ResponsiveTextProps) {
  const { screenSize } = useResponsiveClasses()

  const textClassName = cn(
    screenSize.isMobile && sizes.mobile,
    screenSize.isTablet && sizes.tablet,
    screenSize.isDesktop && sizes.desktop,
    className
  )

  return (
    <Component className={textClassName}>
      {children}
    </Component>
  )
}

interface ResponsiveSpacingProps {
  children: React.ReactNode
  className?: string
  spacing?: {
    mobile?: string
    tablet?: string
    desktop?: string
  }
  direction?: 'vertical' | 'horizontal'
}

export function ResponsiveSpacing({
  children,
  className,
  spacing = { mobile: 'space-y-3', tablet: 'space-y-4', desktop: 'space-y-6' },
  direction = 'vertical'
}: ResponsiveSpacingProps) {
  const { screenSize } = useResponsiveClasses()

  const spacingClassName = cn(
    screenSize.isMobile && spacing.mobile,
    screenSize.isTablet && spacing.tablet,
    screenSize.isDesktop && spacing.desktop,
    className
  )

  return (
    <div className={spacingClassName}>
      {children}
    </div>
  )
}

interface ResponsiveContainerProps {
  children: React.ReactNode
  className?: string
  maxWidth?: {
    mobile?: string
    tablet?: string
    desktop?: string
  }
  padding?: {
    mobile?: string
    tablet?: string
    desktop?: string
  }
}

export function ResponsiveContainer({
  children,
  className,
  maxWidth = { mobile: '100%', tablet: '768px', desktop: '1280px' },
  padding = { mobile: 'px-4', tablet: 'px-6', desktop: 'px-8' }
}: ResponsiveContainerProps) {
  const { screenSize } = useResponsiveClasses()

  const containerClassName = cn(
    'mx-auto w-full',
    screenSize.isMobile && padding.mobile,
    screenSize.isTablet && padding.tablet,
    screenSize.isDesktop && padding.desktop,
    className
  )

  const containerStyle = {
    maxWidth: screenSize.isMobile ? maxWidth.mobile : screenSize.isTablet ? maxWidth.tablet : maxWidth.desktop
  }

  return (
    <div className={containerClassName} style={containerStyle}>
      {children}
    </div>
  )
}

interface ResponsiveShowHideProps {
  children: React.ReactNode
  showOn?: ('mobile' | 'tablet' | 'desktop')[]
  hideOn?: ('mobile' | 'tablet' | 'desktop')[]
}

export function ResponsiveShowHide({
  children,
  showOn,
  hideOn
}: ResponsiveShowHideProps) {
  const { screenSize } = useResponsiveClasses()

  const shouldShow = () => {
    if (showOn) {
      return (
        (showOn.includes('mobile') && screenSize.isMobile) ||
        (showOn.includes('tablet') && screenSize.isTablet) ||
        (showOn.includes('desktop') && screenSize.isDesktop)
      )
    }

    if (hideOn) {
      return !(
        (hideOn.includes('mobile') && screenSize.isMobile) ||
        (hideOn.includes('tablet') && screenSize.isTablet) ||
        (hideOn.includes('desktop') && screenSize.isDesktop)
      )
    }

    return true
  }

  if (!shouldShow()) {
    return null
  }

  return <>{children}</>
}

// Utility component for responsive images
interface ResponsiveImageProps {
  src: string
  alt: string
  className?: string
  sizes?: {
    mobile?: { width: number; height: number }
    tablet?: { width: number; height: number }
    desktop?: { width: number; height: number }
  }
}

export function ResponsiveImage({
  src,
  alt,
  className,
  sizes = {
    mobile: { width: 300, height: 200 },
    tablet: { width: 500, height: 300 },
    desktop: { width: 800, height: 500 }
  }
}: ResponsiveImageProps) {
  const { screenSize } = useResponsiveClasses()

  const currentSize = screenSize.isMobile ? sizes.mobile : screenSize.isTablet ? sizes.tablet : sizes.desktop

  return (
    <img
      src={src}
      alt={alt}
      width={currentSize.width}
      height={currentSize.height}
      className={cn('responsive-image', className)}
      loading="lazy"
    />
  )
}

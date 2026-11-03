import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
const responsive = read("../styles/responsive.css")
const wrapper = read("../components/responsive/responsive-wrapper.tsx")
const chrome = read("../components/layout/app-chrome.tsx")
const mobileNav = read("../components/navigation/mobile-bottom-nav.tsx")
const card = read("../components/ui/card.tsx")
const button = read("../components/ui/button.tsx")
const layout = read("../app/layout.tsx")

describe("LOOP responsive and motion foundation", () => {
  it("uses the responsive stylesheet in the application root", () => {
    expect(layout).toContain('import "../styles/responsive.css"')
  })

  it("uses real grid templates instead of runtime-generated Tailwind classes", () => {
    expect(wrapper).toContain("gridTemplateColumns")
    expect(wrapper).toContain("Math.min(12, Math.max(1, Math.floor(columns)))")
    expect(wrapper).not.toMatch(/grid-cols-\$\{/)
  })

  it("allows the main content and nested grid cells to shrink without horizontal overflow", () => {
    expect(chrome).toContain("loop-app-content")
    expect(responsive).toContain(".loop-app-content")
    expect(responsive).toContain(".loop-responsive-grid > *")
    expect(responsive).toContain("overflow-x: clip")
  })

  it("keeps mobile navigation safe-area aware and touch friendly", () => {
    expect(mobileNav).toContain("loop-mobile-nav")
    expect(mobileNav).toContain("min-h-11")
    expect(responsive).toContain("env(safe-area-inset-left)")
    expect(responsive).toContain("env(safe-area-inset-right)")
  })

  it("provides shared card and button press feedback", () => {
    expect(card).toContain("loop-card-motion")
    expect(button).toContain("loop-tactile")
    expect(responsive).toContain(".loop-card-motion:not([data-static=\"true\"]):hover")
  })

  it("honours reduced motion and high-contrast focus preferences", () => {
    expect(responsive).toContain("@media (prefers-reduced-motion: reduce)")
    expect(responsive).toContain("@media (forced-colors: active)")
  })
})

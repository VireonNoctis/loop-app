import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "playwright"

const baseUrl = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "")
const outputDir = resolve(process.cwd(), "artifacts/responsive")
const routes = ["/", "/login", "/signup", "/explore", "/terms", "/privacy"]
const viewports = [
  { name: "small-mobile", width: 320, height: 720, mobile: true },
  { name: "mobile", width: 360, height: 800, mobile: true },
  { name: "large-mobile", width: 430, height: 932, mobile: true },
  { name: "tablet", width: 768, height: 1024, mobile: false },
  { name: "small-desktop", width: 1024, height: 768, mobile: false },
  { name: "desktop", width: 1440, height: 900, mobile: false },
]

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const failures = []
let captured = 0

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
      deviceScaleFactor: 1,
    })

    for (const route of routes) {
      const page = await context.newPage()
      const pageErrors = []
      page.on("pageerror", (error) => pageErrors.push(error.message))

      try {
        const response = await page.goto(baseUrl + route, { waitUntil: "domcontentloaded", timeout: 60000 })
        if (!response) throw new Error("Navigation did not produce a response")
        if (response.status() >= 500) throw new Error("HTTP " + response.status())

        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined)
        if (route === "/") {
          await page.waitForFunction(
            () => document.querySelector('[data-home-hydrated="true"]') !== null,
            null,
            { timeout: 12000 },
          )
        }
        await page.waitForTimeout(250)

        const layout = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body ? document.body.scrollWidth : 0,
          title: document.title,
          viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
          overflowingElements: document.documentElement.scrollWidth > window.innerWidth + 1
            ? Array.from(document.querySelectorAll("body *"))
                .map((element) => {
                  const rect = element.getBoundingClientRect()
                  const style = window.getComputedStyle(element)
                  return {
                    tag: element.tagName.toLowerCase(),
                    id: element.id || "",
                    className: typeof element.className === "string" ? element.className.slice(0, 140) : "",
                    left: Math.round(rect.left * 10) / 10,
                    right: Math.round(rect.right * 10) / 10,
                    width: Math.round(rect.width * 10) / 10,
                    clientWidth: element.clientWidth,
                    scrollWidth: element.scrollWidth,
                    overflowX: style.overflowX,
                    position: style.position,
                    before: (() => { const pseudo = window.getComputedStyle(element, "::before"); return pseudo.content === "none" ? null : { content: pseudo.content, width: pseudo.width, left: pseudo.left, right: pseudo.right, transform: pseudo.transform }; })(),
                    after: (() => { const pseudo = window.getComputedStyle(element, "::after"); return pseudo.content === "none" ? null : { content: pseudo.content, width: pseudo.width, left: pseudo.left, right: pseudo.right, transform: pseudo.transform }; })(),
                  }
                })
                .filter((element) => element.right > window.innerWidth + 1 || element.left < -1 || element.scrollWidth > element.clientWidth + 1 || element.before || element.after)
                .sort((a, b) => b.right - a.right)
                .slice(0, 12)
            : [],
          offscreenElements: Array.from(document.querySelectorAll("body *"))
            .map((element) => {
              const rect = element.getBoundingClientRect()
              return {
                tag: element.tagName.toLowerCase(),
                id: element.id || "",
                className: typeof element.className === "string" ? element.className.slice(0, 140) : "",
                left: Math.round(rect.left * 10) / 10,
                right: Math.round(rect.right * 10) / 10,
              }
            })
            .filter((element) => element.right > window.innerWidth + 1 || element.left < -1)
            .slice(0, 12),
          overflowCandidates: document.documentElement.scrollWidth > window.innerWidth + 1
            ? Array.from(document.querySelectorAll("body *")).map((element) => {
                const rect = element.getBoundingClientRect()
                const style = window.getComputedStyle(element)
                const marginLeft = Number.parseFloat(style.marginLeft) || 0
                const marginRight = Number.parseFloat(style.marginRight) || 0
                return {
                  tag: element.tagName.toLowerCase(),
                  id: element.id || "",
                  className: typeof element.className === "string" ? element.className.slice(0, 180) : "",
                  left: Math.round(rect.left * 10) / 10,
                  right: Math.round(rect.right * 10) / 10,
                  marginLeft,
                  marginRight,
                  marginBoxRight: Math.round((rect.right + marginRight) * 10) / 10,
                  width: Math.round(rect.width * 10) / 10,
                  position: style.position,
                  transform: style.transform,
                  overflowX: style.overflowX,
                  clientWidth: element.clientWidth,
                  scrollWidth: element.scrollWidth,
                }
              }).sort((a, b) => b.marginBoxRight - a.marginBoxRight).slice(0, 18)
            : [],
          rootOverflow: {
            scrollingElement: document.scrollingElement?.tagName ?? null,
            html: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, overflowX: getComputedStyle(document.documentElement).overflowX, position: getComputedStyle(document.documentElement).position },
            body: { clientWidth: document.body?.clientWidth ?? 0, scrollWidth: document.body?.scrollWidth ?? 0, overflowX: document.body ? getComputedStyle(document.body).overflowX : "", position: document.body ? getComputedStyle(document.body).position : "" },
            htmlBefore: (() => { const pseudo = window.getComputedStyle(document.documentElement, "::before"); return { content: pseudo.content, display: pseudo.display, position: pseudo.position, width: pseudo.width, left: pseudo.left, right: pseudo.right, marginLeft: pseudo.marginLeft, marginRight: pseudo.marginRight, transform: pseudo.transform }; })(),
            htmlAfter: (() => { const pseudo = window.getComputedStyle(document.documentElement, "::after"); return { content: pseudo.content, display: pseudo.display, position: pseudo.position, width: pseudo.width, left: pseudo.left, right: pseudo.right, marginLeft: pseudo.marginLeft, marginRight: pseudo.marginRight, transform: pseudo.transform }; })(),
            bodyBefore: (() => { const pseudo = window.getComputedStyle(document.body, "::before"); return { content: pseudo.content, display: pseudo.display, position: pseudo.position, width: pseudo.width, left: pseudo.left, right: pseudo.right, marginLeft: pseudo.marginLeft, marginRight: pseudo.marginRight, transform: pseudo.transform }; })(),
            bodyAfter: (() => { const pseudo = window.getComputedStyle(document.body, "::after"); return { content: pseudo.content, display: pseudo.display, position: pseudo.position, width: pseudo.width, left: pseudo.left, right: pseudo.right, marginLeft: pseudo.marginLeft, marginRight: pseudo.marginRight, transform: pseudo.transform }; })(),
          },
        }))

        const rootClipsHorizontalOverflow = ["clip", "hidden"].includes(layout.rootOverflow.html.overflowX)
          || ["clip", "hidden"].includes(layout.rootOverflow.body.overflowX)
        const offscreenElements = layout.offscreenElements
        if (layout.bodyWidth > viewport.width + 1
          || (layout.documentWidth > viewport.width + 1 && !rootClipsHorizontalOverflow)
          || offscreenElements.length > 0) {
          throw new Error("Horizontal overflow: viewport=" + viewport.width + ", document=" + layout.documentWidth + ", body=" + layout.bodyWidth + "; offscreen=" + JSON.stringify(offscreenElements) + "; root=" + JSON.stringify(layout.rootOverflow) + "; candidates=" + JSON.stringify(layout.overflowCandidates))
        }
        if (!layout.title.trim()) throw new Error("Page title is empty")
        if (!layout.viewportMeta.includes("width=device-width")) throw new Error("Responsive viewport metadata is missing")
        if (/user-scalable\s*=\s*no|max(imum)?-scale\s*=\s*1(?:\.0)?/i.test(layout.viewportMeta)) {
          throw new Error("Viewport metadata prevents user zoom")
        }
        if (pageErrors.length) throw new Error("Browser runtime error: " + pageErrors.join(" | "))

        if (route === "/" && viewport.mobile) {
          const mobileNav = page.locator('nav[aria-label="Mobile navigation"]')
          await mobileNav.waitFor({ state: "visible", timeout: 8000 })
          const targetHeights = await mobileNav.locator("a").evaluateAll((links) => links.map((link) => link.getBoundingClientRect().height))
          if (targetHeights.length < 5) throw new Error("Mobile navigation has fewer than five destinations")
          if (targetHeights.some((height) => height < 44)) throw new Error("A mobile navigation target is smaller than 44 CSS pixels")
        }

        const routeName = route === "/" ? "home" : route.slice(1).replaceAll("/", "-")
        const screenshot = resolve(outputDir, routeName + "--" + viewport.name + ".png")
        await page.screenshot({ path: screenshot, fullPage: false, animations: "disabled" })
        captured += 1
        process.stdout.write("PASS " + route.padEnd(10) + " " + viewport.name.padEnd(14) + " " + layout.documentWidth + "px document width\n")
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(route + " at " + viewport.name + ": " + message)
        process.stderr.write("FAIL " + route + " at " + viewport.name + ": " + message + "\n")
      } finally {
        await page.close()
      }
    }

    await context.close()
  }
} finally {
  await browser.close()
}

process.stdout.write("Captured " + captured + " responsive screenshots in " + outputDir + "\n")
if (failures.length) {
  process.stderr.write("\n" + failures.length + " responsive acceptance failure(s):\n" + failures.map((failure) => "- " + failure).join("\n") + "\n")
  process.exitCode = 1
}

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(process.cwd(), "scripts/co-loop-room-controls.sql"), "utf8")

describe("Co-Loop activity table privacy", () => {
  it("does not grant anonymous or authenticated users direct activity reads", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Anyone can read co_loop_activity"')
    expect(migration).not.toMatch(/CREATE POLICY\s+"Anyone can read co_loop_activity"[\s\S]*?FOR SELECT\s+USING\s*\(true\)/i)
  })

  it("restricts activity table operations to the server role", () => {
    expect(migration).toMatch(
      /CREATE POLICY\s+"Service role manages co_loop_activity"[\s\S]*?FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/i,
    )
  })
})

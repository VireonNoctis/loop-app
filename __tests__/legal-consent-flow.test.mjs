import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
const signup = read("../app/signup/page.tsx")
const consent = read("../app/legal/consent/page.tsx")
const redirect = read("../components/onboarding-redirect.tsx")
const legalRoute = read("../backend/src/routes/legal.rs")
const terms = read("../app/terms/page.tsx")
const privacy = read("../app/privacy/page.tsx")

describe("LOOP legal consent and publication flow", () => {
  it("routes email and Google signup through legal review before onboarding", () => {
    expect(signup).toContain('/legal/consent?returnTo=')
    expect(signup).toContain("googleSignIn")
    expect(signup).toContain('encodeURIComponent("/onboarding")')
  })

  it("requires a checked box before posting acceptance", () => {
    expect(consent).toContain('type="checkbox"')
    expect(consent).toContain("checked={accepted}")
    expect(consent).toContain("disabled={!accepted || saving || !status}")
    expect(consent).toContain("terms_accepted: true")
    expect(consent).toContain("privacy_acknowledged: true")
  })

  it("rechecks the currently published versions for each authenticated account", () => {
    expect(redirect).toContain('"legal/acceptance"')
    expect(redirect).toContain("router.replace")
    expect(legalRoute).toContain('pub const TERMS_VERSION: &str = "1.2"')
    expect(legalRoute).toContain('pub const PRIVACY_VERSION: &str = "1.2"')
    expect(legalRoute).toContain("publication_ready")
    expect(legalRoute).toContain("publication_not_ready()")
    expect(redirect).toContain("result.publication_ready")
    expect(consent).toContain("!status.publication_ready")
  })

  it("stores the two acknowledgements transactionally and idempotently", () => {
    expect(legalRoute).toContain("transaction.commit()")
    expect(legalRoute).toContain("ON CONFLICT (auth_user_id, document_key, document_version) DO NOTHING")
  })

  it("keeps legal documents public and gives each document a canonical page", () => {
    expect(terms).toContain("Terms of Service")
    expect(privacy).toContain("Privacy Policy")
    expect(terms).toContain("Version 1.1")
    expect(privacy).toContain("Version 1.1")
    expect(terms).toContain("Pre-launch publication requirement")
    expect(privacy).toContain("Pre-launch publication requirement")
  })

  it("does not treat continued browsing as affirmative privacy consent", () => {
    expect(privacy).not.toContain("constitutes your acceptance of the updated policy")
    expect(privacy).toContain("silence is not treated as consent")
  })
})

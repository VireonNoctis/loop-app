import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
const config = read("../lib/legal-operator.ts")
const terms = read("../app/terms/page.tsx")
const privacy = read("../app/privacy/page.tsx")
const rust = read("../backend/src/routes/legal.rs")
const consent = read("../app/legal/consent/page.tsx")
const rootEnv = read("../.env.example")
const backendEnv = read("../backend/.env.example")
const nextReadinessRoute = read("../app/api/legal/publication-readiness/route.ts")

const required = [
  "LEGAL_OPERATOR_NAME",
  "LEGAL_OPERATOR_ADDRESS",
  "LEGAL_OPERATOR_COUNTRY",
  "LEGAL_CONTACT_EMAIL",
  "PRIVACY_CONTACT_EMAIL",
  "PRIVACY_PROCESSORS",
  "PRIVACY_PROCESSING_LOCATIONS",
  "PRIVACY_TRANSFER_DETAILS",
  "PRIVACY_DATA_RETENTION",
  "PRIVACY_BACKUP_RETENTION",
]

describe("legal publication readiness", () => {
  it("uses a server-only disclosure source in both public policy pages", () => {
    expect(config).toContain('import "server-only"')
    for (const key of required) expect(config).toContain(key)
    expect(terms).toContain("getLegalPublicationInfo()")
    expect(privacy).toContain("getLegalPublicationInfo()")
  })

  it("rejects empty and placeholder values and validates email fields", () => {
    expect(config).toContain('"todo"')
    expect(config).toContain('"change_me"')
    expect(config).toContain("isValidEmail")
  })

  it("renders the configured operator and production processing disclosures", () => {
    expect(terms).toContain("Operator details")
    expect(terms).toContain("legalInfo.operatorAddress")
    expect(privacy).toContain("Production service providers and roles")
    expect(privacy).toContain("International transfers and safeguards")
    expect(privacy).toContain("Backup retention and deletion")
  })

  it("makes Rust the authority for agreement readiness", () => {
    expect(rust).toContain("REQUIRED_PUBLICATION_FIELDS")
    expect(rust).toContain("missing_publication_fields")
    expect(rust).toContain("return Err(publication_not_ready())")
    expect(consent).toContain("!status.publication_ready")
    expect(consent).toContain("/api/legal/publication-readiness")
    expect(nextReadinessRoute).toContain("getLegalPublicationInfo()")
    expect(nextReadinessRoute).toContain("publication_ready: publication.publicationReady")
  })

  it("lists all publication fields in both environment templates", () => {
    for (const key of required) {
      expect(rootEnv).toContain(key + "=")
      expect(backendEnv).toContain(key + "=")
    }
  })
})

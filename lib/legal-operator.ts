import "server-only"

function readValue(key: string): string {
  return (process.env[key] ?? "").trim()
}

function isPublishedValue(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return Boolean(normalized && !["todo", "tbd", "change_me", "changeme", "not configured", "example.com"].includes(normalized))
}

function isValidEmail(value: string): boolean {
  const parts = value.split("@")
  return parts.length === 2 && Boolean(parts[0]?.trim()) && Boolean(parts[1]?.includes(".")) && !value.split("").some((character) => character.trim() === "")
}

const REQUIRED_FIELDS = [
  { key: "LEGAL_OPERATOR_NAME", label: "Operator full registered legal name" },
  { key: "LEGAL_OPERATOR_ADDRESS", label: "Operator registered/service address" },
  { key: "LEGAL_OPERATOR_COUNTRY", label: "Country of establishment" },
  { key: "LEGAL_CONTACT_EMAIL", label: "Monitored legal contact email" },
  { key: "PRIVACY_CONTACT_EMAIL", label: "Monitored privacy contact email" },
  { key: "PRIVACY_PROCESSORS", label: "Actual production service providers and roles" },
  { key: "PRIVACY_PROCESSING_LOCATIONS", label: "Production processing and storage locations" },
  { key: "PRIVACY_TRANSFER_DETAILS", label: "International transfer position and safeguards" },
  { key: "PRIVACY_DATA_RETENTION", label: "Data retention schedule" },
  { key: "PRIVACY_BACKUP_RETENTION", label: "Backup retention and deletion schedule" },
] as const

export function getLegalPublicationInfo() {
  const values = Object.fromEntries(REQUIRED_FIELDS.map(({ key }) => [key, readValue(key)]))
  const missingFields = REQUIRED_FIELDS.filter(({ key }) => {
    const value = values[key] ?? ""
    if (!isPublishedValue(value)) return true
    if (key.endsWith("_EMAIL")) return !isValidEmail(value)
    return false
  })

  return {
    operatorName: values.LEGAL_OPERATOR_NAME ?? "",
    operatorAddress: values.LEGAL_OPERATOR_ADDRESS ?? "",
    operatorCountry: values.LEGAL_OPERATOR_COUNTRY ?? "",
    operatorRegistration: readValue("LEGAL_OPERATOR_REGISTRATION"),
    legalContactEmail: values.LEGAL_CONTACT_EMAIL ?? "",
    privacyContactEmail: values.PRIVACY_CONTACT_EMAIL ?? "",
    processors: values.PRIVACY_PROCESSORS ?? "",
    processingLocations: values.PRIVACY_PROCESSING_LOCATIONS ?? "",
    transferDetails: values.PRIVACY_TRANSFER_DETAILS ?? "",
    dataRetention: values.PRIVACY_DATA_RETENTION ?? "",
    backupRetention: values.PRIVACY_BACKUP_RETENTION ?? "",
    publicationReady: missingFields.length === 0,
    missingFields: missingFields.map(({ key, label }) => ({ key, label })),
  }
}

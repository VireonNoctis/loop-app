# LOOP legal publication readiness

The Terms and Privacy Policy are versioned application documents. The details below must be supplied by the person or legal entity that actually operates LOOP.

## Required values

Set these values in both the Next.js runtime and the Rust API runtime, and keep them identical.

| Variable | Required content |
| --- | --- |
| `LEGAL_OPERATOR_NAME` | Full registered legal name of the service operator |
| `LEGAL_OPERATOR_ADDRESS` | Registered/service address used for legal notices |
| `LEGAL_OPERATOR_COUNTRY` | Country where the operator is established |
| `LEGAL_OPERATOR_REGISTRATION` | Optional registration number, where applicable |
| `LEGAL_CONTACT_EMAIL` | Monitored legal-notice email |
| `PRIVACY_CONTACT_EMAIL` | Monitored privacy/data-protection email |
| `PRIVACY_PROCESSORS` | Actual production providers and the role each performs |
| `PRIVACY_PROCESSING_LOCATIONS` | Actual production processing and storage locations |
| `PRIVACY_TRANSFER_DETAILS` | Whether international transfers occur and the applicable mechanism/safeguards |
| `PRIVACY_DATA_RETENTION` | Actual data retention schedule by data category |
| `PRIVACY_BACKUP_RETENTION` | Actual backup expiry/deletion schedule |

Do not substitute a repository owner, domain registrant, development dependency, or assumed country for the actual service operator. Do not publish guessed addresses, contacts, providers, locations, or retention periods.

## Enforcement

- The public Terms and Privacy pages read values from the server environment.
- Empty values, placeholder values, and invalid contact emails are treated as missing.
- The Rust `GET /v1/legal/acceptance` response reports publication readiness.
- The Rust `POST /v1/legal/acceptance` endpoint refuses to record consent while required publication fields are missing.
- The app-wide account gate routes users to legal review while publication is incomplete.
- Bump `TERMS_VERSION` and `PRIVACY_VERSION` in `backend/src/routes/legal.rs` when their respective documents change.

## Before launch

The service operator must verify these values against its actual registration, provider contracts, production deployment, storage locations, retention configuration, and international-transfer arrangements. Qualified counsel should review the final documents for the actual jurisdictions and product flows. The application readiness check verifies configuration completeness; it is not a legal review.

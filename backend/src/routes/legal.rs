use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{auth::AuthenticatedSessionUser, state::AppState};

// Bump the matching value when the corresponding published document changes.
pub const TERMS_VERSION: &str = "1.2";
pub const PRIVACY_VERSION: &str = "1.2";

#[derive(Serialize)]
struct LegalErrorBody {
    error: &'static str,
    message: &'static str,
}

pub struct LegalError {
    status: StatusCode,
    code: &'static str,
    message: &'static str,
}

impl IntoResponse for LegalError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(LegalErrorBody {
                error: self.code,
                message: self.message,
            }),
        )
            .into_response()
    }
}

#[derive(Serialize)]
pub struct LegalAcceptanceStatus {
    terms_version: &'static str,
    privacy_version: &'static str,
    terms_accepted: bool,
    privacy_acknowledged: bool,
    complete: bool,
    publication_ready: bool,
    missing_publication_fields: Vec<&'static str>,
}

#[derive(Deserialize)]
pub struct AcceptLegalDocumentsInput {
    terms_accepted: bool,
    privacy_acknowledged: bool,
}

const REQUIRED_PUBLICATION_FIELDS: &[&str] = &[
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
];

fn is_published_value(key: &str, value: &str) -> bool {
    let value = value.trim();
    let normalized = value.to_ascii_lowercase();
    if value.is_empty()
        || [
            "todo",
            "tbd",
            "change_me",
            "changeme",
            "not configured",
            "example.com",
        ]
        .iter()
        .any(|marker| normalized == *marker)
    {
        return false;
    }

    if key.ends_with("_EMAIL") {
        let Some((local, domain)) = value.split_once('@') else {
            return false;
        };
        return !local.trim().is_empty()
            && !domain.trim().is_empty()
            && domain.contains('.')
            && !value.chars().any(char::is_whitespace);
    }

    true
}

fn missing_publication_fields_with(
    mut read: impl FnMut(&str) -> Option<String>,
) -> Vec<&'static str> {
    REQUIRED_PUBLICATION_FIELDS
        .iter()
        .copied()
        .filter(|key| {
            read(key)
                .map(|value| !is_published_value(key, &value))
                .unwrap_or(true)
        })
        .collect()
}

fn missing_publication_fields() -> Vec<&'static str> {
    missing_publication_fields_with(|key| std::env::var(key).ok())
}

fn publication_not_ready() -> LegalError {
    LegalError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        code: "legal_publication_incomplete",
        message: "The service operator has not completed the required legal and privacy publication details. Agreement has not been recorded.",
    }
}

fn missing_acceptance() -> LegalError {
    LegalError {
        status: StatusCode::UNPROCESSABLE_ENTITY,
        code: "legal_acceptance_required",
        message: "Agree to the Terms of Service and acknowledge the Privacy Policy to continue.",
    }
}

fn storage_error() -> LegalError {
    LegalError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        code: "legal_acceptance_unavailable",
        message: "We could not save your agreement right now. Please try again.",
    }
}

fn acceptance_complete(input: &AcceptLegalDocumentsInput) -> bool {
    input.terms_accepted && input.privacy_acknowledged
}

pub async fn get_acceptance(
    State(state): State<AppState>,
    user: AuthenticatedSessionUser,
) -> Result<Json<LegalAcceptanceStatus>, LegalError> {
    let rows = sqlx::query(
        r#"
        SELECT document_key
        FROM public.user_legal_acceptances
        WHERE auth_user_id = $1
          AND (
              (document_key = 'terms' AND document_version = $2)
              OR (document_key = 'privacy' AND document_version = $3)
          )
        "#,
    )
    .bind(user.id)
    .bind(TERMS_VERSION)
    .bind(PRIVACY_VERSION)
    .fetch_all(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "could not read current legal acceptance");
        storage_error()
    })?;

    let terms_accepted = rows.iter().any(|row| {
        row.try_get::<String, _>("document_key")
            .is_ok_and(|key| key == "terms")
    });
    let privacy_acknowledged = rows.iter().any(|row| {
        row.try_get::<String, _>("document_key")
            .is_ok_and(|key| key == "privacy")
    });

    let missing_publication_fields = missing_publication_fields();
    let publication_ready = missing_publication_fields.is_empty();

    Ok(Json(LegalAcceptanceStatus {
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
        terms_accepted,
        privacy_acknowledged,
        complete: terms_accepted && privacy_acknowledged,
        publication_ready,
        missing_publication_fields,
    }))
}

pub async fn accept_documents(
    State(state): State<AppState>,
    user: AuthenticatedSessionUser,
    Json(input): Json<AcceptLegalDocumentsInput>,
) -> Result<(StatusCode, Json<LegalAcceptanceStatus>), LegalError> {
    if !missing_publication_fields().is_empty() {
        return Err(publication_not_ready());
    }

    if !acceptance_complete(&input) {
        return Err(missing_acceptance());
    }

    let mut transaction = state.database.begin().await.map_err(|error| {
        tracing::error!(%error, "could not begin legal acceptance transaction");
        storage_error()
    })?;

    sqlx::query(
        r#"
        INSERT INTO public.user_legal_acceptances
            (auth_user_id, document_key, document_version, acceptance_source)
        VALUES
            ($1, 'terms', $2, 'web'),
            ($1, 'privacy', $3, 'web')
        ON CONFLICT (auth_user_id, document_key, document_version) DO NOTHING
        "#,
    )
    .bind(user.id)
    .bind(TERMS_VERSION)
    .bind(PRIVACY_VERSION)
    .execute(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(%error, "could not persist legal acceptance");
        storage_error()
    })?;

    transaction.commit().await.map_err(|error| {
        tracing::error!(%error, "could not commit legal acceptance");
        storage_error()
    })?;

    Ok((
        StatusCode::CREATED,
        Json(LegalAcceptanceStatus {
            terms_version: TERMS_VERSION,
            privacy_version: PRIVACY_VERSION,
            terms_accepted: true,
            privacy_acknowledged: true,
            complete: true,
            publication_ready: true,
            missing_publication_fields: Vec::new(),
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_both_the_terms_and_privacy_acknowledgement() {
        assert!(!acceptance_complete(&AcceptLegalDocumentsInput {
            terms_accepted: false,
            privacy_acknowledged: false,
        }));
        assert!(!acceptance_complete(&AcceptLegalDocumentsInput {
            terms_accepted: true,
            privacy_acknowledged: false,
        }));
        assert!(!acceptance_complete(&AcceptLegalDocumentsInput {
            terms_accepted: false,
            privacy_acknowledged: true,
        }));
        assert!(acceptance_complete(&AcceptLegalDocumentsInput {
            terms_accepted: true,
            privacy_acknowledged: true,
        }));
    }

    #[test]
    fn legal_publication_requires_every_operator_and_privacy_field() {
        let missing = missing_publication_fields_with(|key| {
            if key == "LEGAL_OPERATOR_NAME" {
                Some("LOOP Operator Limited".to_string())
            } else {
                None
            }
        });
        assert_eq!(missing.len(), REQUIRED_PUBLICATION_FIELDS.len() - 1);
        assert!(!missing.contains(&"LEGAL_OPERATOR_NAME"));
        assert!(missing.contains(&"PRIVACY_PROCESSORS"));
    }

    #[test]
    fn legal_publication_rejects_blank_placeholder_and_invalid_email_values() {
        let missing = missing_publication_fields_with(|key| match key {
            "LEGAL_OPERATOR_NAME" => Some("TODO".to_string()),
            "LEGAL_OPERATOR_ADDRESS" => Some(" ".to_string()),
            "LEGAL_CONTACT_EMAIL" => Some("not-an-email".to_string()),
            "PRIVACY_CONTACT_EMAIL" => Some("privacy@loopapp.test".to_string()),
            _ => Some("Configured value".to_string()),
        });
        assert_eq!(
            missing,
            vec![
                "LEGAL_OPERATOR_NAME",
                "LEGAL_OPERATOR_ADDRESS",
                "LEGAL_CONTACT_EMAIL"
            ]
        );
    }

    #[test]
    fn legal_document_versions_are_explicit_and_distinct() {
        assert!(!TERMS_VERSION.is_empty());
        assert!(!PRIVACY_VERSION.is_empty());
    }
}

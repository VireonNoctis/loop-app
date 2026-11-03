use axum::{
    extract::FromRequestParts,
    http::{HeaderValue, StatusCode, header::AUTHORIZATION, request::Parts},
    response::{IntoResponse, Response},
};
use sqlx::Row;
use uuid::Uuid;

use crate::state::AppState;

/// Canonical LOOP profile identity resolved from an active Better Auth session.
#[derive(Clone, Debug)]
pub struct AuthenticatedUser {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub is_verified: bool,
}

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(&parts.headers).ok_or_else(unauthorized)?;

        let row = sqlx::query(
            r#"
            SELECT
                profile.id,
                profile.username,
                profile.display_name,
                profile.avatar_url,
                profile.is_verified
            FROM "session" AS auth_session
            JOIN "user" AS auth_user
              ON auth_user.id = auth_session."userId"
            JOIN LATERAL (
                SELECT
                    candidate.id,
                    candidate.username,
                    candidate.display_name,
                    candidate.avatar_url,
                    candidate.is_verified
                FROM profiles AS candidate
                WHERE candidate.id::text = auth_session."userId"
                   OR lower(candidate.email) = lower(auth_user.email)
                ORDER BY (candidate.id::text = auth_session."userId") DESC
                LIMIT 1
            ) AS profile ON TRUE
            WHERE auth_session.token = $1
              AND auth_session."expiresAt" > NOW()
            LIMIT 1
            "#,
        )
        .bind(token)
        .fetch_optional(&state.database)
        .await
        .map_err(|error| {
            tracing::error!(%error, "could not resolve Rust API session");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?;

        let Some(row) = row else {
            return Err(unauthorized());
        };

        let id = row
            .try_get::<Uuid, _>("id")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;
        let username = row
            .try_get::<String, _>("username")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;
        let display_name = row
            .try_get::<String, _>("display_name")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;
        let avatar_url = row
            .try_get::<Option<String>, _>("avatar_url")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;
        let is_verified = row
            .try_get::<bool, _>("is_verified")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;

        Ok(Self {
            id,
            username,
            display_name,
            avatar_url,
            is_verified,
        })
    }
}

/// Authenticated Better Auth identity without requiring the matching LOOP
/// profile to exist yet. Account creation can provision the profile after the
/// social-login callback, so legal acceptance must attach to the auth user.
#[derive(Clone, Debug)]
pub struct AuthenticatedSessionUser {
    pub id: String,
}

impl FromRequestParts<AppState> for AuthenticatedSessionUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(&parts.headers).ok_or_else(unauthorized)?;

        let row = sqlx::query(
            r#"
            SELECT auth_user.id::text AS id
            FROM "session" AS auth_session
            JOIN "user" AS auth_user
              ON auth_user.id = auth_session."userId"
            WHERE auth_session.token = $1
              AND auth_session."expiresAt" > NOW()
            LIMIT 1
            "#,
        )
        .bind(token)
        .fetch_optional(&state.database)
        .await
        .map_err(|error| {
            tracing::error!(%error, "could not resolve authenticated session identity");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?;

        let Some(row) = row else {
            return Err(unauthorized());
        };

        let id = row
            .try_get::<String, _>("id")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())?;

        Ok(Self { id })
    }
}

/// Optional session identity for read-only endpoints that expose public resources.
/// A malformed or expired credential remains an authentication error; only a
/// request with no Authorization header is treated as anonymous.
pub struct OptionalAuthenticatedUser(pub Option<AuthenticatedUser>);

impl FromRequestParts<AppState> for OptionalAuthenticatedUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if !parts.headers.contains_key(AUTHORIZATION) {
            return Ok(Self(None));
        }

        AuthenticatedUser::from_request_parts(parts, state)
            .await
            .map(|user| Self(Some(user)))
    }
}

fn bearer_token(headers: &http::HeaderMap) -> Option<&str> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }

    let token = token.trim();
    if token.is_empty() || token.chars().any(char::is_whitespace) {
        return None;
    }

    Some(token)
}

fn unauthorized() -> Response {
    let mut response = StatusCode::UNAUTHORIZED.into_response();
    response.headers_mut().insert(
        http::header::WWW_AUTHENTICATE,
        HeaderValue::from_static("Bearer"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use http::HeaderMap;

    #[test]
    fn accepts_a_bearer_token() {
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer session-token"),
        );

        assert_eq!(bearer_token(&headers), Some("session-token"));
    }

    #[test]
    fn bearer_scheme_is_case_insensitive() {
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("bearer session-token"),
        );

        assert_eq!(bearer_token(&headers), Some("session-token"));
    }

    #[test]
    fn rejects_missing_or_malformed_credentials() {
        let headers = HeaderMap::new();
        assert_eq!(bearer_token(&headers), None);

        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Basic token"));
        assert_eq!(bearer_token(&headers), None);

        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer"));
        assert_eq!(bearer_token(&headers), None);

        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer token with spaces"),
        );
        assert_eq!(bearer_token(&headers), None);
    }
}

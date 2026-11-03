use axum::{Json, extract::State, http::StatusCode};
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    status: &'static str,
}

pub async fn live() -> Json<HealthResponse> {
    Json(HealthResponse { status: "alive" })
}

pub async fn ready(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    match sqlx::query("SELECT 1").execute(&state.database).await {
        Ok(_) => (StatusCode::OK, Json(HealthResponse { status: "ready" })),
        Err(error) => {
            tracing::error!(%error, "database readiness check failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse {
                    status: "not_ready",
                }),
            )
        }
    }
}

use axum::{Json, extract::State};
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
pub struct CapabilitiesResponse {
    service: &'static str,
    api_version: &'static str,
    object_storage_configured: bool,
}

pub async fn capabilities(State(state): State<AppState>) -> Json<CapabilitiesResponse> {
    Json(CapabilitiesResponse {
        service: "loop-api",
        api_version: "v1",
        object_storage_configured: state
            .storage
            .as_ref()
            .is_some_and(|storage| storage.is_configured()),
    })
}

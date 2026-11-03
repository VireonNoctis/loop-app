mod auth;
mod config;
mod notification_events;
mod routes;
mod state;
mod storage;

use std::time::Duration;

use anyhow::Context;
use axum::{
    Router,
    routing::{delete, get, patch, post, put},
};
use config::AppConfig;
use http::{
    Method, StatusCode,
    header::{AUTHORIZATION, CONTENT_TYPE},
};
use sqlx::postgres::PgPoolOptions;
use state::AppState;
use tokio::net::TcpListener;
use tower_http::{
    cors::CorsLayer, limit::RequestBodyLimitLayer, timeout::TimeoutLayer, trace::TraceLayer,
};
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "loop_api=info,tower_http=info".into()),
        )
        .with_target(false)
        .compact()
        .init();

    let config = AppConfig::from_env()?;

    let database = PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&config.database_url)
        .await
        .context("could not connect to PostgreSQL")?;

    if config.run_migrations {
        tracing::warn!("RUN_MIGRATIONS=true: applying embedded additive SQLx migrations");
        sqlx::migrate!("./migrations")
            .run(&database)
            .await
            .context("database migrations failed")?;
    }

    let storage = storage::S3Store::from_config(&config).await?;
    let state = AppState { database, storage };

    let cors = CorsLayer::new()
        .allow_origin(config.cors_allowed_origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE])
        .allow_credentials(true);

    let app = Router::new()
        .route("/health/live", get(routes::health::live))
        .route("/health/ready", get(routes::health::ready))
        .route("/v1/system/capabilities", get(routes::system::capabilities))
        .route("/v1/me", get(routes::me::get_me))
        .route(
            "/v1/legal/acceptance",
            get(routes::legal::get_acceptance).post(routes::legal::accept_documents),
        )
        .route("/v1/drops", get(routes::drops::list))
        .route(
            "/v1/chains",
            get(routes::chains::list).post(routes::chains::create),
        )
        .route(
            "/v1/chains/{chain_id}",
            get(routes::chains::get).patch(routes::chains::update),
        )
        .route(
            "/v1/chains/{chain_id}/contributions",
            post(routes::chains::contribute),
        )
        .route(
            "/v1/chains/{chain_id}/members/{member_user_id}",
            put(routes::chains::set_member).delete(routes::chains::remove_member),
        )
        .route(
            "/v1/chains/{chain_id}/fork",
            post(routes::chain_lifecycle::fork),
        )
        .route(
            "/v1/chains/{chain_id}/contributions/{contribution_id}",
            patch(routes::chain_lifecycle::update_contribution),
        )
        .route(
            "/v1/chains/{chain_id}/contributions/{contribution_id}/revisions",
            get(routes::chain_lifecycle::list_revisions),
        )
        .route(
            "/v1/chains/{chain_id}/contributions/{contribution_id}/revisions/{revision_id}/restore",
            post(routes::chain_lifecycle::restore_contribution_revision),
        )
        .route("/v1/follow-requests", get(routes::follow_requests::list))
        .route(
            "/v1/follow-requests/{request_id}",
            post(routes::follow_requests::act),
        )
        .route(
            "/v1/users/{target_id}/follow-state",
            get(routes::social::follow_state),
        )
        .route(
            "/v1/users/{target_id}/followers",
            get(routes::social::followers),
        )
        .route(
            "/v1/users/{target_id}/following",
            get(routes::social::following),
        )
        .route(
            "/v1/users/{target_id}/chain-contributions",
            get(routes::social::chain_contributions),
        )
        .route("/v1/users/{target_id}/follow", post(routes::social::follow))
        .route(
            "/v1/users/{target_id}/follow-request",
            delete(routes::social::withdraw_follow_request),
        )
        .route(
            "/v1/notifications",
            get(routes::notifications::list).delete(routes::notifications::clear_all),
        )
        .route(
            "/v1/notifications/read",
            patch(routes::notifications::mark_read),
        )
        .route(
            "/v1/notifications/{notification_id}",
            delete(routes::notifications::delete_one),
        )
        .route(
            "/v1/collections",
            get(routes::collections::list).post(routes::collections::create),
        )
        .route(
            "/v1/collections/invitations",
            get(routes::collections::list_invitations),
        )
        .route(
            "/v1/collections/{collection_id}/invitation",
            patch(routes::collections::respond_to_invitation),
        )
        .route(
            "/v1/collections/{collection_id}",
            get(routes::collections::get),
        )
        .route(
            "/v1/collections/{collection_id}/items",
            post(routes::collections::add_item),
        )
        .route(
            "/v1/collections/{collection_id}/members",
            post(routes::collections::add_member),
        )
        .route(
            "/v1/collections/{collection_id}/members/{member_user_id}",
            delete(routes::collections::remove_member),
        )
        .route(
            "/v1/collections/{collection_id}/items/{item_id}",
            delete(routes::collections::remove_item),
        )
        .with_state(state)
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::GATEWAY_TIMEOUT,
            Duration::from_secs(15),
        ))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let listener = TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("could not bind API listener to {}", config.bind_addr))?;

    info!(address = %config.bind_addr, "LOOP Rust API listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("Rust API server stopped unexpectedly")?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "failed to listen for Ctrl+C");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(%error, "failed to listen for SIGTERM");
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    info!("shutdown signal received");
}

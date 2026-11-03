use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, state::AppState};

#[derive(Serialize)]
struct ApiErrorBody {
    error: &'static str,
    message: String,
}

pub struct ApiError {
    status: StatusCode,
    body: ApiErrorBody,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

fn api_error(status: StatusCode, error: &'static str, message: impl Into<String>) -> ApiError {
    ApiError {
        status,
        body: ApiErrorBody {
            error,
            message: message.into(),
        },
    }
}

#[derive(Deserialize)]
pub struct ListNotificationsQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    unread_only: Option<bool>,
    notification_type: Option<String>,
}

#[derive(Serialize)]
pub struct NotificationActor {
    id: Uuid,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    is_verified: bool,
}

#[derive(Serialize)]
pub struct NotificationItem {
    id: Uuid,
    #[serde(rename = "type")]
    type_name: String,
    title: String,
    message: String,
    data: Option<Value>,
    action_url: Option<String>,
    is_read: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    actor: Option<NotificationActor>,
    actor_name: Option<String>,
}

#[derive(Serialize)]
pub struct NotificationListResponse {
    success: bool,
    notifications: Vec<NotificationItem>,
    has_more: bool,
    unread_count: i64,
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Query(query): Query<ListNotificationsQuery>,
) -> Result<Json<NotificationListResponse>, ApiError> {
    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    let offset = query.offset.unwrap_or(0).max(0);
    let unread_only = query.unread_only.unwrap_or(false);
    let notification_type = query
        .notification_type
        .as_deref()
        .filter(|value| !value.trim().is_empty());

    let rows = sqlx::query(
        r#"
        SELECT
            notification.id,
            notification.type,
            notification.title,
            notification.message,
            notification.data,
            notification.action_url,
            notification.is_read,
            notification.created_at,
            notification.updated_at,
            actor.id AS actor_id,
            actor.username AS actor_username,
            actor.display_name AS actor_display_name,
            actor.avatar_url AS actor_avatar_url,
            actor.is_verified AS actor_is_verified
        FROM notifications AS notification
        LEFT JOIN profiles AS actor ON actor.id = notification.actor_id
        WHERE notification.user_id = $1
          AND (NOT $2 OR notification.is_read = false)
          AND ($3::text IS NULL OR notification.type = $3)
        ORDER BY notification.created_at DESC, notification.id DESC
        LIMIT $4 OFFSET $5
        "#,
    )
    .bind(user.id)
    .bind(unread_only)
    .bind(notification_type)
    .bind(limit + 1)
    .bind(offset)
    .fetch_all(&state.database)
    .await
    .map_err(|error| {
        tracing::error!(%error, "failed to list notifications");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "notification_list_failed",
            "Could not load notifications.",
        )
    })?;

    let has_more = rows.len() > limit as usize;
    let unread_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false",
    )
    .bind(user.id)
    .fetch_one(&state.database)
    .await
    .map_err(db_error)?;

    let mut notifications = Vec::with_capacity(rows.len().min(limit as usize));
    for row in rows.into_iter().take(limit as usize) {
        let actor_id: Option<Uuid> = row.try_get("actor_id").map_err(db_error)?;
        let actor = if let Some(id) = actor_id {
            Some(NotificationActor {
                id,
                username: row.try_get("actor_username").map_err(db_error)?,
                display_name: row.try_get("actor_display_name").map_err(db_error)?,
                avatar_url: row.try_get("actor_avatar_url").map_err(db_error)?,
                is_verified: row.try_get("actor_is_verified").map_err(db_error)?,
            })
        } else {
            None
        };

        let actor_name = actor.as_ref().map(|value| {
            if value.display_name.trim().is_empty() {
                value.username.clone()
            } else {
                value.display_name.clone()
            }
        });

        notifications.push(NotificationItem {
            id: row.try_get("id").map_err(db_error)?,
            type_name: row.try_get("type").map_err(db_error)?,
            title: row.try_get("title").map_err(db_error)?,
            message: row.try_get("message").map_err(db_error)?,
            data: row.try_get("data").map_err(db_error)?,
            action_url: row.try_get("action_url").map_err(db_error)?,
            is_read: row.try_get("is_read").map_err(db_error)?,
            created_at: row.try_get("created_at").map_err(db_error)?,
            updated_at: row.try_get("updated_at").map_err(db_error)?,
            actor,
            actor_name,
        });
    }

    Ok(Json(NotificationListResponse {
        success: true,
        notifications,
        has_more,
        unread_count,
    }))
}

#[derive(Deserialize)]
pub struct MarkNotificationsReadInput {
    notification_ids: Option<Vec<Uuid>>,
    mark_all_read: Option<bool>,
}

#[derive(Serialize)]
pub struct MutationResponse {
    success: bool,
    updated_count: u64,
}

pub async fn mark_read(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(input): Json<MarkNotificationsReadInput>,
) -> Result<Json<MutationResponse>, ApiError> {
    let result = if input.mark_all_read.unwrap_or(false) {
        sqlx::query(
            "UPDATE notifications SET is_read = true, updated_at = NOW() WHERE user_id = $1 AND is_read = false",
        )
        .bind(user.id)
        .execute(&state.database)
        .await
    } else if let Some(ids) = input.notification_ids.filter(|ids| !ids.is_empty()) {
        sqlx::query(
            "UPDATE notifications SET is_read = true, updated_at = NOW() WHERE user_id = $1 AND id = ANY($2)",
        )
        .bind(user.id)
        .bind(ids)
        .execute(&state.database)
        .await
    } else {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "invalid_notification_read_request",
            "Provide notification_ids or set mark_all_read to true.",
        ));
    };

    let result = result.map_err(|error| {
        tracing::error!(%error, "failed to mark notifications as read");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "notification_read_failed",
            "Could not update notifications.",
        )
    })?;

    Ok(Json(MutationResponse {
        success: true,
        updated_count: result.rows_affected(),
    }))
}

pub async fn clear_all(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> Result<Json<MutationResponse>, ApiError> {
    let result = sqlx::query("DELETE FROM notifications WHERE user_id = $1")
        .bind(user.id)
        .execute(&state.database)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to clear notifications");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "notification_clear_failed",
                "Could not clear notifications.",
            )
        })?;

    Ok(Json(MutationResponse {
        success: true,
        updated_count: result.rows_affected(),
    }))
}

pub async fn delete_one(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    axum::extract::Path(notification_id): axum::extract::Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("DELETE FROM notifications WHERE id = $1 AND user_id = $2")
        .bind(notification_id)
        .bind(user.id)
        .execute(&state.database)
        .await
        .map_err(|error| {
            tracing::error!(%error, "failed to delete notification");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "notification_delete_failed",
                "Could not delete this notification.",
            )
        })?;

    if result.rows_affected() == 0 {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "notification_not_found",
            "This notification is unavailable.",
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

fn db_error(error: sqlx::Error) -> ApiError {
    tracing::error!(%error, "notification database operation failed");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "notification_database_error",
        "Could not load notification data.",
    )
}

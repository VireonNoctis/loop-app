use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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
pub struct ListFollowRequestsQuery {
    limit: Option<i64>,
}

#[derive(Serialize)]
pub struct FollowRequestPerson {
    id: Uuid,
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    video_avatar_url: Option<String>,
    is_verified: bool,
    bio: Option<String>,
}

#[derive(Serialize)]
pub struct IncomingFollowRequest {
    id: Uuid,
    created_at: DateTime<Utc>,
    requester: FollowRequestPerson,
}

#[derive(Serialize)]
pub struct OutgoingFollowRequest {
    id: Uuid,
    target_id: Uuid,
    status: String,
    created_at: DateTime<Utc>,
    target: FollowRequestPerson,
}

#[derive(Serialize)]
pub struct FollowRequestsResponse {
    success: bool,
    incoming: Vec<IncomingFollowRequest>,
    outgoing: Vec<OutgoingFollowRequest>,
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Query(query): Query<ListFollowRequestsQuery>,
) -> Result<Json<FollowRequestsResponse>, ApiError> {
    let limit = query.limit.unwrap_or(30).clamp(1, 50);

    let incoming_rows = sqlx::query(
        r#"
        SELECT
            request.id AS request_id,
            request.created_at AS request_created_at,
            profile.id AS person_id,
            profile.username,
            profile.display_name,
            profile.avatar_url,
            profile.video_avatar_url,
            profile.is_verified,
            profile.bio
        FROM follow_requests AS request
        JOIN profiles AS profile ON profile.id = request.requester_id
        WHERE request.target_id = $1
          AND request.status = 'pending'
        ORDER BY request.created_at DESC, request.id DESC
        LIMIT $2
        "#,
    )
    .bind(user.id)
    .bind(limit)
    .fetch_all(&state.database)
    .await
    .map_err(db_error)?;

    let outgoing_rows = sqlx::query(
        r#"
        SELECT
            request.id AS request_id,
            request.target_id,
            request.status,
            request.created_at AS request_created_at,
            profile.id AS person_id,
            profile.username,
            profile.display_name,
            profile.avatar_url,
            profile.video_avatar_url,
            profile.is_verified,
            profile.bio
        FROM follow_requests AS request
        JOIN profiles AS profile ON profile.id = request.target_id
        WHERE request.requester_id = $1
          AND request.status = 'pending'
        ORDER BY request.created_at DESC, request.id DESC
        LIMIT $2
        "#,
    )
    .bind(user.id)
    .bind(limit)
    .fetch_all(&state.database)
    .await
    .map_err(db_error)?;

    let incoming = incoming_rows
        .into_iter()
        .map(|row| {
            Ok(IncomingFollowRequest {
                id: row.try_get("request_id").map_err(db_error)?,
                created_at: row.try_get("request_created_at").map_err(db_error)?,
                requester: FollowRequestPerson {
                    id: row.try_get("person_id").map_err(db_error)?,
                    username: row.try_get("username").map_err(db_error)?,
                    display_name: row.try_get("display_name").map_err(db_error)?,
                    avatar_url: row.try_get("avatar_url").map_err(db_error)?,
                    video_avatar_url: row.try_get("video_avatar_url").map_err(db_error)?,
                    is_verified: row.try_get("is_verified").map_err(db_error)?,
                    bio: row.try_get("bio").map_err(db_error)?,
                },
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    let outgoing = outgoing_rows
        .into_iter()
        .map(|row| {
            Ok(OutgoingFollowRequest {
                id: row.try_get("request_id").map_err(db_error)?,
                target_id: row.try_get("target_id").map_err(db_error)?,
                status: row.try_get("status").map_err(db_error)?,
                created_at: row.try_get("request_created_at").map_err(db_error)?,
                target: FollowRequestPerson {
                    id: row.try_get("person_id").map_err(db_error)?,
                    username: row.try_get("username").map_err(db_error)?,
                    display_name: row.try_get("display_name").map_err(db_error)?,
                    avatar_url: row.try_get("avatar_url").map_err(db_error)?,
                    video_avatar_url: row.try_get("video_avatar_url").map_err(db_error)?,
                    is_verified: row.try_get("is_verified").map_err(db_error)?,
                    bio: row.try_get("bio").map_err(db_error)?,
                },
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(FollowRequestsResponse {
        success: true,
        incoming,
        outgoing,
    }))
}

#[derive(Deserialize)]
pub struct FollowRequestActionInput {
    action: String,
}

#[derive(Serialize)]
pub struct FollowRequestActionResponse {
    success: bool,
    action: &'static str,
    already_handled: bool,
}

pub async fn act(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Path(request_id): Path<Uuid>,
    Json(input): Json<FollowRequestActionInput>,
) -> Result<Json<FollowRequestActionResponse>, ApiError> {
    if !matches!(input.action.as_str(), "accept" | "decline" | "withdraw") {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_follow_request_action",
            "Action must be accept, decline or withdraw.",
        ));
    }

    let mut transaction = state.database.begin().await.map_err(db_error)?;
    let request = sqlx::query(
        r#"
        SELECT id, requester_id, target_id, status
        FROM follow_requests
        WHERE id = $1
        FOR UPDATE
        "#,
    )
    .bind(request_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(db_error)?;

    let Some(request) = request else {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "follow_request_not_found",
            "This follow request is unavailable.",
        ));
    };

    let requester_id: Uuid = request.try_get("requester_id").map_err(db_error)?;
    let target_id: Uuid = request.try_get("target_id").map_err(db_error)?;
    let status: String = request.try_get("status").map_err(db_error)?;

    if input.action == "withdraw" {
        if requester_id != user.id {
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "follow_request_not_owned",
                "You can only withdraw requests you sent.",
            ));
        }

        if status != "pending" {
            transaction.commit().await.map_err(db_error)?;
            return Ok(Json(FollowRequestActionResponse {
                success: true,
                action: "withdrawn",
                already_handled: true,
            }));
        }

        sqlx::query(
            "DELETE FROM follow_requests WHERE id = $1 AND requester_id = $2 AND status = 'pending'",
        )
        .bind(request_id)
        .bind(user.id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;

        transaction.commit().await.map_err(db_error)?;
        return Ok(Json(FollowRequestActionResponse {
            success: true,
            action: "withdrawn",
            already_handled: false,
        }));
    }

    if target_id != user.id {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "follow_request_not_owned",
            "You can only manage follow requests sent to you.",
        ));
    }

    if status != "pending" {
        transaction.commit().await.map_err(db_error)?;
        return Ok(Json(FollowRequestActionResponse {
            success: true,
            action: if status == "approved" {
                "accepted"
            } else {
                "declined"
            },
            already_handled: true,
        }));
    }

    if input.action == "decline" {
        sqlx::query(
            r#"
            UPDATE follow_requests
            SET status = 'declined', updated_at = NOW()
            WHERE id = $1 AND target_id = $2 AND status = 'pending'
            "#,
        )
        .bind(request_id)
        .bind(user.id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;

        transaction.commit().await.map_err(db_error)?;
        return Ok(Json(FollowRequestActionResponse {
            success: true,
            action: "declined",
            already_handled: false,
        }));
    }

    let blocked: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM user_blocks
            WHERE (blocker_id = $1 AND blocked_id = $2)
               OR (blocker_id = $2 AND blocked_id = $1)
        )
        "#,
    )
    .bind(requester_id)
    .bind(target_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(db_error)?;

    if blocked {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "follow_request_blocked",
            "This request cannot be accepted while either account blocks the other.",
        ));
    }

    let inserted = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO follows (follower_id, following_id)
        VALUES ($1, $2)
        ON CONFLICT (follower_id, following_id) DO NOTHING
        RETURNING id
        "#,
    )
    .bind(requester_id)
    .bind(target_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(db_error)?;

    if inserted.is_some() {
        sqlx::query(
            "UPDATE profiles SET followers_count = followers_count + 1, updated_at = NOW() WHERE id = $1",
        )
        .bind(target_id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;

        sqlx::query(
            "UPDATE profiles SET following_count = following_count + 1, updated_at = NOW() WHERE id = $1",
        )
        .bind(requester_id)
        .execute(&mut *transaction)
        .await
        .map_err(db_error)?;
    }

    sqlx::query(
        r#"
        UPDATE follow_requests
        SET status = 'approved', updated_at = NOW()
        WHERE id = $1 AND target_id = $2 AND status = 'pending'
        "#,
    )
    .bind(request_id)
    .bind(user.id)
    .execute(&mut *transaction)
    .await
    .map_err(db_error)?;

    let actor = sqlx::query("SELECT username, display_name FROM profiles WHERE id = $1")
        .bind(user.id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(db_error)?;
    let actor_username: String = actor.try_get("username").map_err(db_error)?;
    let actor_name: String = actor.try_get("display_name").map_err(db_error)?;

    sqlx::query(
        r#"
        INSERT INTO notifications (user_id, actor_id, type, title, message, data, action_url)
        VALUES ($1, $2, 'follow', 'Follow request accepted', $3, $4, $5)
        "#,
    )
    .bind(requester_id)
    .bind(user.id)
    .bind(format!("{actor_name} accepted your follow request"))
    .bind(serde_json::json!({ "follower_id": user.id }))
    .bind(format!("/profile/{actor_username}"))
    .execute(&mut *transaction)
    .await
    .map_err(db_error)?;

    transaction.commit().await.map_err(db_error)?;

    Ok(Json(FollowRequestActionResponse {
        success: true,
        action: "accepted",
        already_handled: false,
    }))
}

fn db_error(error: sqlx::Error) -> ApiError {
    tracing::error!(%error, "follow request database operation failed");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "follow_request_database_error",
        "Could not manage follow requests.",
    )
}
